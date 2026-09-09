// Места: список слева, карточка справа (§13.1.3–4). На узких экранах — две
// страницы с переходом «назад к списку», а не две сжатые колонки.

import { useState } from 'react';
import type { Opportunity, OpportunityDetail, CheckResult, ImportResult } from '../api/types.ts';
import { hasUnresolvedBlocker, type Expectation, type BlockerVerdict } from '@perimetr/core';
import { Score, Meter, Chip, KindChip, Checks, Card, Field, Empty } from '../components/ui.tsx';

const BRIDGE_LABEL: Record<string, string> = {
  transferable_metrics: 'метрики переносятся между отраслями',
  trajectory: 'показать траекторию, а не размер',
  explained_gap: 'объяснить перерыв',
  grouped_roles: 'сгруппировать роли',
  deliberate_choice: 'осознанный выбор роли',
  analogous_tools: 'аналогичные инструменты',
  relocation_ready: 'готовность к переезду',
  results_over_years: 'результаты вместо лет',
};

const BLOCKER_LABEL: Record<string, string> = {
  work_auth: 'Право на работу',
  language: 'Язык',
  scale: 'Масштаб',
  no_people_mgmt: 'Управление людьми',
  license: 'Лицензия',
  salary: 'Зарплатные ожидания',
};

export function Places({
  list, detail, selectedId, busy, onSelect, onAnalyse, onResume, onLetter,
  onArchive, onPatch, onImport, onConfirmImport, onGoToProfile, onRun,
}: {
  list: Opportunity[];
  detail: OpportunityDetail | null;
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string | null) => void;
  onAnalyse: (id: string) => void;
  onResume: (id: string) => void;
  onLetter: (id: string) => void;
  onArchive: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onImport: (input: { url?: string; text?: string }) => Promise<ImportResult | null>;
  onConfirmImport: (r: ImportResult) => void;
  onGoToProfile: () => void;
  onRun: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="stack gap-16">
      <div className="flex items-center between wrap gap-12">
        <div>
          <h1>Места</h1>
          <p className="muted small mt-8">
            {list.length} в работе · {list.filter(o => o.kind === 'hypothesis').length} гипотез
          </p>
        </div>
        <div className="flex gap-8 wrap">
          <button className="btn btn-secondary" onClick={() => setAdding(a => !a)}>Добавить вакансию</button>
          <button className="btn btn-primary" onClick={onRun} disabled={busy}>Найти места</button>
        </div>
      </div>

      {adding && <AddJob onImport={onImport} onConfirm={r => { onConfirmImport(r); setAdding(false); }} busy={busy} />}

      {!list.length && !adding && (
        <Card>
          <Empty title="Пока пусто">
            <p>
              Добавьте вакансию, которую нашли сами, — это самый точный вход:
              разбор строится на реальном тексте, а не на догадках о роли.
              Или запустите поиск, и приложение предложит компании, где роль назревает.
            </p>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>Добавить вакансию</button>
          </Empty>
        </Card>
      )}

      {!!list.length && (
        <div className="places" data-view={selectedId ? 'detail' : 'list'}>
          <div className="place-list">
            {list.map(o => (
              <button key={o.id} className="place" aria-selected={o.id === selectedId}
                onClick={() => onSelect(o.id)}>
                <div className="place-top">
                  <span className="place-company">{o.company}</span>
                  <span className="place-role">{o.role_title}</span>
                </div>
                <div className="place-meta">
                  <KindChip kind={o.kind} />
                  {o.city && <Chip>{o.city}</Chip>}
                  {o.score != null && <Score value={o.score} size="sm" />}
                </div>
              </button>
            ))}
          </div>

          <div className="place-detail">
            {detail
              ? <Detail d={detail} busy={busy} onAnalyse={onAnalyse} onResume={onResume}
                  onLetter={onLetter} onArchive={onArchive} onPatch={onPatch}
                  onBack={() => onSelect(null)} onGoToProfile={onGoToProfile} />
              : <Card><Empty title="Выберите место слева" /></Card>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Добавление вакансии (§3.4) ──────────────────────────────────────────────
function AddJob({ onImport, onConfirm, busy }: {
  onImport: (i: { url?: string; text?: string }) => Promise<ImportResult | null>;
  onConfirm: (r: ImportResult) => void;
  busy: boolean;
}) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  if (result) {
    const p = result.parsed;
    const empty = (v: string) => !v.trim();
    return (
      <Card className="card-pad">
        <h3>Проверьте распознанное</h3>
        <p className="muted small mt-8" style={{ marginBottom: 16 }}>
          {result.duplicate_of
            ? 'Такое место уже есть. Можно не создавать дубль, а дополнить существующее текстом вакансии.'
            : p.confidence === 'high'
              ? 'Распознано уверенно. Проверьте и подтвердите — без подтверждения место не создаётся.'
              : 'Распознано неуверенно: пустые поля подсвечены, их лучше заполнить руками.'}
        </p>
        <div className="row">
          <Field label="Компания">
            <input className="input" value={p.company}
              style={empty(p.company) ? { borderColor: 'var(--danger-border)', background: 'var(--danger-bg)' } : undefined}
              onChange={e => setResult({ ...result, parsed: { ...p, company: e.target.value } })} />
          </Field>
          <Field label="Роль">
            <input className="input" value={p.role_title}
              style={empty(p.role_title) ? { borderColor: 'var(--danger-border)', background: 'var(--danger-bg)' } : undefined}
              onChange={e => setResult({ ...result, parsed: { ...p, role_title: e.target.value } })} />
          </Field>
        </div>
        <div className="row">
          <Field label="Город">
            <input className="input" value={p.city}
              onChange={e => setResult({ ...result, parsed: { ...p, city: e.target.value } })} />
          </Field>
          <Field label="Страна" hint="По ней выбирается формат резюме и проверяется право на работу">
            <input className="input" value={p.country}
              onChange={e => setResult({ ...result, parsed: { ...p, country: e.target.value } })} />
          </Field>
        </div>
        <div className="flex gap-8 mt-8">
          <button className="btn btn-primary" onClick={() => onConfirm(result)}
            disabled={!p.company.trim() || !p.role_title.trim()}>
            {result.duplicate_of ? 'Дополнить существующее' : 'Создать место'}
          </button>
          <button className="btn btn-ghost" onClick={() => setResult(null)}>Отмена</button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="card-pad">
      <h3>Добавить вакансию</h3>
      <p className="muted small mt-8" style={{ marginBottom: 16 }}>
        Работает любое из двух полей. Ссылка удобнее, но LinkedIn, Indeed и часть
        корпоративных ATS отдают страницу только браузеру — тогда просто вставьте текст.
      </p>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Field label="Ссылка на вакансию">
          <input className="input" value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://…" inputMode="url" />
        </Field>
        <Field label="Или текст вакансии">
          <textarea className="textarea" style={{ minHeight: 96 }} value={text}
            onChange={e => setText(e.target.value)} placeholder="Вставьте описание целиком" />
        </Field>
      </div>
      <button className="btn btn-primary" disabled={busy || (!url.trim() && !text.trim())}
        onClick={async () => {
          const r = await onImport(text.trim() ? { text } : { url });
          if (r) setResult(r);
        }}>
        Распознать
      </button>
    </Card>
  );
}

// ── Карточка места (§13.1.4) ────────────────────────────────────────────────
function Detail({ d, busy, onAnalyse, onResume, onLetter, onArchive, onPatch, onBack, onGoToProfile }: {
  d: OpportunityDetail; busy: boolean;
  onAnalyse: (id: string) => void; onResume: (id: string) => void; onLetter: (id: string) => void;
  onArchive: (id: string) => void; onPatch: (id: string, p: Record<string, unknown>) => void;
  onBack: () => void; onGoToProfile: () => void;
}) {
  const o = d.opportunity;
  const a = d.analysis;
  const blockers = (a?.blockers ?? []) as BlockerVerdict[];
  const unresolved = hasUnresolvedBlocker(blockers);
  const resume = d.documents.find(x => x.kind === 'resume');
  const letter = d.documents.find(x => x.kind === 'letter');

  return (
    <div className="stack gap-16">
      <button className="btn btn-ghost btn-sm back-to-list" onClick={onBack}>← К списку</button>

      <Card>
        <div className="card-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{o.company}</h2>
            <div className="sub">{o.role_title}</div>
            <div className="place-meta mt-8">
              <KindChip kind={o.kind} />
              {o.industry && <Chip>{o.industry}</Chip>}
              {(o.city || o.country) && <Chip>{[o.city, o.country].filter(Boolean).join(', ')}</Chip>}
              {o.size && <Chip>{o.size}</Chip>}
              {o.source_url && <a className="chip chip-btn" href={o.source_url} target="_blank" rel="noreferrer">источник ↗</a>}
            </div>
          </div>
          {a && (
            <div style={{ textAlign: 'right', minWidth: 96 }}>
              <Score value={a.score} />
              {d.coverage && (
                <div className="small muted">закрыто {d.coverage.closed} из {d.coverage.total}</div>
              )}
            </div>
          )}
        </div>

        {o.signal && (
          <div className="card-pad" style={{ paddingTop: 16, paddingBottom: 16 }}>
            <div className="section-label">Сигнал</div>
            <p style={{ fontSize: 14 }}>{o.signal}</p>
            {o.source_date && <p className="small muted mt-8">Дата сигнала: {o.source_date}</p>}
          </div>
        )}
      </Card>

      {/* Блокеры — первым блоком после сигнала, до всякой генерации (§3.3). */}
      {!!blockers.length && (
        <div className="stack gap-8">
          {blockers.map((b, i) => (
            <div key={i} className="blocker">
              <div className="blocker-title">
                <span aria-hidden>▲</span>
                Жёсткий блокер · {BLOCKER_LABEL[b.kind] ?? b.kind}
              </div>
              <div className="blocker-detail">{b.detail}</div>
              <div className="blocker-actions">
                {b.resolvable_by_profile && (
                  <button className="btn btn-secondary btn-sm" onClick={onGoToProfile}>
                    Снять уточнением профиля
                  </button>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => onArchive(o.id)}>В архив</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!a && (
        <Card className="card-pad">
          <h3>Ожидания не разобраны</h3>
          <p className="muted small mt-8" style={{ marginBottom: 14 }}>
            {o.jd_text
              ? 'Есть текст вакансии — разбор построится на нём, а не на догадках о роли.'
              : 'Текста вакансии нет: ожидания будут реконструированы по роли, отрасли и сигналу, и помечены как реконструкция.'}
          </p>
          <button className="btn btn-primary" onClick={() => onAnalyse(o.id)} disabled={busy}>
            Разобрать ожидания
          </button>
        </Card>
      )}

      {a && (
        <>
          <Card>
            <div className="card-head">
              <div style={{ flex: 1 }}>
                <h3>Ожидания работодателя</h3>
                <div className="sub">
                  {a.reconstructed
                    ? 'Реконструкция: текста вакансии нет, ожидания выведены по роли и сигналу'
                    : 'Извлечены из текста вакансии'}
                </div>
              </div>
            </div>
            <div className="card-pad">
              <Meter value={a.score} />
              <div className="mt-16">
                {a.expectations.map((e, i) => <ExpectationRow key={i} e={e} />)}
              </div>
            </div>
          </Card>

          <Card className="card-pad">
            <div className="section-label">Ваше ценностное предложение</div>
            <p style={{ fontSize: 14.5 }}>{a.uvp}</p>
            {a.objection && (
              <>
                <div className="section-label mt-24">Главное возражение</div>
                <p style={{ fontSize: 14 }}>
                  <b>Чего боится тот, кто решает:</b> {a.objection.risk}
                </p>
                {a.objection.answer && (
                  <p style={{ fontSize: 14 }} className="mt-8">
                    <b>Чем снимается:</b> {a.objection.answer}
                  </p>
                )}
              </>
            )}
          </Card>

          <Card className="card-pad">
            <div className="section-label">Канал выхода на компанию</div>
            <p className="small muted" style={{ marginBottom: 12 }}>
              Referral даёт конверсию в интервью на порядок выше холодной подачи.
              Приложение не ищет знакомых за вас, но спрашивает до того, как вы
              потратите попытку.
            </p>
            <div className="row">
              <Field label="Как выходим">
                <select className="select" value={o.channel}
                  onChange={e => onPatch(o.id, { channel: e.target.value })}>
                  <option value="cold">Холодная подача</option>
                  <option value="warm">Тёплый контакт</option>
                  <option value="referral">Referral — меня представят</option>
                </select>
              </Field>
              {o.channel !== 'cold' && (
                <Field label="Кто может представить">
                  <input className="input" defaultValue={o.referral_name ?? ''}
                    onBlur={e => onPatch(o.id, { referral_name: e.target.value })} />
                </Field>
              )}
            </div>
          </Card>

          {unresolved && (
            <div className="notice-warn">
              У места неснятый жёсткий блокер. Резюме и письмо его не закроют, и попытка
              почти наверняка не сработает — но решение за вами.
            </div>
          )}

          <DocumentBlock
            title="Резюме под это место"
            hint={`Формат: ${resume?.format_variant ?? 'по стране места'}. Это не новый текст, а перестановка подтверждённых фактов под ожидания.`}
            doc={resume ? renderResume(resume.body) : null}
            checks={resume?.checks ?? []}
            action={resume ? 'Пересобрать' : 'Собрать резюме'}
            busy={busy}
            onRun={() => onResume(o.id)}
          />

          <DocumentBlock
            title={o.kind === 'vacancy' ? 'Сопроводительное письмо' : 'Холодное письмо руководителю'}
            hint={o.kind === 'vacancy' ? '250–350 слов, читается вместе с резюме' : '120–180 слов: одно наблюдение, одно доказательство, одна просьба'}
            doc={letter ? (letter.subject ? `Тема: ${letter.subject}\n\n${letter.body}` : letter.body) : null}
            checks={letter?.checks ?? []}
            action={letter ? 'Переписать' : 'Написать письмо'}
            busy={busy}
            onRun={() => onLetter(o.id)}
          />
        </>
      )}
    </div>
  );
}

function ExpectationRow({ e }: { e: Expectation }) {
  const tone = e.strength === 'strong' ? 'good' : e.strength === 'partial' ? 'mid' : 'danger';
  const label = e.strength === 'strong' ? 'закрыто' : e.strength === 'partial' ? 'частично' : 'разрыв';
  return (
    <div className="exp">
      <div className="exp-head">
        <span className="exp-text"><span className="exp-k">Ждут</span>{e.expectation}</span>
        <Chip>{e.weight === 'must' ? 'обязательно' : e.weight === 'important' ? 'важно' : 'желательно'}</Chip>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {/* Пара «ждут / есть у вас»: слева — ожидание в заголовке строки, справа —
          чем оно закрыто. Повторять текст ожидания во второй раз незачем. */}
      <div className={`exp-cell ${e.strength === 'gap' ? 'exp-cell--gap' : ''} mt-8`}>
        <span className="k">Есть у вас</span>
        {e.evidence || <span className="muted">нет подтверждения</span>}
        {e.source_hint && <div className="exp-quote">« {e.source_hint} »</div>}
      </div>
      {e.gap_class === 'soft' && e.bridge && (
        <p className="small mt-8">
          <b>Мост:</b> {BRIDGE_LABEL[e.bridge] ?? e.bridge}
          {e.gap_answer && <> — {e.gap_answer}</>}
        </p>
      )}
    </div>
  );
}

function DocumentBlock({ title, hint, doc, checks, action, busy, onRun }: {
  title: string; hint: string; doc: string | null; checks: CheckResult[];
  action: string; busy: boolean; onRun: () => void;
}) {
  const blocked = checks.some(c => c.level === 'block');
  return (
    <Card>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h3>{title}</h3>
          <div className="sub">{hint}</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onRun} disabled={busy}>{action}</button>
      </div>
      <div className="card-pad">
        {!doc && <p className="small muted">Ещё не создано.</p>}
        {doc && (
          <>
            {blocked && (
              <p className="small" style={{ color: 'var(--danger)', marginBottom: 10 }}>
                Есть блокирующие замечания — такой текст не стоит отправлять как есть.
              </p>
            )}
            <textarea className="textarea" style={{ minHeight: 260, fontSize: 14, lineHeight: 1.65 }}
              defaultValue={doc} aria-label={title} />
            <div className="section-label mt-16">Проверки</div>
            <Checks items={checks} />
          </>
        )}
      </div>
    </Card>
  );
}

function renderResume(body: string): string {
  try {
    const r = JSON.parse(body) as {
      headline: string; summary: string[]; facts_line: string; competencies: string[];
      experience: { company: string; role_title: string; period_from: string; period_to: string | null;
        context_line: string; bullets: string[] }[];
      education: string[];
    };
    return [
      r.headline, '',
      ...r.summary, '',
      r.facts_line, '',
      'КЛЮЧЕВЫЕ КОМПЕТЕНЦИИ', r.competencies.join(' · '), '',
      'ОПЫТ',
      ...r.experience.flatMap(e => [
        `${e.role_title} — ${e.company}, ${e.period_from} — ${e.period_to ?? 'н.в.'}`,
        e.context_line,
        ...e.bullets.map(b => `• ${b}`), '',
      ]),
      'ОБРАЗОВАНИЕ', ...r.education,
    ].join('\n');
  } catch {
    return body;
  }
}
