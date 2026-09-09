// Терпимое извлечение JSON из ответа модели.
//
// Structured Outputs делает этот модуль редко нужным, но не лишним: §16 требует
// поведения на «OpenAI вернул невалидный JSON», а модель при деградации на
// младшую модель (§10.1) может обернуть ответ в ```-забор. Перенос приёма из
// twin-things (`catalog-core.js`) и Help_me_clean (`family-core.js`), где он
// отработал на тысячах вызовов: снять забор, при неудаче вырезать от первой
// скобки до последней. Функции никогда не бросают — возвращают пустое.

export function stripFences(text: string): string {
  return String(text ?? '')
    .replace(/^\s*```(?:json|JSON)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

export function parseJsonObject<T = Record<string, unknown>>(content: string): Partial<T> {
  const cleaned = stripFences(content);
  try {
    const v = JSON.parse(cleaned);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Partial<T>;
  } catch { /* падаем в вырезание */ }
  const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
  if (s !== -1 && e > s) {
    try {
      const v = JSON.parse(cleaned.slice(s, e + 1));
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Partial<T>;
    } catch { /* пусто */ }
  }
  return {};
}

export function parseJsonArray<T = unknown>(content: string): T[] {
  const cleaned = stripFences(content);
  try {
    const v = JSON.parse(cleaned);
    if (Array.isArray(v)) return v as T[];
  } catch { /* падаем в вырезание */ }
  const s = cleaned.indexOf('['), e = cleaned.lastIndexOf(']');
  if (s !== -1 && e > s) {
    try {
      const v = JSON.parse(cleaned.slice(s, e + 1));
      if (Array.isArray(v)) return v as T[];
    } catch { /* пусто */ }
  }
  return [];
}
