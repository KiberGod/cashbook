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

/**
 * The field always has the whole shape "dd.mm.yyyy hh:mm": 12 digit places (a digit, or null while
 * not typed yet) at these positions of the text; the rest are separators.
 */
const SLOTS = [0, 1, 3, 4, 6, 7, 8, 9, 11, 12, 14, 15];
// where each part (day, month, year, hours, minutes) starts, in digit places
const PART_START = [0, 2, 4, 8, 10];
type Digits = (string | null)[];
const BLANK: Digits = Array(12).fill(null);

const digitsOf = (d: Date, sep: string): Digits => SLOTS.map((i) => toText(d, sep)[i]);

/** The digits -> the field's text, with the letters of `pattern` ("дд.мм.гггг чч:мм") where none is typed yet. */
const render = (digits: Digits, pattern: string) => {
  const chars = [...pattern];
  SLOTS.forEach((at, i) => digits[i] !== null && (chars[at] = digits[i]!));
  return chars.join('');
};

const num = (digits: Digits, from: number, n: number) => Number(digits.slice(from, from + n).join(''));

/**
 * The digits -> a "YYYY-MM-DDTHH:mm" value; null while some are missing or it is not a real date.
 * No time typed at all takes `time` (the one set before, or the field's default).
 */
function fromDigits(digits: Digits, time: string): string | null {
  if (digits.slice(0, 8).some((x) => x === null)) return null;
  const noTime = digits.slice(8).every((x) => x === null);
  if (!noTime && digits.slice(8).some((x) => x === null)) return null;
  const [h, min] = noTime ? time.split(':').map(Number) : [num(digits, 8, 2), num(digits, 10, 2)];
  const day = num(digits, 0, 2);
  const month = num(digits, 2, 2);
  if (h > 23 || min > 59) return null;
  const d = new Date(num(digits, 4, 4), month - 1, day, h, min);
  // 31.02 rolls over into March: not a real date
  if (d.getDate() !== day || d.getMonth() !== month - 1) return null;
  return toLocalInput(d);
}

/** Pasted text -> a date: "2026-11-09 14:30", "09.11.2026 14:30" or "9.11.26" (then at `time`); null if it is none of these. */
function fromPaste(text: string, time: string): Date | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(t);
  const dmy = /^(\d{1,2})\D(\d{1,2})\D(\d{2}|\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?$/.exec(t);
  const m = iso ? [iso[3], iso[2], iso[1], iso[4], iso[5]] : dmy?.slice(1);
  if (!m) return null;
  const [day, month, y] = m.slice(0, 3).map(Number);
  const [th, tm] = m[3] !== undefined ? [m[3], m[4]] : time.split(':');
  const d = new Date(y < 100 ? 2000 + y : y, month - 1, day, Number(th), Number(tm));
  return d.getDate() === day && d.getMonth() === month - 1 ? d : null;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * A date and time picker in the app's own look: a text field in the shape "dd.mm.yyyy hh:mm"
 * whose digits are typed over one by one (the calendar follows them) and a calendar button that
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

  // what is being typed (digit by digit); null shows the value itself
  const sep = useMemo(() => dateSeparator(locale), [locale]);
  const pattern = t('time.pattern').toLowerCase().replaceAll('.', sep);
  const [draft, setDraftState] = useState<Digits | null>(null);
  const draftRef = useRef(draft);
  const setDraft = (d: Digits | null) => ((draftRef.current = d), setDraftState(d));
  // the digit place the next digit goes to: shown selected, so it is clear which digit changes
  const [pos, setPosState] = useState(0);
  const posRef = useRef(0);
  const setPos = (p: number) => ((posRef.current = Math.max(0, Math.min(11, p))), setPosState(posRef.current));
  const [focused, setFocused] = useState(false);
  // the user's own selection of more than one character (e.g. Ctrl+A) is left alone
  const wide = useRef(false);
  // a press of the pointer is placing the caret: the browser does it, the digit there is taken on release
  const pressing = useRef(false);
  const yearOk = (v: string) => {
    const y = Number(v.slice(0, 4));
    return y >= minYear && y <= maxYear;
  };
  const timeOf = () => (current ? `${pad(current.getHours())}:${pad(current.getMinutes())}` : defaultTime);
  const digits = draft ?? (focused ? (current ? digitsOf(current, sep) : BLANK) : null);
  const typedValue = draft && fromDigits(draft, timeOf());
  const blank = !!digits && digits.every((x) => x === null);
  // a whole date that is not a real one (or not in the allowed years); after the field is left, also a half-typed one
  const dateTyped = !!draft && draft.slice(0, 8).every((x) => x !== null) && (draft.slice(8).every((x) => x !== null) || draft.slice(8).every((x) => x === null));
  const invalid = !!draft && !blank && !(typedValue && yearOk(typedValue)) && (dateTyped || !focused);
  const shownText = digits ? render(digits, pattern) : current ? toText(current, sep) : '';

  // the value we gave out last: a value changed from outside (the calendar, a "reset filters") drops what was typed
  const sent = useRef(value);
  useLayoutEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    const d = parse(value);
    setDraft(document.activeElement === input.current ? (d ? digitsOf(d, sep) : [...BLANK]) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const send = (v: string) => {
    sent.current = v;
    if (v !== value) onChange(v);
  };

  /** A changed set of digits: shown as typed, and given out once it is a whole, allowed date. */
  const apply = (next: Digits) => {
    setDraft(next);
    if (next.every((x) => x === null)) return clearable && send('');
    const v = fromDigits(next, timeOf());
    if (!v || !yearOk(v)) return;
    send(v);
    // the calendar shows the typed month
    const d = new Date(v);
    setShown(new Date(d.getFullYear(), d.getMonth(), 1));
    setView('days');
  };
  const working = () => [...(draftRef.current ?? (current ? digitsOf(current, sep) : BLANK))];

  /**
   * A digit takes the place of the selected one and the selection moves on to the next digit
   * (over the separators). A first digit that can't start its part fills it at once: "7" in the
   * day gives "07", in the hours "07" too. A separator jumps to the next part.
   */
  const typeChar = (ch: string) => {
    wide.current = false;
    const next = working();
    let p = posRef.current;
    if (/\d/.test(ch)) {
      const part = PART_START.indexOf(p);
      const max = [3, 1, 9, 2, 5][part];
      if (part >= 0 && part !== 2 && Number(ch) > max) {
        next[p] = '0';
        next[p + 1] = ch;
        p += 2;
      } else {
        next[p] = ch;
        p += 1;
      }
      apply(next);
      setPos(Math.min(p, 11));
    } else if (/[.,/\-\s:]/.test(ch)) {
      const nextPart = PART_START.find((x) => x > p);
      if (nextPart !== undefined) setPos(nextPart);
    }
  };
  /** Pasted text: a whole date is taken at once, otherwise its digits fill the places from the selected one. */
  const paste = (text: string) => {
    wide.current = false;
    const d = fromPaste(text, timeOf());
    if (d) {
      apply(digitsOf(d, sep));
      setPos(11);
      return;
    }
    const next = working();
    let p = posRef.current;
    for (const ch of text.replace(/\D/g, '')) if (p < 12) next[p++] = ch;
    apply(next);
    setPos(Math.min(p, 11));
  };
  /** Ctrl+A and Backspace / Delete: the field is emptied (it then goes back to the value if one is required). */
  const clearAll = () => {
    wide.current = false;
    apply([...BLANK]);
    setPos(0);
  };

  // the input's own editing is replaced: the text always keeps its shape, digits are changed, never rubbed out
  const handler = useRef<(e: InputEvent) => void>(() => {});
  handler.current = (e: InputEvent) => {
    const el = input.current!;
    const many = (el.selectionEnd ?? 0) - (el.selectionStart ?? 0) > 1;
    if (e.inputType === 'insertCompositionText') return; // can't be stopped; the controlled value puts it back
    e.preventDefault();
    if (e.inputType.startsWith('insert')) {
      const data = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
      if (many && data.length === 1 && /\d/.test(data)) setPos(slotAt(el.selectionStart ?? 0));
      if (data.length > 1 || e.inputType === 'insertFromPaste') paste(data);
      else if (data) typeChar(data);
    } else if (e.inputType.startsWith('delete')) {
      // a digit is not rubbed out: Backspace steps back to the digit before, to type it over
      if (many) clearAll();
      else if (e.inputType.includes('Backward')) setPos(posRef.current - 1);
    }
  };
  useLayoutEffect(() => {
    const el = input.current!;
    const on = (e: Event) => handler.current(e as InputEvent);
    el.addEventListener('beforeinput', on);
    return () => el.removeEventListener('beforeinput', on);
  }, []);
  // the selected digit follows `pos` while the field is focused
  useLayoutEffect(() => {
    const el = input.current;
    if (!focused || !el || wide.current || pressing.current || document.activeElement !== el) return;
    el.setSelectionRange(SLOTS[pos], SLOTS[pos] + 1);
  });
  /** The digit place at (or next to) a text position: the digit right of it, else the one left of it. */
  const slotAt = (at: number) => {
    const exact = SLOTS.indexOf(at);
    if (exact >= 0) return exact;
    const left = SLOTS.indexOf(at - 1);
    if (left >= 0) return left;
    const i = SLOTS.findIndex((x) => x > at);
    return i < 0 ? 11 : i;
  };
  /** A click or a selection made by the user: the digit there is the one to change. */
  const onSelect = () => {
    const el = input.current;
    if (!el || document.activeElement !== el || pressing.current) return;
    const a = el.selectionStart ?? 0;
    const b = el.selectionEnd ?? 0;
    if (b - a > 1) return void (wide.current = true);
    wide.current = false;
    const p = slotAt(a);
    if (p !== posRef.current || b - a !== 1 || SLOTS[p] !== a) setPos(p);
  };
  /** The field is left: a whole date is kept as the value; a half-typed or wrong one stays in sight, in red. */
  const finish = () => {
    const d = draftRef.current;
    if (!d) return;
    if (d.every((x) => x === null)) {
      if (clearable) send('');
      return setDraft(null);
    }
    const v = fromDigits(d, timeOf());
    if (v && yearOk(v)) {
      send(v);
      setDraft(null);
    }
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
  const [timeDraft, setTimeDraft] = useState<{ h: string; m: string } | null>(null);
  const applyTime = (h: string | number, m: string | number) => {
    setDraft(null);
    const base = current ?? new Date(shown.getFullYear(), shown.getMonth(), 1);
    const hours = Math.min(23, Math.max(0, Number(h) || 0));
    const minutes = Math.min(59, Math.max(0, Number(m) || 0));
    onChange(toLocalInput(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes)));
  };
  const commitTime = () => {
    if (!timeDraft) return;
    applyTime(timeDraft.h, timeDraft.m);
    setTimeDraft(null);
  };
  const timeInput = (part: 'h' | 'm') => ({
    type: 'text',
    inputMode: 'numeric' as const,
    maxLength: 2,
    value: timeDraft ? timeDraft[part] : part === 'h' ? hh : mm,
    onFocus: (e: FocusEvent<HTMLInputElement>) => e.target.select(),
    onChange: (e: ChangeEvent<HTMLInputElement>) => setTimeDraft({ h: timeDraft?.h ?? hh, m: timeDraft?.m ?? mm, [part]: e.target.value.replace(/\D/g, '') }),
    onBlur: commitTime,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && commitTime(),
  });
  const pickDay = (d: Date) => (setDraft(null), input.current?.blur(), onChange(toLocalInput(new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(hh), Number(mm)))));
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
        className={`dtf-box ${open ? 'dtf-open' : ''} ${invalid ? 'dtf-invalid' : ''} ${(current || (draft && !blank)) && clearable ? 'dtf-has-clear' : ''}`}
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
          className={`dtf-input ${blank ? 'dtf-input-blank' : ''}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={shownText}
          placeholder={placeholder}
          title={current ? dateTime(current.getTime()) : pattern}
          aria-label={ariaLabel ? `${ariaLabel} (${pattern})` : pattern}
          aria-invalid={invalid || undefined}
          // the input's own editing is stopped in "beforeinput"; what slips through is put back by the controlled value
          onChange={() => {}}
          onSelect={onSelect}
          onPointerDown={() => (pressing.current = true)}
          onPointerUp={() => {
            pressing.current = false;
            // a drag selects more than a digit: left as it is; a click picks the digit it landed on
            onSelect();
            // not past the first digit not typed yet: a blank field starts at its first digit
            const missing = (draftRef.current ?? (current ? [] : BLANK)).indexOf(null);
            if (!wide.current && missing >= 0 && posRef.current > missing) setPos(missing);
            const el = input.current;
            if (el && !wide.current) el.setSelectionRange(SLOTS[posRef.current], SLOTS[posRef.current] + 1);
          }}
          onFocus={() => {
            setFocused(true);
            wide.current = false;
          }}
          // a mouse click opens the calendar too; on a touch screen it is the keyboard's turn
          onClick={() => !open && !matchMedia('(pointer: coarse)').matches && openPicker()}
          onBlur={() => (setFocused(false), finish())}
          onKeyDown={(e) => {
            const nav: Record<string, number> = { ArrowLeft: posRef.current - 1, ArrowRight: posRef.current + 1, Home: 0, End: 11 };
            if (e.key in nav && !e.shiftKey) {
              e.preventDefault();
              wide.current = false;
              setPos(nav[e.key]);
            } else if (e.key === 'Enter') {
              // keeps what was typed instead of sending a form
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
      {(current || (draft && !blank)) && clearable && (
        <button type="button" className="icon-btn dtf-clear" onClick={() => (setDraft(null), send(''))} aria-label={t('filter.clear')} title={t('filter.clear')}>
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
                <TimeColumn count={24} value={Number(timeDraft?.h ?? hh)} onPick={(h) => (setTimeDraft(null), applyTime(h, timeDraft?.m ?? mm))} label={t('time.hours')} />
                <TimeColumn count={60} value={Number(timeDraft?.m ?? mm)} onPick={(m) => (setTimeDraft(null), applyTime(timeDraft?.h ?? hh, m))} label={t('time.minutes')} />
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
