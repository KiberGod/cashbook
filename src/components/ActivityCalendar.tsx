import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { toLocalInput } from '../lib/format';
import type { Transaction } from '../lib/types';
import { Segmented, usePref } from './bits';

type Mode = 'days' | 'months' | 'years';

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

/** 0..4 intensity relative to the busiest cell. */
const level = (n: number, max: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / Math.max(max, 1)) * 4)));

/** A time range as two datetime-local values, both ends included (to the minute). */
export interface CalendarRange {
  from: string;
  to: string;
}

const rangeOf = (start: Date, end: Date): CalendarRange => ({ from: toLocalInput(start), to: toLocalInput(end) });
const dayRange = (d: Date) => rangeOf(new Date(d.getFullYear(), d.getMonth(), d.getDate()), new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59));
const monthRange = (y: number, m: number) => rangeOf(new Date(y, m, 1), new Date(y, m + 1, 0, 23, 59));
const yearRange = (y: number) => rangeOf(new Date(y, 0, 1), new Date(y, 11, 31, 23, 59));

/**
 * Activity calendar: how many transactions happened per day (a year as a week grid),
 * per month or per year. With `pick`, a day, month or year can be clicked to choose it as
 * a time range (clicking the chosen one again clears it); the chosen one is outlined. With the
 * mouse, a press dragged over other cells chooses all the time between them.
 * The other way round, any range set in the date filter shows on it: what lies outside is
 * dimmed, and it turns to the year the range starts in.
 */
export function ActivityCalendar({
  txs,
  scope = txs,
  pick,
}: {
  txs: Transaction[];
  /** the whole list `txs` was found in: its years stay offered when a search narrows `txs` */
  scope?: Transaction[];
  pick?: { value: CalendarRange; onChange: (r: CalendarRange | null) => void };
}) {
  const { t, tn, locale, date } = useI18n();
  const [mode, setMode] = usePref<Mode>('calendarMode', 'days');
  const years = useMemo(() => {
    const s = new Set<number>([new Date().getFullYear()]);
    for (const x of scope) s.add(new Date(x.date).getFullYear());
    return [...s].sort((a, b) => a - b);
  }, [scope]);
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

  const chosen = (r: CalendarRange) => !!pick && pick.value.from === r.from && pick.value.to === r.to;
  // a cell outside the filter's range (an open end reaches as far as it goes): dimmed; one it
  // only touches (a range starting at 14:00 on a day) still counts as in it. Same-shape local
  // "YYYY-MM-DDTHH:mm" values compare as text.
  const from = pick?.value.from ?? '';
  const to = pick?.value.to ?? '';
  const outside = (r: CalendarRange) => (!!from && r.to < from) || (!!to && r.from > to);

  // a range set in the filter (typed, or picked here): the calendar turns to its year
  const rangeYear = Number((from || to).slice(0, 4)) || null;
  useEffect(() => {
    if (rangeYear && years.includes(rangeYear)) setYear(rangeYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeYear]);
  const choose = (r: CalendarRange) => pick?.onChange(chosen(r) ? null : r);

  // ---- a range by dragging (the mouse): press on a day, month or year, move over others to take
  // in everything between them in time, let go to set it; a press with no move is a click ----
  const [drag, setDrag] = useState<{ start: CalendarRange; cur: CalendarRange } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // a mouse press is handled here; the click that follows it is not handled again
  const byMouse = useRef(false);
  const span = (a: CalendarRange, b: CalendarRange): CalendarRange => ({ from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to });
  const sel = drag ? span(drag.start, drag.cur) : null;
  const inSel = (r: CalendarRange) => !!sel && r.from >= sel.from && r.to <= sel.to;
  useEffect(() => {
    if (!drag) return;
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      // the same cell: a click (choose it, or clear it when it is the chosen one); else the whole span
      if (d.start.from === d.cur.from) choose(d.start);
      else pick?.onChange(span(d.start, d.cur));
    };
    const cancel = () => setDrag(null);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);
  /** What a pickable cell needs: a click (touch, keyboard), and with the mouse the dragging. */
  const pickProps = (r: CalendarRange) =>
    pick
      ? {
          onPointerDown: (e: ReactPointerEvent) => {
            byMouse.current = e.pointerType === 'mouse';
            if (!byMouse.current || e.button !== 0) return;
            e.preventDefault();
            setDrag({ start: r, cur: r });
          },
          onPointerEnter: () => dragRef.current && setDrag({ ...dragRef.current, cur: r }),
          onClick: () => {
            if (byMouse.current) return void (byMouse.current = false);
            choose(r);
          },
        }
      : {};

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
    // a month's name stands over the week holding its 1st day
    const monthStarts = weeks.flatMap((w, i) => w.filter((d) => d.getFullYear() === year && d.getDate() === 1).map((d) => ({ month: d.getMonth(), col: i })));
    const columns = `28px repeat(${weeks.length}, 1fr)`;
    return (
      <div className="cal">
        {header}
        <div className="cal-scroll">
          <div className="cal-mrow" style={{ gridTemplateColumns: columns }} aria-hidden="true">
            {monthStarts.map(({ month, col }) => (
              <span key={month} style={{ gridColumn: col + 2 }}>
                {monthNames[month]}
              </span>
            ))}
          </div>
          <div className="cal-days" style={{ gridTemplateColumns: columns }}>
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
                  const r = dayRange(d);
                  return (
                    <span
                      key={d.getTime()}
                      className={`cal-cell l${level(n, max)} ${inYear ? '' : 'out'} ${pick && inYear ? 'pickable' : ''} ${inYear && chosen(r) ? 'chosen' : ''} ${inYear && outside(r) && !sel ? 'off' : ''} ${inYear && inSel(r) ? 'sel' : ''}`}
                      title={inYear ? `${date(d.getTime())}: ${tn('counts.transactions', n)}` : undefined}
                      {...(inYear ? pickProps(r) : {})}
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
            const r = monthRange(year, m);
            const Tag = pick ? 'button' : 'div';
            return (
              <Tag
                key={m}
                type={pick ? 'button' : undefined}
                className={`cal-month l${level(n, max)} ${pick ? 'pickable' : ''} ${chosen(r) ? 'chosen' : ''} ${outside(r) && !sel ? 'off' : ''} ${inSel(r) ? 'sel' : ''}`}
                title={tn('counts.transactions', n)}
                aria-pressed={pick ? chosen(r) : undefined}
                {...pickProps(r)}
              >
                <span>{name}</span>
                <strong>{n}</strong>
              </Tag>
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
          const r = yearRange(y);
          const Tag = pick ? 'button' : 'div';
          return (
            <Tag
              key={y}
              type={pick ? 'button' : undefined}
              className={`cal-yearbar ${pick ? 'pickable' : ''} ${chosen(r) ? 'chosen' : ''} ${outside(r) && !sel ? 'off' : ''} ${inSel(r) ? 'sel' : ''}`}
              aria-pressed={pick ? chosen(r) : undefined}
              {...pickProps(r)}
            >
              <span className="cal-yearbar-label">{y}</span>
              <span className="cal-yearbar-track">
                <span className="cal-yearbar-fill" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <strong>{n}</strong>
            </Tag>
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
