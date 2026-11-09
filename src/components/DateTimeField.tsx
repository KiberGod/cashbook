import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { toLocalInput } from '../lib/format';
import { useDismiss, useFloating } from './bits';

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DDTHH:mm" (what a datetime-local input holds) -> Date, or null when empty / broken. */
function parse(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The date separator of the locale's numeric dates: "." (ru, uk) or "/" (en-GB). */
function dateSeparator(locale: string) {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(2024, 0, 2)).find((p) => p.type === 'literal')?.value.trim() || '.';
}

/** A date as the field's text: "09.11.2026 14:30" (day first in every language the app has). */
const toText = (d: Date, sep: string) => `${pad(d.getDate())}${sep}${pad(d.getMonth() + 1)}${sep}${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// the parts of the text and what follows each: day.month.year hours:minutes
const PARTS = [2, 2, 4, 2, 2];

/**
 * Typed text -> the field's shape: digits fill day, month, year, hours and minutes in turn and the
 * separators come by themselves; a separator typed after a single digit pads it ("9." -> "09."),
 * a two-digit year before the time becomes 20xx.
 */
function mask(raw: string, sep: string) {
  const after = [sep, sep, ' ', ':', ''];
  const parts: string[] = [];
  let cur = '';
  for (const ch of raw) {
    const i = parts.length;
    if (i >= PARTS.length) break;
    if (/\d/.test(ch)) {
      cur += ch;
      if (cur.length === PARTS[i]) (parts.push(cur), (cur = ''));
    } else if (cur) {
      // a separator ends a part typed short
      parts.push(i === 2 ? (cur.length === 2 ? `20${cur}` : cur) : cur.padStart(PARTS[i], '0'));
      cur = '';
    }
  }
  let out = parts.map((x, i) => x + (i < PARTS.length - 1 ? after[i] : '')).join('');
  if (cur) out += cur;
  return out;
}

/**
 * The field's text -> a "YYYY-MM-DDTHH:mm" value, or null while it is not a whole, real date.
 * `short` also takes a two-digit year (20xx): only once the typing is over, not to jump to 2020
 * on the way to 2025.
 */
function fromText(text: string, time: string, short = false): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text.trim());
  const m = iso ? [iso[3], iso[2], iso[1], iso[4], iso[5]] : (short ? /^(\d{2})\D(\d{2})\D(\d{2}|\d{4})(?:\s+(\d{2}):(\d{2}))?$/ : /^(\d{2})\D(\d{2})\D(\d{4})(?:\s+(\d{2}):(\d{2}))?$/).exec(text.trim())?.slice(1);
  if (!m) return null;
  const [day, month, y] = m.slice(0, 3).map(Number);
  const year = m[2].length === 2 ? 2000 + y : y;
  const [h, min] = m[3] !== undefined ? [Number(m[3]), Number(m[4])] : time.split(':').map(Number);
  if (h > 23 || min > 59) return null;
  const d = new Date(year, month - 1, day, h, min);
  // 31.02 rolls over into March: not a real date
  if (d.getDate() !== day || d.getMonth() !== month - 1) return null;
  return toLocalInput(d);
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * A date and time picker in the app's own look: a text field that takes a typed
 * "DD.MM.YYYY HH:mm" (the calendar follows what is typed) and a calendar button that
 * opens a month calendar and an hour:minute field. The value is a local "YYYY-MM-DDTHH:mm"
 * string ('' = not set), the same as a datetime-local input. Picking a day keeps the time
 * already set, or takes `defaultTime` ("00:00" for a range start, "23:59" for its end).
 */
export function DateTimeField({
  value,
  onChange,
  placeholder,
  defaultTime = '00:00',
  ariaLabel,
  minYear = 2000,
  maxYear = new Date().getFullYear(),
  clearable = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  defaultTime?: string;
  ariaLabel?: string;
  /** the years that can be picked (by default 2000 up to the current one) */
  minYear?: number;
  maxYear?: number;
  /** a "×" that empties it (not for a required value) */
  clearable?: boolean;
}) {
  const { t, locale, dateTime } = useI18n();
  const current = parse(value);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(() => current ?? new Date());
  const ref = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref, pop);

  // what is being typed; null shows the value itself (as it is, or after it changed elsewhere)
  const sep = useMemo(() => dateSeparator(locale), [locale]);
  const [text, setText] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const pattern = t('time.pattern').replaceAll('.', sep);
  const shownText = text ?? (current ? toText(current, sep) : '');
  const yearOk = (v: string) => {
    const y = Number(v.slice(0, 4));
    return y >= minYear && y <= maxYear;
  };
  const timeOf = () => (current ? `${pad(current.getHours())}:${pad(current.getMinutes())}` : defaultTime);
  // typing is over (the field is left, Enter): a short year counts too, and the text shows the value again
  const finish = () => {
    const v = text !== null && fromText(text, timeOf(), true);
    if (v && yearOk(v) && v !== value) onChange(v);
    setText(null);
  };
  const type = (raw: string) => {
    const time = timeOf();
    // a pasted "2026-11-09 14:30" is taken whole
    const pasted = /^\d{4}-\d{2}-\d{2}/.test(raw.trim()) ? fromText(raw, time) : null;
    // typing on: shape it; deleting: leave it as it is
    const next = pasted ? toText(new Date(pasted), sep) : raw.length > shownText.length ? mask(raw, sep) : raw;
    setText(next);
    if (!next.trim()) return clearable && value && onChange('');
    const v = pasted ?? fromText(next, time);
    if (!v || !yearOk(v)) return;
    if (v !== value) onChange(v);
    // the calendar shows the typed month
    const d = new Date(v);
    setShown(new Date(d.getFullYear(), d.getMonth(), 1));
    setView('days');
  };
  const openPicker = () => {
    const start = current ?? new Date();
    setShown(new Date(Math.min(maxYear, Math.max(minYear, start.getFullYear())), start.getMonth(), 1));
    setView('days');
    setOpen(true);
  };

  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(2024, 0, 1 + i))); // 2024-01-01 is a Monday
  }, [locale]);
  const monthRaw = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(shown);
  const monthTitle = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1); // only the first letter: "Ноябрь 2026 г."

  // six weeks from the Monday on or before the 1st
  const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const today = new Date();

  const [hh, mm] = (current ? `${pad(current.getHours())}:${pad(current.getMinutes())}` : defaultTime).split(':');
  // the time is typed freely and applied when the field is left (or Enter)
  const [draft, setDraft] = useState<{ h: string; m: string } | null>(null);
  const applyTime = (h: string | number, m: string | number) => {
    setText(null);
    const base = current ?? new Date(shown.getFullYear(), shown.getMonth(), 1);
    const hours = Math.min(23, Math.max(0, Number(h) || 0));
    const minutes = Math.min(59, Math.max(0, Number(m) || 0));
    onChange(toLocalInput(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes)));
  };
  const commitTime = () => {
    if (!draft) return;
    applyTime(draft.h, draft.m);
    setDraft(null);
  };
  const timeInput = (part: 'h' | 'm') => ({
    type: 'text',
    inputMode: 'numeric' as const,
    maxLength: 2,
    value: draft ? draft[part] : part === 'h' ? hh : mm,
    onFocus: (e: FocusEvent<HTMLInputElement>) => e.target.select(),
    onChange: (e: ChangeEvent<HTMLInputElement>) => setDraft({ h: draft?.h ?? hh, m: draft?.m ?? mm, [part]: e.target.value.replace(/\D/g, '') }),
    onBlur: commitTime,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && commitTime(),
  });
  const pickDay = (d: Date) => (setText(null), input.current?.blur(), onChange(toLocalInput(new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(hh), Number(mm)))));
  // days -> (title) months of a year -> (title) years; picking a year or a month goes back down
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  // the time columns sit beside the calendar, or under it when the window is narrow
  const place = useFloating(open, box, pop, 'left', () => Math.min(innerWidth - 16, innerWidth <= 480 ? 320 : 410), [shown, view]);
  const inRange = (y: number) => y >= minYear && y <= maxYear;
  const shiftMonth = (n: number) => setShown(new Date(shown.getFullYear(), shown.getMonth() + n, 1));
  const shiftYear = (n: number) => setShown(new Date(Math.min(maxYear, Math.max(minYear, shown.getFullYear() + n)), shown.getMonth(), 1));
  const canMonth = (n: number) => inRange(new Date(shown.getFullYear(), shown.getMonth() + n, 1).getFullYear());
  // the 12 years shown end with the newest allowed one, so the current year is always on the first page
  const decadeStart = maxYear - 11 - Math.floor((maxYear - shown.getFullYear()) / 12) * 12;
  const monthNames = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { month: 'short' });
    return Array.from({ length: 12 }, (_, m) => f.format(new Date(2024, m, 1)).replace('.', ''));
  }, [locale]);

  return (
    <div className="dtf" ref={ref}>
      <div
        ref={box}
        className={`dtf-box ${open ? 'dtf-open' : ''} ${current && clearable ? 'dtf-has-clear' : ''}`}
        // a click on the frame around the text goes to the text
        onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), input.current?.focus())}
      >
        <button
          type="button"
          className="dtf-cal-btn"
          onClick={() => (open ? close() : openPicker())}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${ariaLabel ?? placeholder}: ${t('time.calendar')}`}
          title={t('time.calendar')}
        >
          <Icon name="calendar" size={16} />
        </button>
        <input
          ref={input}
          className="dtf-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={shownText}
          // the shape to type in once it is focused, its role ("from", "to") before
          placeholder={focused ? pattern : placeholder}
          title={current ? dateTime(current.getTime()) : pattern}
          aria-label={ariaLabel ? `${ariaLabel} (${pattern})` : pattern}
          onChange={(e) => type(e.target.value)}
          onFocus={() => setFocused(true)}
          // a mouse click opens the calendar too; on a touch screen it is the keyboard's turn
          onClick={() => !open && !matchMedia('(pointer: coarse)').matches && openPicker()}
          onBlur={() => (setFocused(false), finish())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // keeps what was typed (or puts the value back) instead of sending a form
              e.preventDefault();
              finish();
              close();
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation();
              close();
            } else if (e.key === 'ArrowDown' && !open) {
              e.preventDefault();
              openPicker();
            }
          }}
        />
      </div>
      {current && clearable && (
        <button type="button" className="icon-btn dtf-clear" onClick={() => (setText(null), onChange(''))} aria-label={t('filter.clear')} title={t('filter.clear')}>
          <Icon name="close" size={14} />
        </button>
      )}
      {open &&
        createPortal(
          <div ref={pop} className="multiselect-pop picker-pop dtf-pop" role="dialog" aria-label={ariaLabel} style={place ? { top: place.top, left: place.left, width: place.width } : { visibility: 'hidden' }}>
            <div className="dtf-body">
              <div className="dtf-cal">
                {view === 'days' && (
                  <>
                    <div className="dtf-head">
                      <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)} disabled={!canMonth(-1)} aria-label={t('page.prev')}>
                        <Icon name="chevronLeft" size={18} />
                      </button>
                      <button type="button" className="dtf-title" onClick={() => setView('months')}>
                        {monthTitle}
                        <Icon name="chevronDown" size={14} />
                      </button>
                      <button type="button" className="icon-btn" onClick={() => shiftMonth(1)} disabled={!canMonth(1)} aria-label={t('page.next')}>
                        <Icon name="chevronRight" size={18} />
                      </button>
                    </div>
                    <div className="dtf-grid">
                      {weekdays.map((w) => (
                        <span key={w} className="dtf-wd">
                          {w}
                        </span>
                      ))}
                      {days.map((d) => (
                        <button
                          key={d.getTime()}
                          type="button"
                          className={`dtf-day ${d.getMonth() === shown.getMonth() ? '' : 'dtf-other'} ${sameDay(d, today) ? 'dtf-today' : ''} ${current && sameDay(d, current) ? 'dtf-chosen' : ''}`}
                          onClick={() => pickDay(d)}
                          disabled={!inRange(d.getFullYear())}
                          aria-pressed={!!current && sameDay(d, current)}
                        >
                          {d.getDate()}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {view === 'months' && (
                  <>
                    <div className="dtf-head">
                      <button type="button" className="icon-btn" onClick={() => shiftYear(-1)} disabled={shown.getFullYear() <= minYear} aria-label={t('page.prev')}>
                        <Icon name="chevronLeft" size={18} />
                      </button>
                      <button type="button" className="dtf-title" onClick={() => setView('years')}>
                        {shown.getFullYear()}
                        <Icon name="chevronDown" size={14} />
                      </button>
                      <button type="button" className="icon-btn" onClick={() => shiftYear(1)} disabled={shown.getFullYear() >= maxYear} aria-label={t('page.next')}>
                        <Icon name="chevronRight" size={18} />
                      </button>
                    </div>
                    <div className="dtf-cells">
                      {monthNames.map((name, m) => {
                        const isNow = today.getFullYear() === shown.getFullYear() && today.getMonth() === m;
                        const isChosen = !!current && current.getFullYear() === shown.getFullYear() && current.getMonth() === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            className={`dtf-day dtf-cell ${isNow ? 'dtf-today' : ''} ${isChosen ? 'dtf-chosen' : ''}`}
                            onClick={() => {
                              setShown(new Date(shown.getFullYear(), m, 1));
                              setView('days');
                            }}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                {view === 'years' && (
                  <>
                    <div className="dtf-head">
                      <button type="button" className="icon-btn" onClick={() => shiftYear(-12)} disabled={decadeStart <= minYear} aria-label={t('page.prev')}>
                        <Icon name="chevronLeft" size={18} />
                      </button>
                      <strong className="dtf-title-static">
                        {Math.max(minYear, decadeStart)} – {decadeStart + 11}
                      </strong>
                      <button type="button" className="icon-btn" onClick={() => shiftYear(12)} disabled={decadeStart + 11 >= maxYear} aria-label={t('page.next')}>
                        <Icon name="chevronRight" size={18} />
                      </button>
                    </div>
                    <div className="dtf-cells">
                      {/* years before the first allowed one are left out, not greyed */}
                      {Array.from({ length: 12 }, (_, i) => decadeStart + i)
                        .filter((y) => y >= minYear)
                        .map((y) => (
                          <button
                            key={y}
                            type="button"
                            className={`dtf-day dtf-cell ${today.getFullYear() === y ? 'dtf-today' : ''} ${current?.getFullYear() === y ? 'dtf-chosen' : ''}`}
                            disabled={!inRange(y)}
                            onClick={() => {
                              setShown(new Date(y, shown.getMonth(), 1));
                              setView('months');
                            }}
                          >
                            {y}
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>
              {/* hours and minutes next to the calendar: both stay in sight, one click each */}
              <div className="dtf-side">
                <span className="dtf-side-label">{t('time.hoursShort')}</span>
                <span className="dtf-side-label">{t('time.minutesShort')}</span>
                <TimeColumn count={24} value={Number(draft?.h ?? hh)} onPick={(h) => (setDraft(null), applyTime(h, draft?.m ?? mm))} label={t('time.hours')} />
                <TimeColumn count={60} value={Number(draft?.m ?? mm)} onPick={(m) => (setDraft(null), applyTime(draft?.h ?? hh, m))} label={t('time.minutes')} />
              </div>
            </div>
            <div className="dtf-foot">
              <span className="dtf-time">
                <Icon name="clock" size={16} />
                <input {...timeInput('h')} aria-label={t('time.hours')} />
                <span>:</span>
                <input {...timeInput('m')} aria-label={t('time.minutes')} />
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  commitTime();
                  close();
                }}
              >
                {t('common.done')}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** A scrolling column of two-digit values (hours or minutes); the chosen one is scrolled into view. */
function TimeColumn({ count, value, onPick, label }: { count: number; value: number; onPick: (v: number) => void; label: string }) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const center = () => {
      const el = list.current?.querySelector<HTMLElement>('.dtf-chosen');
      if (el && list.current) list.current.scrollTop = el.offsetTop - list.current.clientHeight / 2 + el.offsetHeight / 2;
    };
    center();
    // and again once the popover has its final size (it is placed after the first paint)
    const id = requestAnimationFrame(() => requestAnimationFrame(center));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <div className="dtf-time-col" ref={list} role="listbox" aria-label={label}>
      {Array.from({ length: count }, (_, v) => (
        <button key={v} type="button" role="option" aria-selected={v === value} className={`dtf-day ${v === value ? 'dtf-chosen' : ''}`} onClick={() => onPick(v)}>
          {pad(v)}
        </button>
      ))}
    </div>
  );
}
