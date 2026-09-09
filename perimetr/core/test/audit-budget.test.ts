import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditProfile, factsNeedingNumbers, checkBudget, callCost, spentInMonth,
  checkRunLimit, checkLetterLimit, DEFAULT_CONFIG,
} from '../src/index.ts';
import type { Profile, Fact, UsageEntry } from '../src/types.ts';

const profile = (over: Partial<Profile> = {}): Profile => ({
  resume_text: 'x', extras_text: '', perimeter: '', industries: '', exclude: '',
  geo: 'Germany, Sweden', breadth: 'medium',
  languages: [{ lang: 'English', cefr: 'C2' }],
  work_auth: [{ region: 'Germany', status: 'citizen' }, { region: 'Sweden', status: 'permit' }],
  relocation: { ready: 'yes', package_needed: false },
  scale: { team_max: 25, budget_max: 4_000_000, pnl: true, geo_scope: '3 страны' },
  years_exp: 14, gaps: [], salary_range: '', linkedin_url: 'https://linkedin.com/in/x',
  linkedin_complete: true, photo_policy: 'auto',
  roles: [
    { role_title: 'Head of Ops', from: '2021-01-01', to: null },
    { role_title: 'Ops Manager', from: '2017-01-01', to: '2021-01-01' },
  ], ...over,
});

const fact = (id: string, over: Partial<Fact> = {}): Fact => ({
  id, action: 'вырастил команду', result: 'до 25 человек', metric_value: 25,
  metric_unit: 'человек', scale_tags: ['team'], domain_tags: [], quantified: true,
  source_hint: 'команду из 25', confirmed: true, role_title: 'Head of Ops', ...over,
});

test('полный профиль проходит аудит', () => {
  const rep = auditProfile(profile(), [fact('f1'), fact('f2')], undefined, new Date('2026-09-09'));
  const bad = rep.metrics.filter(m => m.status !== 'ok').map(m => `${m.id}: ${m.detail}`);
  assert.deepEqual(bad, [], bad.join(' | '));
  assert.equal(rep.completeness, 1);
});

test('аудит и правило блокеров отвечают на вопрос о праве на работу одинаково', () => {
  // geo = «Germany, Sweden», в профиле «EU» + «Sweden». EU покрывает Германию —
  // и аудит обязан считать так же, как evaluateGaps, иначе один вопрос имеет
  // два ответа в одном приложении.
  const p = profile({ work_auth: [{ region: 'EU', status: 'permit' }, { region: 'Sweden', status: 'permit' }] });
  const rep = auditProfile(p, [fact('f1'), fact('f2')]);
  assert.equal(rep.metrics.find(m => m.id === 'work_auth')!.status, 'ok');
});

test('метрики показывают человекочитаемое значение, а не долю', () => {
  const rep = auditProfile(profile(), [fact('f1'), fact('f2')], undefined, new Date('2026-09-09'));
  assert.match(rep.metrics.find(m => m.id === 'tenure')!.display!, /мес\./);
  assert.match(rep.metrics.find(m => m.id === 'quantification')!.display!, /%/);
});

test('пустое право на работу даёт задачу с высоким весом и ведёт в поле', () => {
  const rep = auditProfile(profile({ work_auth: [] }), [fact('f1'), fact('f2')]);
  const m = rep.metrics.find(m => m.id === 'work_auth')!;
  assert.equal(m.status, 'missing');
  assert.equal(m.field, 'work_auth');
  assert.equal(rep.tasks[0].id, 'work_auth', 'самая эффективная правка идёт первой');
});

test('квантификация: доля считается по подтверждённым фактам', () => {
  const facts = [fact('f1'), fact('f2', { quantified: false, metric_value: null }),
    fact('f3', { quantified: false, metric_value: null })];
  const rep = auditProfile(profile(), facts);
  const m = rep.metrics.find(m => m.id === 'quantification')!;
  assert.equal(m.status, 'warn');
  assert.ok(Math.abs((m.value ?? 0) - 1 / 3) < 1e-9);
  assert.ok(rep.tasks.some(t => t.id.startsWith('quantify:')));
  assert.equal(factsNeedingNumbers(facts).length, 2);
});

test('неподтверждённые факты в аудит не считаются', () => {
  const rep = auditProfile(profile(), [fact('f1', { confirmed: false })]);
  assert.equal(rep.metrics.find(m => m.id === 'quantification')!.status, 'missing');
});

test('senior-роль без фактов о людях получает задачу', () => {
  const rep = auditProfile(profile(), [fact('f1', { scale_tags: [] }), fact('f2', { scale_tags: [] })]);
  assert.ok(rep.tasks.some(t => t.id.startsWith('people:')));
});

test('перерыв без причины и с причиной', () => {
  const withGap = auditProfile(profile({ gaps: [{ from: '2020-01-01', to: '2021-01-01' }] }), [fact('f1')]);
  assert.equal(withGap.metrics.find(m => m.id === 'gaps')!.status, 'warn');
  const explained = auditProfile(profile({ gaps: [{ from: '2020-01-01', to: '2021-01-01', reason: 'учёба' }] }), [fact('f1')]);
  assert.equal(explained.metrics.find(m => m.id === 'gaps')!.status, 'ok');
});

// ── Бюджет ──────────────────────────────────────────────────────────────────

const entry = (cost: number, at: string): UsageEntry => ({
  operation: 'analyse', model: 'gpt-5.6-sol', tokens_in: 1000, tokens_out: 300,
  tool_calls: 0, cost_usd: cost, ok: true, created_at: at,
});

test('бюджет: ok → warn на 80% → stop на 100%', () => {
  const now = new Date('2026-09-09T10:00:00Z');
  const ok = checkBudget([entry(5, '2026-09-01T00:00:00Z')], DEFAULT_CONFIG, now);
  assert.equal(ok.level, 'ok');
  assert.equal(ok.allow, true);
  assert.equal(ok.reason, null);

  const warn = checkBudget([entry(12.5, '2026-09-01T00:00:00Z')], DEFAULT_CONFIG, now);
  assert.equal(warn.level, 'warn');
  assert.equal(warn.allow, true, 'на 80% работа не останавливается');
  assert.match(warn.reason!, /разборов/, 'остаток назван в понятных единицах, а не в процентах');

  const stop = checkBudget([entry(15, '2026-09-01T00:00:00Z')], DEFAULT_CONFIG, now);
  assert.equal(stop.level, 'stop');
  assert.equal(stop.allow, false);
  assert.match(stop.reason!, /всё остальное работает/);
});

test('бюджет считается по календарному месяцу', () => {
  const log = [entry(14, '2026-08-31T23:00:00Z'), entry(1, '2026-09-01T01:00:00Z')];
  assert.equal(spentInMonth(log, '2026-09'), 1);
  assert.equal(checkBudget(log, DEFAULT_CONFIG, new Date('2026-09-09')).level, 'ok');
});

test('стоимость вызова: кэшированный вход дешевле, веб-поиск считается отдельно', () => {
  const plain = callCost('gpt-5.6-sol', { in: 1_000_000, out: 0 });
  assert.equal(plain, 4);
  const cached = callCost('gpt-5.6-sol', { in: 1_000_000, cached_in: 1_000_000, out: 0 });
  assert.equal(cached, 0.4, 'кэш даёт скидку 90%');
  const withSearch = callCost('gpt-5.6-terra', { in: 0, out: 0, web_search_calls: 6 });
  assert.equal(withSearch, 0.06);
  assert.equal(callCost('неизвестная-модель', { in: 1e6, out: 1e6 }), 0, 'неизвестная модель не роняет счёт');
});

test('лимит прогонов: один активный, десять в сутки', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const running = checkRunLimit([{ started_at: '2026-09-09T11:00:00Z', state: 'running' }], DEFAULT_CONFIG, now);
  assert.equal(running.allow, false);
  assert.match(running.reason!, /уже идёт/);

  const many = Array.from({ length: 10 }, () => ({ started_at: '2026-09-09T09:00:00Z', state: 'done' }));
  assert.equal(checkRunLimit(many, DEFAULT_CONFIG, now).allow, false);

  const yesterday = Array.from({ length: 10 }, () => ({ started_at: '2026-09-08T09:00:00Z', state: 'done' }));
  assert.equal(checkRunLimit(yesterday, DEFAULT_CONFIG, now).allow, true, 'вчерашние не считаются');
});

test('лимит писем — 10 в сутки', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const ten = Array.from({ length: 10 }, () => ({ created_at: '2026-09-09T09:00:00Z' }));
  const v = checkLetterLimit(ten, DEFAULT_CONFIG, now);
  assert.equal(v.allow, false);
  assert.match(v.reason!, /как рассылка/);
});
