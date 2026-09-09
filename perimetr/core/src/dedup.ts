// Дедупликация мест (§7, §10.8): `company_key` + похожая роль.
//
// company_key = нижний регистр, без юридических форм, без пунктуации.
// Совпадение company_key + расстояние Левенштейна по роли < 0.2 — дубль.

import { normalize, levenshteinRatio } from './text.ts';

/** Юридические формы, которые не отличают компанию от неё же (§7). */
export const LEGAL_FORMS = [
  'ab', 'as', 'asa', 'oy', 'oyj', 'a/s', 'aps', 'bv', 'b.v.', 'nv', 'n.v.',
  'gmbh', 'mbh', 'ag', 'kg', 'gmbh & co kg', 'ug', 'se',
  'ltd', 'limited', 'llc', 'llp', 'plc', 'inc', 'incorporated', 'corp', 'corporation', 'co',
  'sa', 's.a.', 'sas', 'sarl', 'srl', 'spa', 's.p.a.', 'bvba', 'sp z oo', 'sp. z o.o.',
  'ооо', 'оао', 'зао', 'пао', 'ип', 'ао',
  'group', 'holding', 'holdings', 'international',
];

const LEGAL_SET = new Set(LEGAL_FORMS.map(normalize));

export function companyKey(name: string): string {
  const parts = normalize(name)
    .replace(/[.,]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .filter(w => !LEGAL_SET.has(w) && w !== '&');
  // Все слова оказались юрформой («Group Ltd») — тогда не выбрасываем ничего.
  const kept = parts.length ? parts : normalize(name).split(' ').filter(Boolean);
  return kept.join('-');
}

export const ROLE_SIMILARITY_MAX = 0.2;

export function rolesSimilar(a: string, b: string, max = ROLE_SIMILARITY_MAX): boolean {
  return levenshteinRatio(a, b) < max;
}

export interface DedupCandidate { id: string; company_key: string; role_title: string }

/**
 * Ищет существующее место, которое считается тем же самым. Возвращает id или null.
 * §10.8: найденный дубль не создаётся заново, а дополняется текстом вакансии —
 * решение принимает вызывающий код, задача этой функции только опознать.
 */
export function findDuplicate(
  candidate: { company: string; role_title: string },
  existing: DedupCandidate[],
  max = ROLE_SIMILARITY_MAX,
): string | null {
  const key = companyKey(candidate.company);
  for (const e of existing || []) {
    if (e.company_key !== key) continue;
    if (rolesSimilar(e.role_title, candidate.role_title, max)) return e.id;
  }
  return null;
}
