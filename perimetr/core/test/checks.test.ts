// §10.10 — правила проверок документов. Критерии приёмки 6c и 6d.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkResume, checkLetter, checkStoplist, applySwapResult, canPresent, worstLevel,
  namedEntities, DEFAULT_CONFIG, type CheckContext,
} from '../src/index.ts';
import type { ResumeDoc, LetterDoc, Fact, Analysis } from '../src/types.ts';

const fact = (id: string, over: Partial<Fact> = {}): Fact => ({
  id, action: 'вырастил команду', how: '', result: 'до 25 человек',
  metric_value: 25, metric_unit: 'человек', scale_tags: ['team'], domain_tags: [],
  quantified: true, source_hint: 'команду из 25', confirmed: true, ...over,
});

const resume = (over: Partial<ResumeDoc> = {}): ResumeDoc => ({
  headline: 'VP Operations',
  summary: ['Вырастил операционную функцию с 8 до 25 человек в трёх странах.'],
  summary_support: [0],
  facts_line: 'EU work authorization · English C2, German C1 · relocation ready · linkedin.com/in/x',
  competencies: ['S&OP', 'WMS', 'P&L', 'Lean', 'SAP', 'KPI'],
  experience: [{
    company: 'Volvo', role_title: 'Head of Ops', period_from: '2021-01', period_to: null,
    context_line: 'команда 25, бюджет 4 млн EUR, 3 страны',
    bullets: ['Сократил срок поставки на 40%', 'Вырастил команду с 8 до 25 человек'],
  }],
  education: ['MSc, KTH'],
  format_variant: 'intl', language: 'ru', facts_used: ['f1', 'f2'],
  ...over,
});

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  language: 'ru', facts: [fact('f1'), fact('f2')], ...over,
});

test('чистое резюме проходит без block', () => {
  const res = checkResume(resume(), ctx());
  assert.ok(canPresent(res), JSON.stringify(res.filter(r => r.level === 'block'), null, 1));
});

test('единственный источник: неподтверждённый или несуществующий факт — block', () => {
  const unconfirmed = checkResume(resume(), ctx({ facts: [fact('f1'), fact('f2', { confirmed: false })] }));
  assert.ok(unconfirmed.some(r => r.rule === 'single_source' && r.level === 'block'));

  const missing = checkResume(resume({ facts_used: ['f9'] }), ctx());
  assert.ok(missing.some(r => r.rule === 'single_source' && r.level === 'block'));
});

test('6c — квантификация: меньше 60% буллитов с числом даёт warn', () => {
  const doc = resume({
    experience: [{
      company: 'Volvo', role_title: 'Head of Ops', period_from: '2021-01', period_to: null,
      context_line: '', bullets: ['Отвечал за логистику', 'Руководил закупками', 'Сократил срок на 40%'],
    }],
  });
  const res = checkResume(doc, ctx());
  assert.ok(res.some(r => r.rule === 'quantification' && r.level === 'warn'));
  assert.ok(res.some(r => r.rule === 'bullets_without_number_adjacent'));
});

test('6c — саммари без разметки подтверждения даёт warn; неподтверждённое утверждение тоже', () => {
  assert.ok(checkResume(resume({ summary_support: undefined }), ctx())
    .some(r => r.rule === 'summary_supported'));
  assert.ok(checkResume(resume({ summary_support: [null] }), ctx())
    .some(r => r.rule === 'summary_supported'));
  assert.ok(checkResume(resume({ summary: ['a', 'b', 'c', 'd'], summary_support: [0, 0, 0, 0] }), ctx())
    .some(r => r.rule === 'summary_length'));
});

test('6c — «лидерство» в компетенциях запрещено', () => {
  const res = checkResume(resume({ competencies: ['Лидерство', 'S&OP', 'WMS', 'P&L', 'Lean', 'SAP'] }), ctx());
  assert.ok(res.some(r => r.rule === 'competencies'));
});

test('6c — персональные данные вне de_at это block, в de_at — нет', () => {
  const withDob = resume({ education: ['Дата рождения: 1980'] });
  assert.ok(checkResume(withDob, ctx()).some(r => r.rule === 'personal_data' && r.level === 'block'));
  assert.equal(checkResume({ ...withDob, format_variant: 'de_at' }, ctx())
    .filter(r => r.rule === 'personal_data').length, 0);
});

test('верхняя треть: первые буллиты должны закрывать must', () => {
  const analysis = {
    expectations: [{ expectation: 'масштаб', weight: 'must', evidence: '', fact_id: 'fMust',
      source_hint: '', strength: 'strong', gap_class: null, bridge: null, gap_answer: '' }],
    blockers: [], score: 0, uvp: '', objection: null, reconstructed: false,
  } as Analysis;
  assert.ok(checkResume(resume({ facts_used: ['f1', 'f2'] }), ctx({ analysis }))
    .some(r => r.rule === 'top_third'));
  assert.equal(checkResume(resume({ facts_used: ['fMust', 'f1'] }),
    ctx({ analysis, facts: [fact('fMust'), fact('f1')] })).filter(r => r.rule === 'top_third').length, 0);
});

// ── Письмо ──────────────────────────────────────────────────────────────────

const letter = (over: Partial<LetterDoc> = {}): LetterDoc => ({
  subject: 'Операции в Nordics — 20 минут?',
  // Реальная длина ветки hypothesis — 120–180 слов (§10.5a), и фикстура обязана
  // в неё попадать: короткий образец прятал бы правило длины от теста.
  body: 'В июне 2026 вы открыли склад в Мальмё. По опыту такой запуск на квартал ломает '
    + 'планирование: сборные заказы расходятся между двумя площадками, и обещанные клиентам '
    + 'сроки перестают держаться ровно тогда, когда на них начинает смотреть коммерция.\n\n'
    + 'Я проходил такой переход в сети похожего размера. Вырастил операционную команду с 8 до '
    + '25 человек в трёх странах и сократил срок поставки на 40% за два квартала — не наймом, '
    + 'а перестройкой планирования между площадками и переносом части сборки ближе к клиенту.\n\n'
    + 'Роли под это у вас, насколько видно снаружи, пока нет. Возможно, она и не нужна. Но если '
    + 'вопрос уже обсуждается, предлагаю короткий разговор минут на двадцать на следующей неделе.\n\n'
    + 'Ваш контакт я взял со страницы руководства на сайте компании. Если такие письма вам не '
    + 'нужны, ответьте одним словом, и я больше не побеспокою.',
  word_count: 0, bridge_used: null, facts_used: ['f1'], language: 'ru', ...over,
});

const letterCtx = (over: Partial<CheckContext> = {}): CheckContext => ctx({
  resume: resume(),
  opportunity: { company: 'Nordic Logistics', signal: 'В июне 2026 открыли склад в Мальмё', jd_text: null },
  ...over,
});

test('6d — числа письма должны встречаться в резюме, банке фактов или сигнале', () => {
  const clean = checkLetter(letter(), 'hypothesis', letterCtx());
  assert.equal(clean.filter(r => r.rule === 'number_consistency').length, 0, JSON.stringify(clean));

  const invented = letter({ body: letter().body.replace('40%', '73%') });
  assert.ok(checkLetter(invented, 'hypothesis', letterCtx())
    .some(r => r.rule === 'number_consistency' && r.level === 'block'));
});

test('6d — длина по ветке', () => {
  const short = checkLetter(letter(), 'vacancy', letterCtx());
  assert.ok(short.some(r => r.rule === 'length'), 'короткое письмо в ветке vacancy — warn');
  assert.equal(checkLetter(letter(), 'hypothesis', letterCtx()).filter(r => r.rule === 'length').length, 0);
});

test('6d — запрещённое начало', () => {
  const bad = letter({ body: 'Меня заинтересовала ваша вакансия в вашей компании.\n\nПредлагаю поговорить?' });
  assert.ok(checkLetter(bad, 'hypothesis', letterCtx()).some(r => r.rule === 'banned_opening'));
});

test('6d — ровно одна просьба в последнем абзаце', () => {
  const two = letter({ body: letter().body + ' И ещё: можем ли обсудить в четверг?' });
  const res = checkLetter(two, 'hypothesis', letterCtx());
  assert.ok(res.some(r => r.rule === 'single_ask'));
});

test('6d — стоп-лист: одно вхождение warn, три — block', () => {
  const one = checkStoplist('Я командный игрок', { language: 'ru' });
  assert.equal(one[0].level, 'warn');
  const three = checkStoplist('Командный игрок, нацеленность на результат, стрессоустойчивость', { language: 'ru' });
  assert.equal(three.length, 3);
  assert.ok(three.every(r => r.level === 'block'));
});

test('company_facts не ругается на сущности из опыта самого кандидата', () => {
  // «Мальмё» есть в сигнале, «Volvo» — в резюме кандидата: обе объяснимы.
  // А вот «Hermes» не встречается нигде — вот на неё и надо ругаться.
  const withOwn = letter({ body: letter().body + '\n\nВ Volvo я делала то же самое.' });
  const hits = checkLetter(withOwn, 'hypothesis', letterCtx()).filter(r => r.rule === 'company_facts');
  assert.equal(hits.filter(h => /Volvo/.test(h.message)).length, 0, 'Volvo есть в резюме кандидата');
  assert.equal(hits.filter(h => /Мальмё/.test(h.message)).length, 0, 'Мальмё есть в сигнале');

  const invented = letter({ body: letter().body + '\n\nВаша платформа Hermes впечатляет.' });
  assert.ok(checkLetter(invented, 'hypothesis', letterCtx())
    .some(r => r.rule === 'company_facts' && /Hermes/.test(r.message)));
});

test('письмо не касается неснятого блокера', () => {
  const analysis = {
    expectations: [], blockers: [{ kind: 'work_auth', detail: '', resolvable_by_profile: false }],
    score: 0, uvp: '', objection: null, reconstructed: false,
  } as Analysis;
  const bad = letter({ body: letter().body + '\n\nМне потребуется спонсорство визы.' });
  assert.ok(checkLetter(bad, 'hypothesis', letterCtx({ analysis })).some(r => r.rule === 'blocker_mentioned'));
});

test('6d — swap-тест: меньше двух сломанных предложений это block', () => {
  assert.ok(applySwapResult({ broken: ['одно'], generic: [] }).some(r => r.rule === 'swap_test' && r.level === 'block'));
  assert.equal(applySwapResult({ broken: ['одно', 'два'], generic: [] }).filter(r => r.level === 'block').length, 0);
  assert.ok(applySwapResult({ broken: ['a', 'b'], generic: ['пустая фраза'] }).some(r => r.rule === 'swap_generic'));
});

test('порог swap-теста берётся из конфига, а не из литерала', () => {
  const cfg = { ...DEFAULT_CONFIG, thresholds: { ...DEFAULT_CONFIG.thresholds, swapMinBroken: 1 } };
  assert.equal(applySwapResult({ broken: ['одно'], generic: [] }, cfg).filter(r => r.level === 'block').length, 0);
});

test('орфография без словаря честно сообщает, что не проверена', () => {
  const res = checkResume(resume(), ctx());
  assert.ok(res.some(r => r.rule === 'spelling' && /не проверена/.test(r.message)));
  const withDict = checkResume(resume(), ctx({ spellcheck: () => ['опечатка'] }));
  assert.ok(withDict.some(r => r.rule === 'spelling' && r.level === 'warn'));
});

test('worstLevel и canPresent', () => {
  assert.equal(worstLevel([{ rule: 'a', level: 'info', message: '' }, { rule: 'b', level: 'block', message: '' }]), 'block');
  assert.equal(worstLevel([]), 'ok');
  assert.equal(canPresent([{ rule: 'a', level: 'warn', message: '' }]), true);
});

test('namedEntities не выделяет первое слово предложения и служебные слова', () => {
  const ents = namedEntities('Компания растёт. В июне открыли Мальмё и Hermes.');
  assert.ok(ents.includes('Мальмё'));
  assert.ok(ents.includes('Hermes'));
  assert.ok(!ents.includes('Компания'));
});
