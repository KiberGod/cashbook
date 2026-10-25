import { useMemo, useState } from 'react';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import type { Transaction } from '../lib/types';
import { Segmented, usePref } from './bits';

type Mode = 'days' | 'months' | 'years';

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

/** 0..4 intensity relative to the busiest cell. */
const level = (n: number, max: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / Math.max(max, 1)) * 4)));

/**
 * Activity calendar: how many transactions happened per day (a year as a week grid),
 * per month or per year.
 */
export function ActivityCalendar({ txs }: { txs: Transaction[] }) {
  const { t, tn, locale, date } = useI18n();
  const [mode, setMode] = usePref<Mode>('calendarMode', 'days');
  const years = useMemo(() => {
    const s = new Set<number>([new Date().getFullYear()]);
    for (const x of txs) s.add(new Date(x.date).getFullYear());
    return [...s].sort((a, b) => a - b);
  }, [txs]);
  const [year, setYear] = useState(years[years.length - 1]);

  const counts = useMemo(() => {
    const days = new Map<string, number>();
    const months = new Map<string, number>();
    const perYear = new Map<number, number>();
    for (const x of txs) {
      const d = new Date(x.date);
      days.set(dayKey(d), (days.get(dayKey(d)) ?? 0) + 1);
      months.set(monthKey(d), (months.get(monthKey(d)) ?? 0) + 1);
      perYear.set(d.getFullYear(), (perYear.get(d.getFullYear()) ?? 0) + 1);
    }
    return { days, months, perYear };
  }, [txs]);

  const monthNames = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { month: 'short' });
    return Array.from({ length: 12 }, (_, m) => f.format(new Date(2024, m, 1)));
  }, [locale]);
  const weekdayNames = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(2024, 0, 1 + i))); // 2024-01-01 is a Monday
  }, [locale]);

  const header = (
    <div className="cal-head">
      <Segmented<Mode>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'days', label: t('cal.days') },
          { value: 'months', label: t('cal.months') },
          { value: 'years', label: t('cal.years') },
        ]}
      />
      {mode !== 'years' && (
        <div className="cal-year">
          <button type="button" className="icon-btn" disabled={year <= years[0]} onClick={() => setYear(year - 1)} aria-label={t('page.prev')}>
            <Icon name="chevronLeft" size={18} />
          </button>
          <strong>{year}</strong>
          <button type="button" className="icon-btn" disabled={year >= years[years.length - 1]} onClick={() => setYear(year + 1)} aria-label={t('page.next')}>
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
      )}
    </div>
  );

  if (mode === 'days') {
    // weeks start on Monday; columns = weeks of the selected year
    const start = new Date(year, 0, 1);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(year, 11, 31);
    const weeks: Date[][] = [];
    for (let d = new Date(start); d <= end || weeks[weeks.length - 1]?.length < 7; d.setDate(d.getDate() + 1)) {
      if (!weeks.length || weeks[weeks.length - 1].length === 7) weeks.push([]);
      weeks[weeks.length - 1].push(new Date(d));
    }
    let max = 0;
    for (const w of weeks) for (const d of w) if (d.getFullYear() === year) max = Math.max(max, counts.days.get(dayKey(d)) ?? 0);
    const total = counts.perYear.get(year) ?? 0;
    return (
      <div className="cal">
        {header}
        <div className="cal-scroll">
          <div className="cal-days" style={{ gridTemplateColumns: `28px repeat(${weeks.length}, 1fr)` }}>
            <div className="cal-wd">
              {weekdayNames.map((w, i) => (
                <span key={i}>{i % 2 === 0 ? w : ''}</span>
              ))}
            </div>
            {weeks.map((w, i) => (
              <div key={i} className="cal-week">
                {w.map((d) => {
                  const inYear = d.getFullYear() === year;
                  const n = inYear ? (counts.days.get(dayKey(d)) ?? 0) : 0;
                  return (
                    <span
                      key={d.getTime()}
                      className={`cal-cell l${level(n, max)} ${inYear ? '' : 'out'}`}
                      title={inYear ? `${date(d.getTime())}: ${tn('counts.transactions', n)}` : undefined}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="cal-foot">
          <span className="muted">{tn('cal.totalYear', total, { year })}</span>
          <Legend />
        </div>
      </div>
    );
  }

  if (mode === 'months') {
    let max = 0;
    for (let m = 0; m < 12; m++) max = Math.max(max, counts.months.get(`${year}-${m}`) ?? 0);
    return (
      <div className="cal">
        {header}
        <div className="cal-months">
          {monthNames.map((name, m) => {
            const n = counts.months.get(`${year}-${m}`) ?? 0;
            return (
              <div key={m} className={`cal-month l${level(n, max)}`} title={tn('counts.transactions', n)}>
                <span>{name}</span>
                <strong>{n}</strong>
              </div>
            );
          })}
        </div>
        <div className="cal-foot">
          <span className="muted">{tn('cal.totalYear', counts.perYear.get(year) ?? 0, { year })}</span>
          <Legend />
        </div>
      </div>
    );
  }

  const max = Math.max(1, ...years.map((y) => counts.perYear.get(y) ?? 0));
  return (
    <div className="cal">
      {header}
      <div className="cal-years">
        {years.map((y) => {
          const n = counts.perYear.get(y) ?? 0;
          return (
            <div key={y} className="cal-yearbar">
              <span className="cal-yearbar-label">{y}</span>
              <span className="cal-yearbar-track">
                <span className="cal-yearbar-fill" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <strong>{n}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  const { t } = useI18n();
  return (
    <span className="cal-legend">
      {t('cal.less')}
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} className={`cal-cell l${l}`} />
      ))}
      {t('cal.more')}
    </span>
  );
}
