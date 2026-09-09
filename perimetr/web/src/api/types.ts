import type {
  Profile, Fact, Opportunity, Analysis, CheckResult, AuditReport, BudgetStatus, Coverage,
  LanguageLevel, WorkAuth, Scale, CareerGap, Cefr, Expectation, Blocker,
} from '@perimetr/core';

export type {
  Profile, Fact, Opportunity, Analysis, CheckResult, AuditReport, BudgetStatus, Coverage,
  LanguageLevel, WorkAuth, Scale, CareerGap, Cefr, Expectation, Blocker,
};

export interface Me {
  user: { email: string; name: string };
  profile_filled: boolean;
  spreadsheet_url: string | null;
  reauth_required: boolean;
}

export interface DocumentRecord {
  id: string;
  kind: 'resume' | 'letter';
  version: number;
  subject: string | null;
  body: string;
  edited_by_user: boolean;
  format_variant: string | null;
  facts_used: string[];
  checks: CheckResult[];
  created_at: string;
}

export interface OpportunityDetail {
  opportunity: Opportunity;
  analysis: Analysis | null;
  documents: DocumentRecord[];
  coverage: Coverage | null;
}

export interface UsageSummary extends BudgetStatus {
  byOperation: Record<string, { count: number; cost: number; failed: number }>;
  failed: number;
}

export interface ParsedJob {
  company: string; role_title: string; city: string; country: string;
  industry: string; size: string; language: string; seniority: string;
  requirements: string[]; responsibilities: string[];
  contact_email: string; salary: string; posted_date: string;
  confidence: 'high' | 'medium' | 'low';
  is_job_posting: boolean;
}

export interface ImportResult {
  parsed: ParsedJob;
  jd_text: string;
  duplicate_of: string | null;
  source_url: string | null;
}

export interface RunState {
  id: string; state: 'queued' | 'running' | 'done' | 'failed';
  stage: string | null; found: number; added: number; error: string | null;
}

export interface Api {
  me(): Promise<Me>;
  getProfile(): Promise<{ profile: Profile; audit: AuditReport | null; facts: Fact[] }>;
  saveProfile(patch: Partial<Profile>): Promise<{ profile: Profile; audit: AuditReport }>;
  runAudit(): Promise<{ audit: AuditReport; facts: Fact[] }>;
  patchFact(id: string, patch: Partial<Fact>): Promise<void>;
  deleteFact(id: string): Promise<void>;
  listOpportunities(): Promise<Opportunity[]>;
  getOpportunity(id: string): Promise<OpportunityDetail>;
  patchOpportunity(id: string, patch: Record<string, unknown>): Promise<{ analysis?: Analysis }>;
  archiveOpportunity(id: string): Promise<void>;
  importJob(input: { url?: string; text?: string }): Promise<ImportResult>;
  confirmImport(r: ImportResult & { parsed: ParsedJob }): Promise<{ id: string; merged?: boolean }>;
  analyse(id: string): Promise<{ analysis: Analysis; coverage: Coverage }>;
  makeResume(id: string): Promise<{ doc: unknown; checks: CheckResult[] }>;
  makeLetter(id: string, tone?: string): Promise<{ doc: { subject: string; body: string }; checks: CheckResult[] }>;
  saveDocument(id: string, patch: { body?: string; subject?: string }): Promise<{ checks: CheckResult[] }>;
  startRun(): Promise<{ run_id: string }>;
  getRun(id: string): Promise<RunState>;
  usage(): Promise<UsageSummary>;
}
