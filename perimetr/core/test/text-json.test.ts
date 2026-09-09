import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize, wordCount, sameStem, findPhrase, containsPhrase, sourceHintFound,
  levenshteinRatio, hasNumber, extractNumbers, sentences, paragraphs,
  stripFences, parseJsonObject, parseJsonArray,
} from '../src/index.ts';

test('нормализация: регистр, ё, пунктуация', () => {
  assert.equal(normalize('  Ёлка,  ПРИВЕТ! '), 'елка привет');
  assert.equal(wordCount('one two   three'), 3);
});

test('словоформы: «игрок» ловит «игроком», но не чужое слово', () => {
  assert.ok(sameStem('игрок', 'игроком'));
  assert.ok(sameStem('результат', 'результате'));
  assert.ok(!sameStem('результат', 'резюме'));
  assert.ok(!sameStem('ход', 'ходатайство'), 'короткая основа не должна ловить всё подряд');
});

test('стоп-фраза находится с учётом словоформ', () => {
  assert.ok(containsPhrase('Я командный игрок и лидер', 'командный игрок'));
  assert.ok(containsPhrase('считаю себя командным игроком', 'командный игрок'));
  assert.ok(containsPhrase('I have a proven track record of delivery', 'proven track record'));
  assert.ok(!containsPhrase('я работаю в команде', 'командный игрок'));
  assert.equal(findPhrase('раз два командный игрок', 'командный игрок'), 2);
});

test('source_hint ищется с допуском 30% — модель цитирует по памяти', () => {
  const resume = 'Вырастил команду из 25 человек в трёх странах и сократил срок поставки на 40%';
  assert.ok(sourceHintFound(resume, 'команду из 25 человек'));
  assert.ok(sourceHintFound(resume, 'команда из 25 человек в трёх странах'));
  assert.ok(!sourceHintFound(resume, 'привлёк инвестиции серии B'));
});

test('числа: извлечение и нормализация разрядов', () => {
  assert.ok(hasNumber('сократил на 40%'));
  assert.ok(!hasNumber('сократил срок поставки'));
  assert.deepEqual(extractNumbers('вырос с 1 200 до 3,5 млн за 2024'), ['1200', '3.5', '2024']);
});

test('предложения и абзацы', () => {
  assert.equal(sentences('Раз. Два! Три?').length, 3);
  assert.equal(paragraphs('a\n\nb\n\n\nc').length, 3);
});

test('levenshteinRatio', () => {
  assert.equal(levenshteinRatio('abc', 'abc'), 0);
  assert.ok(levenshteinRatio('VP Product', 'VP Products') < 0.2);
});

test('JSON: заборы, мусор вокруг, полный провал', () => {
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject('Вот ответ: {"a":1} — готово'), { a: 1 });
  assert.deepEqual(parseJsonObject('совсем не json'), {});
  assert.deepEqual(parseJsonArray('```\n[1,2]\n```'), [1, 2]);
  assert.deepEqual(parseJsonArray('{}'), []);
  assert.equal(stripFences('```json\n{}\n```'), '{}');
});

test('парсеры никогда не бросают', () => {
  for (const bad of ['', '{', '[', 'null', 'undefined', '{"a":']) {
    assert.doesNotThrow(() => parseJsonObject(bad));
    assert.doesNotThrow(() => parseJsonArray(bad));
  }
});
