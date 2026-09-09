import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeAnalysis, sanitizeBlocker, sanitizeFact, sanitizeIngest,
  sanitizeDiscoverItem, sanitizeResume, sanitizeLetter, parseCefr,
  resolveConfig, degradeModel, modelFor, DEFAULT_CONFIG,
} from '../src/index.ts';

test('санитайз разбора: закрытые списки, обрезка до 7 ожиданий, score обнулён', () => {
  const a = sanitizeAnalysis({
    expectations: Array.from({ length: 12 }, (_, i) => ({
      expectation: `ожидание ${i}`, weight: 'критично', strength: 'strong',
      bridge: 'магия', gap_class: 'catastrophic',
    })),
    blockers: [{ kind: 'work_auth', detail: 'нет' }, { kind: 'карма', detail: 'плохая' }],
    score: 99, uvp: 'x', objection: { risk: 'уйдёт', answer: 'нет' },
  });
  assert.equal(a.expectations.length, 7);
  assert.equal(a.expectations[0].weight, 'important', 'неизвестный вес → important');
  assert.equal(a.expectations[0].bridge, null, 'мост вне списка выброшен');
  assert.equal(a.blockers.length, 1, 'блокер вне шести видов выброшен');
  assert.equal(a.score, 0, 'score у модели не берётся');
  assert.equal(a.objection!.risk, 'уйдёт');
});

test('санитайз не бросает на мусоре', () => {
  for (const bad of [null, undefined, 42, 'строка', [], {}]) {
    assert.doesNotThrow(() => sanitizeAnalysis(bad));
    assert.doesNotThrow(() => sanitizeResume(bad));
    assert.doesNotThrow(() => sanitizeLetter(bad));
  }
  assert.equal(sanitizeBlocker({ kind: 'nope' }), null);
});

test('факт без подтверждаемой цитаты отбрасывается молча', () => {
  const id = () => 'generated';
  assert.equal(sanitizeFact({ action: 'сделал', source_hint: '' }, id), null);
  assert.equal(sanitizeFact({ action: '', source_hint: 'цитата' }, id), null);
  const f = sanitizeFact({ action: 'вырастил команду', source_hint: 'команду из 25', result: 'до 25' }, id);
  assert.equal(f!.id, 'generated');
  assert.equal(f!.confirmed, false, 'подтверждает только пользователь');
  assert.equal(f!.quantified, true, 'число в результате распознано');
});

test('§10.6 — email из ingest принимается только если он буквально есть в тексте', () => {
  const jd = 'Присылайте резюме на jobs@acme.com';
  assert.equal(sanitizeIngest({ contact_email: 'jobs@acme.com' }, jd).contact_email, 'jobs@acme.com');
  assert.equal(sanitizeIngest({ contact_email: 'ceo@acme.com' }, jd).contact_email, '', 'выдуманный адрес обнуляется');
});

test('§10.6 — discover никогда не отдаёт email, а имя хранит только с источником', () => {
  const item = sanitizeDiscoverItem({
    company: 'Acme', role_title: 'VP Ops', kind: 'vacancy', source_url: 'https://acme.com/jobs/1',
    contact: { name: 'Anna', title: 'CEO', email: 'anna@acme.com', linkedin: 'https://li/anna' },
  })!;
  assert.equal(item.contact!.email, '', 'адрес от модели обнулён');
  assert.equal(item.contact!.name, 'Anna');

  const noSource = sanitizeDiscoverItem({
    company: 'Acme', role_title: 'VP Ops', kind: 'vacancy',
    contact: { name: 'Anna', title: 'CEO', email: '', linkedin: '' },
  })!;
  assert.equal(noSource.contact, null, 'без source_url контакт не хранится');
});

test('гипотеза без датированного сигнала не является гипотезой', () => {
  assert.equal(sanitizeDiscoverItem({ company: 'A', role_title: 'B', kind: 'hypothesis' }), null);
  assert.ok(sanitizeDiscoverItem({
    company: 'A', role_title: 'B', kind: 'hypothesis',
    signal: 'раунд B', signal_date: '2026-06-01', source_url: 'https://x',
  }));
});

test('parseCefr не угадывает «fluent»', () => {
  assert.equal(parseCefr('German C1'), 'C1');
  assert.equal(parseCefr('немецкий — с1'), null, 'кириллическая «с» не CEFR');
  assert.equal(parseCefr('fluent'), null);
});

test('конфиг: частичное переопределение не стирает остальное', () => {
  const cfg = resolveConfig({ thresholds: { quantifiedShare: 0.5 } });
  assert.equal(cfg.thresholds.quantifiedShare, 0.5);
  assert.equal(cfg.thresholds.swapMinBroken, DEFAULT_THRESHOLDS_SWAP);
  assert.equal(cfg.models.analyse, 'gpt-5.6-sol', 'модели не тронуты');
  assert.equal(resolveConfig(null), DEFAULT_CONFIG);
});
const DEFAULT_THRESHOLDS_SWAP = 2;

test('деградация модели ступенью ниже', () => {
  assert.equal(degradeModel(DEFAULT_CONFIG, 'gpt-5.6-sol'), 'gpt-5.6-terra');
  assert.equal(degradeModel(DEFAULT_CONFIG, 'gpt-5.6-luna'), null, 'ниже некуда');
  assert.equal(modelFor(DEFAULT_CONFIG, 'analyse'), 'gpt-5.6-sol');
});

test('стоп-лист переопределяется по языку, не затирая другие языки', () => {
  const cfg = resolveConfig({ stoplist: { phrases: { ru: ['новая фраза'] } } as never });
  assert.deepEqual(cfg.stoplist.phrases.ru, ['новая фраза']);
  assert.ok(cfg.stoplist.phrases.en.length > 5, 'английский остался');
});
