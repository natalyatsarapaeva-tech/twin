// Расходы (§13.1.5). Остаток называется в понятных единицах, а не в процентах:
// «хватит примерно на 12 разборов» полезнее, чем «потрачено 63%».
// Неудачные вызовы показаны отдельно — иначе «$0» означает и «дёшево»,
// и «ничего не работает».

import type { UsageSummary } from '../api/types.ts';
import { Card } from '../components/ui.tsx';

const OP_LABEL: Record<string, string> = {
  discover: 'Поиск мест', analyse: 'Разбор ожиданий', resume: 'Резюме', letter: 'Письма',
  audit: 'Аудит профиля', ingest: 'Разбор вакансии', check: 'Проверки', extract: 'Извлечение текста',
  classify: 'Отбор фактов',
};

export function Usage({ data }: { data: UsageSummary | null }) {
  if (!data) return <p className="muted">Загружаю…</p>;
  const pct = Math.round(data.share * 100);
  const band = data.level === 'stop' ? 'danger' : data.level === 'warn' ? 'mid' : 'good';

  return (
    <div className="stack gap-20">
      <div>
        <h1>Расходы</h1>
        <p className="muted small mt-8">Текущий календарный месяц</p>
      </div>

      <Card className="card-pad">
        <div className="flex items-center between wrap gap-12">
          <div>
            <div className="section-label">Потрачено</div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 34, fontWeight: 600 }}>
              ${data.spent.toFixed(2)}
              <span className="muted" style={{ fontSize: 17 }}> из ${data.limit}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="section-label">Хватит примерно на</div>
            {data.remaining.slice(0, 2).map(r => (
              <div key={r.operation} style={{ fontSize: 14 }}>
                {r.count} {OP_LABEL[r.operation]?.toLowerCase() ?? r.operation}
              </div>
            ))}
          </div>
        </div>
        <div className={`meter meter--${band === 'danger' ? 'low' : band} mt-16`}>
          <i style={{ width: `${Math.min(100, pct)}%`, background: band === 'danger' ? 'var(--danger)' : undefined }} />
        </div>
        {data.reason && (
          <p className="small mt-12" style={{ color: data.level === 'stop' ? 'var(--danger)' : 'var(--mid)' }}>
            {data.reason}
          </p>
        )}
      </Card>

      <Card>
        <div className="card-head"><h3>По операциям</h3></div>
        <div className="card-pad table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Операция</th>
                <th className="num">Вызовов</th>
                <th className="num">Неудачных</th>
                <th className="num">Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.byOperation).map(([op, v]) => (
                <tr key={op}>
                  <td>{OP_LABEL[op] ?? op}</td>
                  <td className="num">{v.count}</td>
                  <td className="num" style={v.failed ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>
                    {v.failed || '—'}
                  </td>
                  <td className="num">${v.cost.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.failed > 0 && (
            <p className="small muted mt-12">
              {data.failed} вызовов завершились ошибкой. Они не стоили денег, но и результата не дали —
              поэтому показаны здесь, а не спрятаны.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
