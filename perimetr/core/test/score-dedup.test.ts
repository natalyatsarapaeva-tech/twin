import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeScore, coverage, scoreBand, companyKey, rolesSimilar, findDuplicate,
} from '../src/index.ts';
import type { Expectation } from '../src/types.ts';

const e = (weight: Expectation['weight'], strength: Expectation['strength']): Expectation => ({
  expectation: 'x', weight, evidence: '', fact_id: null, source_hint: '',
  strength, gap_class: strength === 'gap' ? 'soft' : null, bridge: null, gap_answer: '',
});

test('score = 100 × Σ(w·s) / Σ w', () => {
  // must strong (3·1) + important partial (2·0.5) + nice gap (1·0) = 4 из 6 → 67
  assert.equal(computeScore([e('must', 'strong'), e('important', 'partial'), e('nice', 'gap')]), 67);
  assert.equal(computeScore([e('must', 'strong'), e('must', 'strong')]), 100);
  assert.equal(computeScore([e('must', 'gap')]), 0);
  assert.equal(computeScore([]), 0, 'пустые ожидания не делят на ноль');
});

test('жёсткий блокер не участвует в score — он отдельный флаг', () => {
  const exp = [e('must', 'strong'), e('must', 'strong'), e('important', 'partial')];
  const s = computeScore(exp);
  assert.ok(s >= 70, `${s} — блокер не должен ронять совпадение`);
});

test('coverage и полосы', () => {
  const c = coverage([e('must', 'strong'), e('must', 'gap'), e('nice', 'strong')]);
  assert.deepEqual(c, { closed: 2, total: 3, must: 2, mustClosed: 1 });
  assert.equal(scoreBand(70), 'good');
  assert.equal(scoreBand(69), 'mid');
  assert.equal(scoreBand(39), 'low');
});

test('company_key снимает регистр, пунктуацию и юрформы', () => {
  assert.equal(companyKey('Volvo Group AB'), 'volvo');
  assert.equal(companyKey('volvo ab'), 'volvo');
  assert.equal(companyKey('ООО «Яндекс»'), 'яндекс');
  assert.equal(companyKey('Acme, Inc.'), 'acme');
  assert.equal(companyKey('Siemens GmbH & Co KG'), 'siemens');
  assert.equal(companyKey('Klarna Bank AB'), 'klarna-bank');
});

test('company_key не схлопывает компанию в пустоту', () => {
  assert.ok(companyKey('Holding Group Ltd').length > 0);
});

test('дедуп по компании + похожей роли', () => {
  const existing = [{ id: 'o1', company_key: 'volvo', role_title: 'VP Product' }];
  assert.equal(findDuplicate({ company: 'Volvo AB', role_title: 'VP Product' }, existing), 'o1');
  assert.equal(findDuplicate({ company: 'Volvo AB', role_title: 'VP  Product' }, existing), 'o1');
  assert.equal(findDuplicate({ company: 'Volvo AB', role_title: 'Head of Logistics' }, existing), null);
  assert.equal(findDuplicate({ company: 'Scania', role_title: 'VP Product' }, existing), null);
});

test('rolesSimilar — порог 0.2 по нормализованному названию', () => {
  assert.ok(rolesSimilar('VP Product', 'VP Products'));
  assert.ok(!rolesSimilar('VP Product', 'VP Engineering'));
});
