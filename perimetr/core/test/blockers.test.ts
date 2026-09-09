// Критерий приёмки 5b целиком и правила §10.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGaps, reconcileBlockers, reanalyseAfterProfileChange,
  levelOf, workAuthFor, averageTenureMonths, parseSalaryFloor,
  computeScore, type Demand,
} from '../src/index.ts';
import type { Profile, Analysis } from '../src/types.ts';

const emptyProfile = (over: Partial<Profile> = {}): Profile => ({
  resume_text: '', extras_text: '', perimeter: '', industries: '', exclude: '',
  geo: '', breadth: 'medium', languages: [], work_auth: [], relocation: null,
  scale: null, years_exp: null, gaps: [], salary_range: '', linkedin_url: '',
  linkedin_complete: false, photo_policy: 'auto', roles: [], ...over,
});

const germanDemand: Demand = {
  country: 'Germany',
  language: { lang: 'German', min: 'C1', mandatory: true },
  sponsorship_offered: null,
};

test('5b — требование свободного немецкого при отсутствии немецкого даёт блокер language', () => {
  const p = emptyProfile({
    work_auth: [{ region: 'Germany', status: 'citizen' }],
    languages: [{ lang: 'English', cefr: 'C2' }],
  });
  const { blockers } = evaluateGaps(germanDemand, p);
  const lang = blockers.find(b => b.kind === 'language');
  assert.ok(lang, 'блокер language должен быть');
  assert.equal(lang!.rule, 'language.absent');
  assert.equal(lang!.resolvable_by_profile, true, 'снимается уточнением профиля');
});

test('5b — после добавления «German C1» блокер снимается, score не меняется, модель не вызывается', () => {
  const before = emptyProfile({
    work_auth: [{ region: 'Germany', status: 'citizen' }],
    languages: [{ lang: 'English', cefr: 'C2' }],
  });
  const analysis: Analysis = {
    expectations: [
      { expectation: 'вести команду 20+', weight: 'must', evidence: 'вёл 25', fact_id: 'f1',
        source_hint: 'команда из 25 человек', strength: 'strong', gap_class: null, bridge: null, gap_answer: '' },
      { expectation: 'опыт в логистике', weight: 'important', evidence: 'частично', fact_id: null,
        source_hint: 'логистический оператор', strength: 'partial', gap_class: null, bridge: null, gap_answer: '' },
    ],
    blockers: [{ kind: 'language', detail: 'нет немецкого', resolvable_by_profile: true }],
    score: 0, uvp: '', objection: null, reconstructed: false,
  };
  analysis.score = computeScore(analysis.expectations);
  const scoreBefore = analysis.score;

  const withBlocker = reanalyseAfterProfileChange(analysis, germanDemand, before);
  assert.equal(withBlocker.blockers.filter(b => b.kind === 'language').length, 1);

  const after = emptyProfile({
    work_auth: [{ region: 'Germany', status: 'citizen' }],
    languages: [{ lang: 'English', cefr: 'C2' }, { lang: 'German', cefr: 'C1' }],
  });
  const cleared = reanalyseAfterProfileChange(analysis, germanDemand, after);
  assert.equal(cleared.blockers.filter(b => b.kind === 'language').length, 0, 'блокер снят');
  assert.equal(cleared.score, scoreBefore, 'score не изменился');
  assert.deepEqual(cleared.expectations, analysis.expectations, 'ожидания не тронуты');
});

test('B2 по требуемому языку — мягкий гэп, а не блокер', () => {
  const p = emptyProfile({
    work_auth: [{ region: 'Germany', status: 'citizen' }],
    languages: [{ lang: 'German', cefr: 'B2' }],
  });
  const { blockers, softGaps } = evaluateGaps(germanDemand, p);
  assert.equal(blockers.filter(b => b.kind === 'language').length, 0);
  assert.ok(softGaps.some(g => g.kind === 'language'));
});

test('5b — право на работу: аналогично языку', () => {
  const needs = emptyProfile({ work_auth: [{ region: 'Germany', status: 'needs_sponsorship' }] });
  assert.ok(evaluateGaps({ country: 'Germany', sponsorship_offered: false }, needs)
    .blockers.some(b => b.kind === 'work_auth'));

  const permit = emptyProfile({ work_auth: [{ region: 'Germany', status: 'permit' }] });
  assert.equal(evaluateGaps({ country: 'Germany', sponsorship_offered: false }, permit)
    .blockers.filter(b => b.kind === 'work_auth').length, 0);

  // Поле не заполнено — блокер есть, но помечен как снимаемый профилем.
  const unknown = emptyProfile();
  const b = evaluateGaps({ country: 'Germany' }, unknown).blockers.find(x => x.kind === 'work_auth');
  assert.ok(b && b.resolvable_by_profile);
});

test('«EU» в профиле покрывает страну ЕС', () => {
  const p = emptyProfile({ work_auth: [{ region: 'EU', status: 'citizen' }] });
  assert.equal(workAuthFor(p, 'Germany'), 'citizen');
});

test('5b — масштаб: ≤2× мягкий, ≥3× по команде жёсткий, ≥10× по бюджету жёсткий', () => {
  const p = emptyProfile({ scale: { team_max: 10, budget_max: 1_000_000 } });
  const soft = evaluateGaps({ scale: { team: 18 } }, p);
  assert.equal(soft.blockers.filter(b => b.kind === 'scale').length, 0);
  assert.ok(soft.softGaps.some(g => g.kind === 'scale'));

  const hardTeam = evaluateGaps({ scale: { team: 40 } }, p);
  assert.ok(hardTeam.blockers.some(b => b.rule === 'scale.team_multiple'));

  const hardBudget = evaluateGaps({ scale: { budget: 12_000_000 } }, p);
  assert.ok(hardBudget.blockers.some(b => b.rule === 'scale.budget_multiple'));
});

test('руководитель руководителей без опыта управления — жёсткий; lead without authority — мягкий', () => {
  const ic = emptyProfile({ scale: { team_max: 0 } });
  assert.ok(evaluateGaps({ manages_managers: true }, ic).blockers.some(b => b.kind === 'no_people_mgmt'));
  const lenient = evaluateGaps({ manages_managers: true, lead_without_authority: true }, ic);
  assert.equal(lenient.blockers.filter(b => b.kind === 'no_people_mgmt').length, 0);
  assert.ok(lenient.softGaps.some(g => g.kind === 'no_people_mgmt'));
});

test('лицензия: обязательная — жёсткий, желательная — мягкий', () => {
  const p = emptyProfile();
  assert.ok(evaluateGaps({ license: { name: 'CPA', mandatory: true } }, p).blockers.some(b => b.kind === 'license'));
  const soft = evaluateGaps({ license: { name: 'CPA', mandatory: false } }, p);
  assert.equal(soft.blockers.filter(b => b.kind === 'license').length, 0);
  assert.ok(soft.softGaps.some(g => g.kind === 'license'));
});

test('зарплата выше верха вилки — жёсткий блокер', () => {
  const p = emptyProfile({ salary_range: '9500–11000 EUR' });
  assert.equal(parseSalaryFloor(p.salary_range), 9500);
  assert.ok(evaluateGaps({ salary_max: 8000 }, p).blockers.some(b => b.kind === 'salary'));
  assert.equal(evaluateGaps({ salary_max: 12000 }, p).blockers.filter(b => b.kind === 'salary').length, 0);
});

test('перерыв > 12 мес. без причины и частые переходы — мягкие гэпы с нужным мостом', () => {
  const p = emptyProfile({
    gaps: [{ from: '2021-01-01', to: '2022-06-01' }],
    roles: [
      { role_title: 'Head of Ops', from: '2023-01-01', to: '2024-01-01' },
      { role_title: 'Ops Manager', from: '2021-06-01', to: '2022-06-01' },
    ],
  });
  const { softGaps } = evaluateGaps({}, p, undefined, new Date('2026-09-09'));
  assert.equal(softGaps.find(g => g.kind === 'career_gap')?.bridge, 'explained_gap');
  assert.equal(softGaps.find(g => g.kind === 'job_hopping')?.bridge, 'grouped_roles');
});

test('перерыв с причиной мягкого гэпа не даёт', () => {
  const p = emptyProfile({ gaps: [{ from: '2021-01-01', to: '2022-06-01', reason: 'учёба' }] });
  assert.equal(evaluateGaps({}, p).softGaps.filter(g => g.kind === 'career_gap').length, 0);
});

test('правила главнее модели: непойманный правилами блокер удаляется, ненайденный моделью — добавляется', () => {
  const p = emptyProfile({ languages: [{ lang: 'German', cefr: 'C2' }], work_auth: [{ region: 'Germany', status: 'citizen' }] });
  // Модель выдумала языковой блокер — правила его снимают.
  const out = reconcileBlockers(
    [{ kind: 'language', detail: 'кажется, немецкого нет', resolvable_by_profile: false }],
    germanDemand, p,
  );
  assert.equal(out.filter(b => b.kind === 'language').length, 0);

  // Модель промолчала про масштаб — правила добавляют.
  const small = emptyProfile({ scale: { team_max: 3 } });
  const out2 = reconcileBlockers([], { scale: { team: 30 } }, small);
  assert.ok(out2.some(b => b.kind === 'scale'));
});

test('блокер, которого правила не покрывают, остаётся от модели', () => {
  const p = emptyProfile();
  const out = reconcileBlockers(
    [{ kind: 'license', detail: 'нужен допуск', resolvable_by_profile: false }],
    {},          // требование про лицензию не передано — правила молчат
    p,
  );
  assert.ok(out.some(b => b.kind === 'license'));
});

test('levelOf и средний срок в роли', () => {
  const p = emptyProfile({
    languages: [{ lang: 'Swedish', cefr: 'B1' }],
    roles: [
      { role_title: 'A', from: '2020-01-01', to: '2024-01-01' },
      { role_title: 'B', from: '2016-01-01', to: '2020-01-01' },
    ],
  });
  assert.equal(levelOf(p, 'swedish'), 'B1');
  assert.equal(levelOf(p, 'Danish'), null);
  assert.equal(averageTenureMonths(p), 48);
});
