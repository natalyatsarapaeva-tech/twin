// Совпадение с местом (§10.4). Считает воркер, а не модель: у модели нет причин
// быть последовательной между вызовами, а число показывается пользователю и
// попадает в таблицу.
//
//   score = 100 × Σ(w·s) / Σ w,   w = 3 / 2 / 1  (must / important / nice)
//                                 s = 1 / 0.5 / 0 (strong / partial / gap)
//
// Жёсткий блокер НЕ обнуляет score, а выводится отдельным флагом: пользователь
// должен видеть «совпадение 78%, но блокер — язык», а не необъяснимые 30%.

import type { Expectation, Weight, Strength, Analysis } from './types.ts';

export const WEIGHT_VALUE: Record<Weight, number> = { must: 3, important: 2, nice: 1 };
export const STRENGTH_VALUE: Record<Strength, number> = { strong: 1, partial: 0.5, gap: 0 };

export function computeScore(expectations: Expectation[]): number {
  const list = expectations || [];
  let num = 0, den = 0;
  for (const e of list) {
    const w = WEIGHT_VALUE[e.weight] ?? 1;
    const s = STRENGTH_VALUE[e.strength] ?? 0;
    num += w * s;
    den += w;
  }
  if (den === 0) return 0;
  return Math.round((100 * num) / den);
}

export interface Coverage { closed: number; total: number; must: number; mustClosed: number }

/** «Ожидания: закрыто / всего» для карточки и колонки L таблицы (§11.2). */
export function coverage(expectations: Expectation[]): Coverage {
  const list = expectations || [];
  return {
    closed: list.filter(e => e.strength === 'strong').length,
    total: list.length,
    must: list.filter(e => e.weight === 'must').length,
    mustClosed: list.filter(e => e.weight === 'must' && e.strength === 'strong').length,
  };
}

/** Цвет колонки K таблицы и шкалы на карточке (§11.3): ≥70 зелёный, 40–69 жёлтый, <40 серый. */
export function scoreBand(score: number): 'good' | 'mid' | 'low' {
  if (score >= 70) return 'good';
  if (score >= 40) return 'mid';
  return 'low';
}

/** Пересчёт score внутри разбора — единственная точка, где он меняется. */
export function withRecomputedScore(analysis: Analysis): Analysis {
  return { ...analysis, score: computeScore(analysis.expectations) };
}
