// JSON-схемы Structured Outputs (§10.2: strict: true, парсинг руками не допускается).
// Схема задаёт ФОРМУ; закрытые списки и существование id проверяет санитайз в ядре.

const s = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const obj = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: 'object', properties, required, additionalProperties: false });

export const ANALYSE_SCHEMA = {
  name: 'analysis',
  schema: obj({
    expectations: {
      type: 'array', minItems: 5, maxItems: 7,
      items: obj({
        expectation: s(), weight: { type: 'string', enum: ['must', 'important', 'nice'] },
        evidence: s(), fact_id: { type: ['string', 'null'] },
        source_hint: s('дословная цитата 3–8 слов из профиля'),
        strength: { type: 'string', enum: ['strong', 'partial', 'gap'] },
        gap_class: { type: ['string', 'null'], enum: ['hard', 'soft', null] },
        bridge: {
          type: ['string', 'null'],
          enum: ['transferable_metrics', 'trajectory', 'explained_gap', 'grouped_roles',
            'deliberate_choice', 'analogous_tools', 'relocation_ready', 'results_over_years', null],
        },
        gap_answer: s(),
      }, ['expectation', 'weight', 'evidence', 'fact_id', 'source_hint', 'strength', 'gap_class', 'bridge', 'gap_answer']),
    },
    blockers: {
      type: 'array',
      items: obj({
        kind: { type: 'string', enum: ['work_auth', 'license', 'language', 'no_people_mgmt', 'scale', 'salary'] },
        detail: s(), resolvable_by_profile: { type: 'boolean' },
      }, ['kind', 'detail', 'resolvable_by_profile']),
    },
    uvp: s(),
    objection: obj({ risk: s(), answer: s() }, ['risk', 'answer']),
    reconstructed: { type: 'boolean' },
  }, ['expectations', 'blockers', 'uvp', 'objection', 'reconstructed']),
};

export const AUDIT_SCHEMA = {
  name: 'profile_audit',
  schema: obj({
    facts: {
      type: 'array',
      items: obj({
        company: s(), role_title: s(), period_from: s(), period_to: s(),
        action: s(), how: s(), result: s(),
        metric_value: { type: ['number', 'null'] }, metric_unit: s(),
        scale_tags: { type: 'array', items: { type: 'string', enum: ['team', 'managers', 'budget', 'pnl', 'geo', 'users'] } },
        domain_tags: { type: 'array', items: s() },
        source_hint: s('дословная цитата 3–8 слов'),
      }, ['company', 'role_title', 'period_from', 'period_to', 'action', 'how', 'result',
        'metric_value', 'metric_unit', 'scale_tags', 'domain_tags', 'source_hint']),
    },
    roles: {
      type: 'array',
      items: obj({ company: s(), role_title: s(), from: s(), to: s() }, ['company', 'role_title', 'from', 'to']),
    },
    questions: {
      type: 'array',
      items: obj({ about: s('к какому факту вопрос'), question: s() }, ['about', 'question']),
    },
    recommendations: { type: 'array', items: s('текстовая рекомендация поверх метрик') },
  }, ['facts', 'roles', 'questions', 'recommendations']),
};

export const RESUME_SCHEMA = {
  name: 'resume',
  schema: obj({
    headline: s(),
    summary: { type: 'array', maxItems: 3, items: s() },
    summary_support: { type: 'array', items: { type: ['integer', 'null'] } },
    facts_line: s(),
    competencies: { type: 'array', minItems: 6, maxItems: 10, items: s() },
    experience: {
      type: 'array',
      items: obj({
        company: s(), role_title: s(), period_from: s(), period_to: s(),
        context_line: s('масштаб: команда, менеджеры, бюджет/P&L, география'),
        bullets: { type: 'array', items: s() },
        condensed: { type: 'boolean' },
      }, ['company', 'role_title', 'period_from', 'period_to', 'context_line', 'bullets', 'condensed']),
    },
    education: { type: 'array', items: s() },
    facts_used: { type: 'array', items: s() },
  }, ['headline', 'summary', 'summary_support', 'facts_line', 'competencies', 'experience', 'education', 'facts_used']),
};

export const LETTER_SCHEMA = {
  name: 'letter',
  schema: obj({
    subject: s('конкретная и короткая, без «Application for»'),
    body: s(),
    bridge_used: {
      type: ['string', 'null'],
      enum: ['transferable_metrics', 'trajectory', 'explained_gap', 'grouped_roles',
        'deliberate_choice', 'analogous_tools', 'relocation_ready', 'results_over_years', null],
    },
    facts_used: { type: 'array', items: s() },
  }, ['subject', 'body', 'bridge_used', 'facts_used']),
};

export const INGEST_SCHEMA = {
  name: 'job_posting',
  schema: obj({
    company: s(), role_title: s(), city: s(), country: s(), industry: s(), size: s(),
    language: s(), seniority: s(),
    requirements: { type: 'array', items: s() },
    responsibilities: { type: 'array', items: s() },
    contact_email: s(), salary: s(), posted_date: s(),
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    is_job_posting: { type: 'boolean' },
    // Требования места для правил блокеров (§10.4) — извлекаются вместе со структурой.
    demand: obj({
      language_required: s('язык и минимальный уровень, если требуется'),
      language_mandatory: { type: 'boolean' },
      sponsorship_offered: { type: ['boolean', 'null'] },
      team_size: { type: ['number', 'null'] },
      budget: { type: ['number', 'null'] },
      manages_managers: { type: 'boolean' },
      lead_without_authority: { type: 'boolean' },
      license_required: s(), license_mandatory: { type: 'boolean' },
      salary_max: { type: ['number', 'null'] },
    }, ['language_required', 'language_mandatory', 'sponsorship_offered', 'team_size', 'budget',
      'manages_managers', 'lead_without_authority', 'license_required', 'license_mandatory', 'salary_max']),
  }, ['company', 'role_title', 'city', 'country', 'industry', 'size', 'language', 'seniority',
    'requirements', 'responsibilities', 'contact_email', 'salary', 'posted_date',
    'confidence', 'is_job_posting', 'demand']),
};

export const DISCOVER_SCHEMA = {
  name: 'discovered_places',
  schema: obj({
    items: {
      type: 'array',
      items: obj({
        company: s(), website: s(), industry: s(), city: s(), country: s(), size: s(),
        kind: { type: 'string', enum: ['vacancy', 'hypothesis'] },
        role_title: s(), signal: s(), signal_date: s(), source_url: s(), why_fit: s(),
        contact: obj({ name: s(), title: s(), email: s(), linkedin: s() }, ['name', 'title', 'email', 'linkedin']),
      }, ['company', 'website', 'industry', 'city', 'country', 'size', 'kind',
        'role_title', 'signal', 'signal_date', 'source_url', 'why_fit', 'contact']),
    },
  }, ['items']),
};

export const CLASSIFY_SCHEMA = {
  name: 'relevant_facts',
  schema: obj({ fact_ids: { type: 'array', items: s() } }, ['fact_ids']),
};

export const SWAP_SCHEMA = {
  name: 'swap_test',
  schema: obj({
    broken: { type: 'array', items: s() },
    generic: { type: 'array', items: s() },
  }, ['broken', 'generic']),
};
