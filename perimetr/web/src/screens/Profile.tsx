// Экран профиля (§13.1.2): резюме, периметр, структурированный блок «что
// снимает сомнения», панель аудита и банк фактов.
//
// Автосохранение с задержкой 700 мс — как в ТЗ: поле на 20 000 знаков не должно
// требовать кнопки «сохранить».

import { useEffect, useRef, useState } from 'react';
import type { Profile as P, Fact, AuditReport, LanguageLevel, WorkAuth } from '../api/types.ts';
import { CEFR_ORDER } from '@perimetr/core';
import { Card, Field, Chip } from '../components/ui.tsx';

export function FactList({ facts, onPatch }: { facts: Fact[]; onPatch: (id: string, patch: Partial<Fact>) => void }) {
  return (
    <div>
      {facts.map(f => (
        <div key={f.id} className="fact">
          <input className="checkbox" type="checkbox" checked={f.confirmed}
            aria-label={`Подтвердить факт: ${f.action}`}
            onChange={e => onPatch(f.id, { confirmed: e.target.checked })} />
          <div className="fact-body">
            <div className="fact-action">{f.action}</div>
            {f.result && <div className="fact-result">{f.result}</div>}
            <div className="fact-src">« {f.source_hint} »</div>
          </div>
          <div className="stack gap-6" style={{ alignItems: 'flex-end' }}>
            {f.quantified
              ? <Chip tone="good">{f.metric_value} {f.metric_unit}</Chip>
              : <Chip tone="mid" title="Измеримый результат — самый сильный сигнал на скрининге">без числа</Chip>}
            {!!f.scale_tags.length && <span className="small muted">{f.scale_tags.join(' · ')}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditPanel({ audit, busy, onRun }: { audit: AuditReport | null; busy: boolean; onRun: () => void }) {
  return (
    <Card>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h3>Аудит профиля</h3>
          <div className="sub">Что в вашем резюме работает на скрининге, а чего не хватает</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onRun} disabled={busy}>
          {busy ? 'Считаю…' : 'Пересчитать'}
        </button>
      </div>
      <div className="card-pad">
        {!audit && <p className="small muted">Аудит ещё не запускался.</p>}
        {audit && (
          <>
            <div className="metrics">
              {audit.metrics.map(m => (
                <div key={m.id} className={`metric metric--${m.status}`}>
                  <div className="metric-label"><span className="metric-dot" aria-hidden />{m.label}</div>
                  <div className="metric-value">
                    {m.display ?? (m.status === 'ok' ? 'есть' : '—')}
                  </div>
                  <div className="metric-detail">{m.detail}</div>
                </div>
              ))}
            </div>
            {!!audit.tasks.length && (
              <>
                <div className="section-label mt-24">Что исправить — по убыванию эффекта</div>
                <div className="tasks">
                  {audit.tasks.map(t => <div key={t.id} className="task"><span>{t.text}</span></div>)}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function useAutosave<T>(value: T, save: (v: T) => void, ms = 700) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => save(value), ms);
    return () => clearTimeout(t);
  }, [value]);
}

export function ProfileScreen({ profile, facts, audit, busy, onSave, onAudit, onPatchFact }: {
  profile: P; facts: Fact[]; audit: AuditReport | null; busy: boolean;
  onSave: (patch: Partial<P>) => void;
  onAudit: () => void;
  onPatchFact: (id: string, patch: Partial<Fact>) => void;
}) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile.resume_text]);
  useAutosave(draft, d => onSave(d));

  const set = <K extends keyof P>(k: K, v: P[K]) => setDraft(d => ({ ...d, [k]: v }));
  const scale = draft.scale ?? {};

  return (
    <div className="stack gap-20">
      <div className="flex items-center between wrap gap-12">
        <div>
          <h1>Профиль</h1>
          <p className="muted small mt-8">Изменения сохраняются сами</p>
        </div>
      </div>

      <Card className="card-pad">
        <Field label="Резюме">
          <textarea className="textarea" style={{ minHeight: 220 }} value={draft.resume_text}
            onChange={e => set('resume_text', e.target.value)} />
        </Field>
        <Field label="Свободные сведения"
          hint="Чему научились, кого вырастили, почему были перерывы. Часто сильнее самого резюме.">
          <textarea className="textarea" value={draft.extras_text} onChange={e => set('extras_text', e.target.value)} />
        </Field>
      </Card>

      <AuditPanel audit={audit} busy={busy} onRun={onAudit} />

      <Card>
        <div className="card-head">
          <div style={{ flex: 1 }}>
            <h3>Банк фактов</h3>
            <div className="sub">
              Подтверждено {facts.filter(f => f.confirmed).length} из {facts.length}.
              В документы попадают только подтверждённые.
            </div>
          </div>
        </div>
        <div className="card-pad">
          {facts.length ? <FactList facts={facts} onPatch={onPatchFact} />
            : <p className="small muted">Пусто — запустите аудит, он разберёт резюме на факты.</p>}
        </div>
      </Card>

      <Card>
        <div className="card-head">
          <div style={{ flex: 1 }}>
            <h3>Что снимает сомнения</h3>
            <div className="sub">Эти поля закрывают вопросы, которые почти никогда не задают вслух</div>
          </div>
        </div>
        <div className="card-pad">
          <div className="section-label">Масштаб управления</div>
          <div className="row">
            <Field label="Максимум людей в подчинении">
              <input className="input" inputMode="numeric" value={scale.team_max ?? ''}
                onChange={e => set('scale', { ...scale, team_max: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Из них менеджеров">
              <input className="input" inputMode="numeric" value={scale.managers_max ?? ''}
                onChange={e => set('scale', { ...scale, managers_max: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Бюджет, EUR">
              <input className="input" inputMode="numeric" value={scale.budget_max ?? ''}
                onChange={e => set('scale', { ...scale, budget_max: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="География">
              <input className="input" value={scale.geo_scope ?? ''}
                onChange={e => set('scale', { ...scale, geo_scope: e.target.value })} placeholder="3 страны" />
            </Field>
          </div>

          <div className="section-label mt-16">Языки</div>
          <LanguageEditor value={draft.languages} onChange={v => set('languages', v)} />

          <div className="section-label mt-24">Право на работу</div>
          <WorkAuthEditor value={draft.work_auth} onChange={v => set('work_auth', v)} />

          <div className="section-label mt-24">Прочее</div>
          <div className="row">
            <Field label="Готовность к релокации">
              <select className="select" value={draft.relocation?.ready ?? 'no'}
                onChange={e => set('relocation', { ready: e.target.value as 'yes' | 'no' | 'conditional', package_needed: draft.relocation?.package_needed ?? false })}>
                <option value="yes">Готова</option>
                <option value="conditional">При условиях</option>
                <option value="no">Не готова</option>
              </select>
            </Field>
            <Field label="LinkedIn">
              <input className="input" value={draft.linkedin_url} onChange={e => set('linkedin_url', e.target.value)} />
            </Field>
            <Field label="Фото в резюме" hint="В DACH ожидается, в UK и Скандинавии — нет">
              <select className="select" value={draft.photo_policy}
                onChange={e => set('photo_policy', e.target.value as P['photo_policy'])}>
                <option value="auto">По стране места</option>
                <option value="never">Никогда</option>
                <option value="always">Всегда</option>
              </select>
            </Field>
          </div>
        </div>
      </Card>
    </div>
  );
}

function LanguageEditor({ value, onChange }: { value: LanguageLevel[]; onChange: (v: LanguageLevel[]) => void }) {
  return (
    <div className="stack gap-8">
      {value.map((l, i) => (
        <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
          <input className="input" value={l.lang} aria-label="Язык"
            onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, lang: e.target.value } : x)))} />
          <select className="select" value={l.cefr} aria-label="Уровень CEFR" style={{ flex: '0 1 120px' }}
            onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, cefr: e.target.value as LanguageLevel['cefr'] } : x)))}>
            {CEFR_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" style={{ flex: '0 0 auto' }}
            onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Удалить язык">Удалить</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange([...value, { lang: '', cefr: 'B2' }])}>Добавить язык</button>
      <p className="field-hint">Уровень по CEFR, а не «свободно»: требование вакансии сравнивается именно с ним.</p>
    </div>
  );
}

function WorkAuthEditor({ value, onChange }: { value: WorkAuth[]; onChange: (v: WorkAuth[]) => void }) {
  return (
    <div className="stack gap-8">
      {value.map((w, i) => (
        <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
          <input className="input" value={w.region} aria-label="Регион" placeholder="Sweden или EU"
            onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, region: e.target.value } : x)))} />
          <select className="select" value={w.status} aria-label="Статус"
            onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, status: e.target.value as WorkAuth['status'] } : x)))}>
            <option value="citizen">Гражданство</option>
            <option value="permit">Разрешение есть</option>
            <option value="needs_sponsorship">Нужно спонсорство</option>
          </select>
          <button className="btn btn-ghost btn-sm" style={{ flex: '0 0 auto' }}
            onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Удалить регион">Удалить</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange([...value, { region: '', status: 'permit' }])}>Добавить регион</button>
      <p className="field-hint">Главное сомнение при международной подаче. Снимается одной строкой в резюме.</p>
    </div>
  );
}
