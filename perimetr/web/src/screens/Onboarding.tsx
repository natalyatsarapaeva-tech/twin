// Онбординг (§3.1). Четыре шага, из которых первые два занимают минуту, а
// третий — та самая разовая работа на 15–30 минут, ради которой всё остальное
// потом работает. Поэтому шаг с фактами не прячется за «продолжить»: он
// показывает, ЧТО именно даёт подтверждение, и разрешает уйти раньше.

import { useState } from 'react';
import type { Profile, Fact, AuditReport } from '../api/types.ts';
import { Field, Card } from '../components/ui.tsx';
import { FactList } from './Profile.tsx';

const STEPS = ['Резюме', 'Периметр', 'Факты', 'Сомнения'] as const;

export function Onboarding({ profile, facts, audit, busy, onSave, onAudit, onPatchFact, onDone }: {
  profile: Profile; facts: Fact[]; audit: AuditReport | null; busy: boolean;
  onSave: (patch: Partial<Profile>) => Promise<void>;
  onAudit: () => Promise<void>;
  onPatchFact: (id: string, patch: Partial<Fact>) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [resume, setResume] = useState(profile.resume_text);
  const [extras, setExtras] = useState(profile.extras_text);
  const [perimeter, setPerimeter] = useState(profile.perimeter);
  const [geo, setGeo] = useState(profile.geo);
  const [industries, setIndustries] = useState(profile.industries);
  const [exclude, setExclude] = useState(profile.exclude);
  const [breadth, setBreadth] = useState(profile.breadth);

  const confirmed = facts.filter(f => f.confirmed).length;

  async function next() {
    if (step === 0) { await onSave({ resume_text: resume, extras_text: extras }); setStep(1); return; }
    if (step === 1) {
      await onSave({ perimeter, geo, industries, exclude, breadth });
      setStep(2);
      if (!facts.length) await onAudit();
      return;
    }
    if (step === 2) { setStep(3); return; }
    onDone();
  }

  return (
    <div className="main main--narrow">
      <div className="stepper" aria-label="Шаги настройки">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i < step ? 'step--done' : i === step ? 'step--current' : ''}`}>
            <span className="step-n">{i < step ? '✓' : i + 1}</span>{s}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card className="card-pad">
          <h1>Начнём с резюме</h1>
          <p className="muted mt-8" style={{ marginBottom: 20 }}>
            Вставьте текст как есть — форматирование не важно. Из него приложение
            соберёт банк фактов: он станет единственным источником для всех резюме
            и писем, которые вы отсюда отправите.
          </p>
          <Field label="Резюме">
            <textarea className="textarea" style={{ minHeight: 260 }} value={resume}
              onChange={e => setResume(e.target.value)}
              placeholder="Должность, компания, годы, чем занимались, что получилось…" />
          </Field>
          <Field label="Свободные сведения — необязательно"
            hint="То, чего в резюме нет: чему научились, кого вырастили, почему были перерывы, куда готовы переехать. Это часто оказывается сильнее самого резюме.">
            <textarea className="textarea" value={extras} onChange={e => setExtras(e.target.value)} />
          </Field>
        </Card>
      )}

      {step === 1 && (
        <Card className="card-pad">
          <h1>Где искать</h1>
          <p className="muted mt-8" style={{ marginBottom: 20 }}>
            Периметр — это грани вашего опыта, каждая из которых релевантна своим
            ролям. Перечислите их через точку с запятой: чем их больше, тем шире
            поиск смотрит.
          </p>
          <Field label="Роли, которые вам интересны"
            hint="Например: VP Operations; Head of Supply Chain; Director of Logistics">
            <textarea className="textarea" style={{ minHeight: 88 }} value={perimeter}
              onChange={e => setPerimeter(e.target.value)} />
          </Field>
          <div className="row">
            <Field label="География" hint="Страны через запятую — по ним же проверяется право на работу">
              <input className="input" value={geo} onChange={e => setGeo(e.target.value)} placeholder="Sweden, Germany" />
            </Field>
            <Field label="Отрасли в приоритете">
              <input className="input" value={industries} onChange={e => setIndustries(e.target.value)} />
            </Field>
          </div>
          <Field label="Что исключить" hint="Компании, отрасли или форматы, которые точно не подходят">
            <input className="input" value={exclude} onChange={e => setExclude(e.target.value)} />
          </Field>
          <Field label="Охват поиска">
            <select className="select" value={breadth} onChange={e => setBreadth(e.target.value as Profile['breadth'])}>
              <option value="narrow">Узкий — в основном опубликованные вакансии</option>
              <option value="medium">Средний — вакансии и гипотезы поровну</option>
              <option value="wide">Широкий — больше компаний, где роль ещё не открыта</option>
            </select>
          </Field>
        </Card>
      )}

      {step === 2 && (
        <Card className="card-pad">
          <h1>Подтвердите факты</h1>
          <p className="muted mt-8" style={{ marginBottom: 16 }}>
            Вот что приложение нашло в вашем резюме. Отмеченные факты — и только
            они — попадут в резюме и письма. Неотмеченное не будет использовано
            нигде: это защита от того, чтобы модель приписала вам чужое достижение.
          </p>
          {busy && !facts.length && (
            <p className="small muted">Разбираю резюме на факты… это занимает до минуты.</p>
          )}
          {!!facts.length && (
            <>
              <p className="small muted" style={{ marginBottom: 12 }}>
                Подтверждено {confirmed} из {facts.length}. Факты без числа подсвечены —
                к ним стоит вспомнить цифру: измеримый результат сильнее любого прилагательного.
              </p>
              <FactList facts={facts} onPatch={onPatchFact} />
            </>
          )}
        </Card>
      )}

      {step === 3 && (
        <Card className="card-pad">
          <h1>Что снимает сомнения</h1>
          <p className="muted mt-8" style={{ marginBottom: 20 }}>
            Эти поля закрывают вопросы, которые скринер задаёт про всех и почти
            никогда не спрашивает вслух. Каждое заполненное поле — одна строка
            в резюме и один снятый блокер.
          </p>
          {audit && (
            <div className="tasks">
              {audit.tasks.slice(0, 6).map(t => (
                <div key={t.id} className="task"><span>{t.text}</span></div>
              ))}
              {!audit.tasks.length && <p className="small muted">Всё заполнено — можно искать.</p>}
            </div>
          )}
          <p className="small muted mt-16">
            Заполнить их можно прямо сейчас на экране профиля или позже: поиск
            работает и без этого, просто документы получатся слабее.
          </p>
        </Card>
      )}

      <div className="onb-actions">
        {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Назад</button>}
        <span className="spacer" />
        {step === 2 && <button className="btn btn-ghost" onClick={() => setStep(3)}>Подтвержу позже</button>}
        <button className="btn btn-primary" onClick={next}
          disabled={busy || (step === 0 && !resume.trim())}>
          {step === 0 && 'Дальше'}
          {step === 1 && 'Разобрать резюме'}
          {step === 2 && 'Дальше'}
          {step === 3 && 'Перейти к поиску'}
        </button>
      </div>
      {step === 0 && !resume.trim() && (
        <p className="small muted mt-8">Без текста резюме дальше не пройти: с него начинается всё остальное.</p>
      )}
    </div>
  );
}
