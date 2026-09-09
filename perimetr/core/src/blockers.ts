// Жёсткие блокеры и мягкие гэпы (§10.4).
//
// Несущая мысль ТЗ: «Правила воркера имеют приоритет над моделью». Модель
// предлагает блокеры, но решает эта таблица — потому что структурированные поля
// профиля дают однозначный ответ, а модель даёт правдоподобный. Отсюда же
// критерий приёмки 5b: добавили «German — C1» — блокер языка снялся БЕЗ нового
// вызова модели и без изменения score. Значит, снятие блокера обязано быть
// чистой функцией от (требование, профиль), и вот она.
//
// Закрытый список жёстких блокеров — шесть, других не бывает (§10.4).

import type {
  Blocker, BlockerKind, BridgeType, Cefr, Profile, Scale, Expectation, Analysis,
} from './types.ts';
import { CEFR_ORDER } from './types.ts';
import type { Thresholds } from './config.ts';
import { DEFAULT_THRESHOLDS } from './config.ts';
import { normalize } from './text.ts';

// ── Требования места ────────────────────────────────────────────────────────
// Извлекаются из jd_text моделью (§10.8) либо реконструируются по роли и стране.
export interface Demand {
  country?: string | null;
  /** Обязателен ли местный язык и какой минимум (§10.4). */
  language?: { lang: string; min: Cefr; mandatory: boolean } | null;
  /** Даёт ли работодатель спонсорство. null — в вакансии не сказано. */
  sponsorship_offered?: boolean | null;
  /** Требуемый масштаб: люди, менеджеры, бюджет. */
  scale?: { team?: number | null; managers?: number | null; budget?: number | null } | null;
  /** Роль — руководитель руководителей (§10.4, блокер no_people_mgmt). */
  manages_managers?: boolean;
  /** Роль допускает «lead without authority» — тогда гэп мягкий, а не жёсткий. */
  lead_without_authority?: boolean;
  /** Лицензия/сертификат: mandatory — юридически обязателен, иначе «желателен». */
  license?: { name: string; mandatory: boolean } | null;
  /** Верх вилки работодателя и низ ожиданий кандидата — обе в одной валюте. */
  salary_max?: number | null;
}

export interface BlockerVerdict extends Blocker {
  /** Правило, которое его выдало — чтобы интерфейс объяснил, а не просто покрасил. */
  rule: string;
  /** Поле профиля, ведущее к снятию (§3.3 «снять уточнением профиля»). */
  profile_field?: keyof Profile;
}

export interface SoftGap {
  kind: string;
  detail: string;
  bridge: BridgeType;
}

export interface GapVerdict {
  blockers: BlockerVerdict[];
  softGaps: SoftGap[];
}

const cefrIndex = (c?: Cefr | null): number => (c ? CEFR_ORDER.indexOf(c) : -1);

/** Уровень кандидата по языку; null — языка нет в профиле. */
export function levelOf(profile: Profile, lang: string): Cefr | null {
  const want = normalize(lang);
  const hit = (profile.languages || []).find(l => {
    const have = normalize(l.lang);
    return have === want || have.startsWith(want) || want.startsWith(have);
  });
  return hit ? hit.cefr : null;
}

/** Статус права на работу для региона; null — регион в профиле не заполнен. */
export function workAuthFor(profile: Profile, region?: string | null): 'citizen' | 'permit' | 'needs_sponsorship' | null {
  if (!region) return null;
  const want = normalize(region);
  const list = profile.work_auth || [];
  const exact = list.find(w => normalize(w.region) === want);
  if (exact) return exact.status;
  // «EU» покрывает страну ЕС, если она явно не переопределена.
  const eu = list.find(w => ['eu', 'ес', 'европа', 'european union'].includes(normalize(w.region)));
  return eu ? eu.status : null;
}

function ratio(required?: number | null, have?: number | null): number | null {
  if (!required || required <= 0) return null;
  if (have == null || have <= 0) return Infinity;   // масштаба нет вовсе
  return required / have;
}

function hasPeopleManagement(profile: Profile, scale?: Scale | null): boolean {
  const s = scale ?? profile.scale;
  if (!s) return false;
  return (s.team_max ?? 0) > 0 || (s.managers_max ?? 0) > 0;
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(from), b = new Date(to);
  if (isNaN(+a) || isNaN(+b)) return 0;
  return Math.max(0, Math.round((+b - +a) / (1000 * 60 * 60 * 24 * 30.44)));
}

/** Средний срок в роли, месяцы. null — дат недостаточно. */
export function averageTenureMonths(profile: Profile, now = new Date()): number | null {
  const roles = (profile.roles || []).filter(r => r.from);
  if (roles.length < 2) return null;
  const spans = roles.map(r => monthsBetween(r.from, r.to || now.toISOString().slice(0, 10)));
  const total = spans.reduce((a, b) => a + b, 0);
  return Math.round(total / roles.length);
}

/**
 * Главная функция: требование места × профиль → блокеры и мягкие гэпы.
 * Никакой модели, никакой сети. Именно её гоняет критерий приёмки 5b.
 */
export function evaluateGaps(
  demand: Demand,
  profile: Profile,
  th: Thresholds = DEFAULT_THRESHOLDS,
  now = new Date(),
): GapVerdict {
  const blockers: BlockerVerdict[] = [];
  const softGaps: SoftGap[] = [];

  // 1. Право на работу ------------------------------------------------------
  if (demand.country) {
    const status = workAuthFor(profile, demand.country);
    if (status === null) {
      blockers.push({
        kind: 'work_auth', rule: 'work_auth.unknown',
        detail: `Право на работу для страны «${demand.country}» в профиле не заполнено`,
        resolvable_by_profile: true, profile_field: 'work_auth',
      });
    } else if (status === 'needs_sponsorship' && demand.sponsorship_offered !== true) {
      blockers.push({
        kind: 'work_auth', rule: 'work_auth.needs_sponsorship',
        detail: demand.sponsorship_offered === false
          ? 'Нужно спонсорство, вакансия его не даёт'
          : 'Нужно спонсорство, в вакансии о нём не сказано',
        resolvable_by_profile: false, profile_field: 'work_auth',
      });
    }
  }

  // 2. Язык -----------------------------------------------------------------
  if (demand.language) {
    const { lang, min, mandatory } = demand.language;
    const have = levelOf(profile, lang);
    const haveIdx = cefrIndex(have);
    const minIdx = cefrIndex(min);
    if (haveIdx >= Math.max(minIdx, cefrIndex('C1'))) {
      // ≥ C1 и не ниже требуемого — гэпа нет.
    } else if (have === 'B2' || (haveIdx >= 0 && haveIdx >= minIdx - 1 && haveIdx >= cefrIndex('B2'))) {
      softGaps.push({
        kind: 'language', bridge: 'analogous_tools',
        detail: `${lang}: B2 против требуемого ${min}`,
      });
    } else if (mandatory) {
      blockers.push({
        kind: 'language', rule: have ? 'language.below_required' : 'language.absent',
        detail: have
          ? `${lang}: ${have}, требуется ${min} и язык обязателен`
          : `${lang} не указан в профиле, а роль его требует`,
        resolvable_by_profile: !have,   // языка нет в профиле — возможно, он есть у человека
        profile_field: 'languages',
      });
    } else {
      softGaps.push({
        kind: 'language', bridge: 'analogous_tools',
        detail: `${lang} ниже требуемого ${min}, но язык не обязателен`,
      });
    }
  }

  // 3. Масштаб --------------------------------------------------------------
  if (demand.scale) {
    const s = profile.scale;
    if (!s || (s.team_max == null && s.budget_max == null && s.managers_max == null)) {
      blockers.push({
        kind: 'scale', rule: 'scale.unknown',
        detail: 'Масштаб управления в профиле не заполнен — сравнить не с чем',
        resolvable_by_profile: true, profile_field: 'scale',
      });
    } else {
      const teamR = ratio(demand.scale.team, s.team_max);
      const mgrR = ratio(demand.scale.managers, s.managers_max);
      const budgetR = ratio(demand.scale.budget, s.budget_max);
      const hardTeam = (teamR != null && teamR >= th.scaleHardTeamRatio)
        || (mgrR != null && mgrR >= th.scaleHardTeamRatio);
      const hardBudget = budgetR != null && budgetR >= th.scaleHardBudgetRatio;
      if (hardTeam || hardBudget) {
        blockers.push({
          kind: 'scale', rule: hardBudget ? 'scale.budget_multiple' : 'scale.team_multiple',
          detail: hardBudget
            ? `Бюджет роли больше вашего максимума в ${Math.round(budgetR!)}×`
            : `Команда роли больше вашей в ${Math.round(Math.max(teamR ?? 0, mgrR ?? 0))}×`,
          resolvable_by_profile: false, profile_field: 'scale',
        });
      } else {
        const worst = Math.max(teamR ?? 0, mgrR ?? 0, budgetR ?? 0);
        if (worst > 1 && worst <= th.scaleSoftRatio) {
          softGaps.push({
            kind: 'scale', bridge: 'trajectory',
            detail: `Масштаб роли выше вашего примерно в ${worst.toFixed(1)}×`,
          });
        }
      }
    }
  }

  // 4. Управление людьми ----------------------------------------------------
  if (demand.manages_managers && !hasPeopleManagement(profile)) {
    if (demand.lead_without_authority) {
      softGaps.push({
        kind: 'no_people_mgmt', bridge: 'trajectory',
        detail: 'Роль допускает влияние без прямого подчинения',
      });
    } else {
      blockers.push({
        kind: 'no_people_mgmt', rule: 'people.absent',
        detail: 'Роль — руководитель руководителей, опыта управления людьми в профиле нет',
        resolvable_by_profile: !profile.scale, profile_field: 'scale',
      });
    }
  }

  // 5. Лицензия -------------------------------------------------------------
  if (demand.license?.mandatory) {
    blockers.push({
      kind: 'license', rule: 'license.mandatory',
      detail: `Требуется ${demand.license.name} — обязателен юридически или регуляторно`,
      resolvable_by_profile: true, profile_field: 'extras_text',
    });
  } else if (demand.license) {
    softGaps.push({
      kind: 'license', bridge: 'analogous_tools',
      detail: `${demand.license.name} желателен, но не обязателен`,
    });
  }

  // 6. Зарплата -------------------------------------------------------------
  const wantMin = parseSalaryFloor(profile.salary_range);
  if (demand.salary_max != null && wantMin != null && wantMin > demand.salary_max) {
    blockers.push({
      kind: 'salary', rule: 'salary.above_band',
      detail: `Ожидания от ${wantMin} выше верха вилки ${demand.salary_max}`,
      resolvable_by_profile: false, profile_field: 'salary_range',
    });
  }

  // 7. Прогрессия и связность (всегда, даже если вакансия молчит) ------------
  for (const g of profile.gaps || []) {
    const months = monthsBetween(g.from, g.to);
    if (months > th.gapSoftMonths && !String(g.reason || '').trim()) {
      softGaps.push({
        kind: 'career_gap', bridge: 'explained_gap',
        detail: `Перерыв ${g.from} — ${g.to} (${months} мес.) без указанной причины`,
      });
    }
  }
  const tenure = averageTenureMonths(profile, now);
  if (tenure != null && tenure < th.avgTenureMonths) {
    softGaps.push({
      kind: 'job_hopping', bridge: 'grouped_roles',
      detail: `Средний срок в роли ${tenure} мес. — ниже ${th.avgTenureMonths}`,
    });
  }

  return { blockers, softGaps };
}

/** Нижняя граница зарплатных ожиданий из свободной строки («8000–9500 EUR» → 8000). */
export function parseSalaryFloor(range: string): number | null {
  const nums = String(range ?? '').match(/\d[\d\s ]*/g);
  if (!nums || !nums.length) return null;
  const first = Number(nums[0].replace(/[\s ]/g, ''));
  return Number.isFinite(first) && first > 0 ? first : null;
}

/**
 * Сверка блокеров модели с правилами (§10.4). Правила главнее:
 *  — блокер, который правила не подтверждают, удаляется;
 *  — блокер, который правила видят, добавляется, даже если модель промолчала;
 *  — снятые пользователем (`resolved`) сохраняют пометку.
 * Вызывается и после генерации, и при каждой правке профиля — без обращения к модели.
 */
export function reconcileBlockers(
  modelBlockers: Blocker[] | undefined,
  demand: Demand,
  profile: Profile,
  th: Thresholds = DEFAULT_THRESHOLDS,
  now = new Date(),
): BlockerVerdict[] {
  const { blockers } = evaluateGaps(demand, profile, th, now);
  const byKind = new Map<BlockerKind, BlockerVerdict>();
  for (const b of blockers) byKind.set(b.kind, b);

  // Блокеры модели, которых правила не знают, но и опровергнуть не могут:
  // license и salary модель видит в тексте вакансии раньше, чем структура профиля.
  for (const m of modelBlockers || []) {
    if (byKind.has(m.kind)) {
      if (m.resolved) byKind.get(m.kind)!.resolved = true;
      continue;
    }
    const ruleCovers = coveredByRules(m.kind, demand);
    if (!ruleCovers) {
      byKind.set(m.kind, {
        ...m, rule: `model.${m.kind}`,
        resolvable_by_profile: m.resolvable_by_profile ?? false,
      });
    }
    // ruleCovers && !byKind.has → правила посмотрели и блокера не нашли: удаляем.
  }
  return [...byKind.values()];
}

/** Знают ли правила про это измерение при данном требовании (иначе слово за моделью). */
function coveredByRules(kind: BlockerKind, demand: Demand): boolean {
  switch (kind) {
    case 'work_auth': return !!demand.country;
    case 'language': return !!demand.language;
    case 'scale': return !!demand.scale;
    case 'no_people_mgmt': return demand.manages_managers === true;
    case 'license': return demand.license != null;
    case 'salary': return demand.salary_max != null;
    default: return false;
  }
}

/**
 * Пересборка разбора после правки профиля (§3.3, критерий 5b).
 * Меняются только блокеры; ожидания и score не трогаются — они про содержание
 * опыта, а не про структурированные поля.
 */
export function reanalyseAfterProfileChange(
  analysis: Analysis,
  demand: Demand,
  profile: Profile,
  th: Thresholds = DEFAULT_THRESHOLDS,
): Analysis {
  return { ...analysis, blockers: reconcileBlockers(analysis.blockers, demand, profile, th) };
}

/** Тип моста для мягкого гэпа (§10.4). Единственная таблица соответствий. */
export const BRIDGE_FOR_GAP: Record<string, BridgeType> = {
  industry_switch: 'transferable_metrics',
  domain_switch: 'transferable_metrics',
  scale: 'trajectory',
  career_gap: 'explained_gap',
  job_hopping: 'grouped_roles',
  overqualification: 'deliberate_choice',
  tools: 'analogous_tools',
  language: 'analogous_tools',
  license: 'analogous_tools',
  relocation: 'relocation_ready',
  years: 'results_over_years',
  no_people_mgmt: 'trajectory',
};

/** Есть ли неснятый жёсткий блокер — карточка показывает его первым (§3.3). */
export function hasUnresolvedBlocker(blockers: Blocker[] | undefined): boolean {
  return (blockers || []).some(b => !b.resolved);
}

/** Ожидания, ставшие `gap` из-за неподтверждённого source_hint (§10.4, антигаллюцинация). */
export function demoteUnverified(
  expectations: Expectation[],
  verify: (hint: string, factId: string | null) => boolean,
): Expectation[] {
  return (expectations || []).map(e => {
    if (e.strength === 'gap') return e;
    if (verify(e.source_hint, e.fact_id)) return e;
    return {
      ...e,
      strength: 'gap' as const,
      gap_class: e.gap_class ?? 'soft',
      evidence: e.evidence,
      gap_answer: e.gap_answer || 'Не подтверждено профилем',
    };
  });
}
