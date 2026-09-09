// Текстовые примитивы ядра: нормализация, поиск с учётом словоформ, счёт слов,
// расстояние Левенштейна. Чистые функции, ни одной зависимости.

/** Нижний регистр, ё→е, любые пробелы/пунктуация → один пробел. */
export function normalize(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[^\p{L}\p{N}'@.%-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

export function wordCount(s: string): number {
  return words(s).length;
}

/**
 * Совпадение двух слов «с учётом словоформ» (Приложение Б требует именно этого).
 * Полноценной морфологии здесь нет и не нужно: стоп-лист — это фразы, и для них
 * достаточно общей основы. Два слова считаются одним, если одно является
 * префиксом другого и общая часть не короче порога — так «игрок» ловит
 * «игроком», а «результат» не ловит «резюме».
 */
export function sameStem(a: string, b: string, minStem = 4, maxEnding = 4): boolean {
  if (a === b) return true;
  // Сравниваем по ОБЩЕМУ префиксу, а не по вхождению: «командный» и «командным»
  // не являются префиксами друг друга, но основа у них одна. Слова короче
  // minStem сравниваются только точно — иначе «ход» поймает «ходатайство».
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  if (i < minStem) return false;
  // Оба остатка должны быть окончаниями, а не вторыми словами.
  return (a.length - i) <= maxEnding && (b.length - i) <= maxEnding;
}

/** Встречается ли фраза в тексте с учётом словоформ. Возвращает позицию слова или -1. */
export function findPhrase(text: string, phrase: string, minStem = 4): number {
  const hay = words(text);
  const needle = words(phrase);
  if (!needle.length || needle.length > hay.length) return -1;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (!sameStem(hay[i + j], needle[j], minStem)) continue outer;
    }
    return i;
  }
  return -1;
}

export function containsPhrase(text: string, phrase: string, minStem = 4): boolean {
  return findPhrase(text, phrase, minStem) !== -1;
}

/**
 * Проверка `source_hint` (§10.4, антигаллюцинация): цитата 3–8 слов должна
 * встречаться в тексте профиля. Допускается расхождение до `tolerance` — модель
 * цитирует по памяти и путает предлоги, но не выдумывает достижение целиком.
 * Сравниваем долю слов подсказки, найденных в тексте подряд идущим окном.
 */
export function sourceHintFound(haystack: string, hint: string, tolerance = 0.3): boolean {
  const needle = words(hint);
  if (!needle.length) return false;
  const hay = words(haystack);
  if (!hay.length) return false;
  const need = Math.max(1, Math.ceil(needle.length * (1 - tolerance)));
  // Окно длиной с подсказку скользит по тексту; считаем совпадения по основам.
  const win = needle.length;
  for (let i = 0; i + 1 <= hay.length; i++) {
    let hits = 0;
    const slice = hay.slice(i, i + win);
    const used = new Set<number>();
    for (const w of needle) {
      for (let k = 0; k < slice.length; k++) {
        if (used.has(k)) continue;
        if (sameStem(slice[k], w)) { used.add(k); hits++; break; }
      }
    }
    if (hits >= need) return true;
  }
  return false;
}

/** Расстояние Левенштейна, нормализованное к длине (0 — совпадение, 1 — ничего общего). */
export function levenshtein(a: string, b: string): number {
  const s = normalize(a), t = normalize(b);
  if (s === t) return 0;
  if (!s.length || !t.length) return Math.max(s.length, t.length);
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[t.length];
}

export function levenshteinRatio(a: string, b: string): number {
  const s = normalize(a), t = normalize(b);
  const max = Math.max(s.length, t.length);
  return max === 0 ? 0 : levenshtein(s, t) / max;
}

/** Содержит ли строка число (§10.10 «квантификация»). Проценты, деньги, «×2», «3 года». */
export function hasNumber(s: string): boolean {
  return /\d/.test(String(s ?? ''));
}

/** Все числа строки — для сверки «письмо ↔ резюме» (§10.10). */
export function extractNumbers(s: string): string[] {
  const out = String(s ?? '').match(/\d[\d\s.,]*\d|\d/g) || [];
  // Нормализуем разделители разрядов и десятичную запятую: 1 200 → 1200, 3,5 → 3.5
  return out.map(n => n.replace(/[\s ]/g, '').replace(/,(\d)/g, '.$1').replace(/\.$/, ''))
    .filter(n => n.length > 0);
}

/** Разбиение на предложения — грубое, но достаточное для §10.10. */
export function sentences(s: string): string[] {
  return String(s ?? '')
    .split(/(?<=[.!?…])\s+(?=[A-ZА-ЯÅÄÖ0-9«"'(])/u)
    .map(x => x.trim())
    .filter(Boolean);
}

export function paragraphs(s: string): string[] {
  return String(s ?? '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
}
