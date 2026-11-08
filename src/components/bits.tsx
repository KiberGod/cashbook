import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { resolveImage } from '../icons/builtin';
import { Icon, type UiIconName } from '../icons/ui';
import { useI18n } from '../i18n';
import { entries, money } from '../lib/format';
import { byName, matchRanges, matchesAny } from '../lib/search';
import type { AssetMap } from '../lib/stats';
import { readPref, writePref } from '../lib/storage';
import { showToast } from '../store/ui';
import { useViewState } from './viewState';
import type { Account, Asset, Contact, FormId, Service } from '../lib/types';

/** Picture (url / builtin) or, without one, a text symbol, an icon or the first letter on a tinted circle. */
export function Avatar({
  image,
  symbol,
  name,
  size = 36,
  square = false,
  fallback,
}: {
  image?: string;
  symbol?: string;
  name: string;
  size?: number;
  square?: boolean;
  /** icon shown instead of the letter when there is no picture */
  fallback?: UiIconName;
}) {
  const [failed, setFailed] = useState(false);
  const src = image ? resolveImage(image) : '';
  useEffect(() => setFailed(false), [src]);
  const style = { width: size, height: size, fontSize: Math.round(size * (symbol && symbol.length > 2 ? 0.34 : symbol && symbol.length === 2 ? 0.44 : 0.56)) };
  const cls = `avatar ${square ? 'avatar-square' : ''}`;
  if (src && !failed) {
    return (
      <span className={`${cls} avatar-img`} style={style}>
        <img src={src} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    );
  }
  const text = symbol || [...name.trim()][0]?.toUpperCase() || '?';
  return (
    <span className={cls} style={{ ...style, background: tint(name) }} aria-hidden="true">
      {fallback ? <Icon name={fallback} size={Math.round(size * 0.5)} /> : text}
    </span>
  );
}

/** Stable soft colour per name. */
function tint(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 50% / 0.22)`;
}

export function AssetIcon({ asset, size = 22 }: { asset: Asset | undefined; size?: number }) {
  if (!asset) return null;
  return <Avatar image={asset.image} symbol={asset.symbol || asset.code.slice(0, 3)} name={asset.code} size={size} />;
}

/** A contact as a small pill with its picture; the user's own contact is tinted. */
export function ContactChip({
  contact,
  query = '',
  href,
  inLink = false,
}: {
  contact: Contact | undefined;
  query?: string;
  /** makes it a link to the contact */
  href?: string;
  /** it sits inside another link (a whole card): a link can't hold a link, so it navigates by script */
  inLink?: boolean;
}) {
  if (!contact) return <span className="contact-chip">?</span>;
  const cls = `contact-chip ${contact.isSelf ? 'contact-chip-self' : ''} ${href ? 'contact-chip-link' : ''}`;
  const inner = (
    <>
      <Avatar image={contact.image} name={contact.name} size={18} />
      <span className="contact-chip-name">
        <Highlight text={contact.name} query={query} />
      </span>
    </>
  );
  if (href && inLink) {
    const go = (e: SyntheticEvent) => {
      e.preventDefault();
      e.stopPropagation();
      location.hash = href;
    };
    return (
      <span className={cls} role="link" tabIndex={0} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go(e)}>
        {inner}
      </span>
    );
  }
  return href ? (
    <a className={cls} href={href}>
      {inner}
    </a>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

export const FORM_ICON: Record<FormId, UiIconName> = { cash: 'cash', bank: 'card', crypto: 'crypto' };

/** An account's picture: its service's logo, or the icon of its form of funds on a soft disc. */
export function AccountIcon({ account, service, size = 22 }: { account: Account; service?: Service; size?: number }) {
  if (service?.image) return <Avatar image={service.image} name={service.name} size={size} />;
  return (
    <span className="avatar account-icon" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name={FORM_ICON[account.form]} size={Math.round(size * 0.62)} />
    </span>
  );
}

/** Renders text with the parts matching the search query marked. */
export function Highlight({ text, query = '' }: { text: string; query?: string }) {
  const ranges = matchRanges(text, query);
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  ranges.forEach(([start, end], i) => {
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <mark key={i} className="hl">
        {text.slice(start, end)}
      </mark>,
    );
    last = end;
  });
  if (last < text.length) parts.push(text.slice(last));
  // One wrapper, so a flex parent with a gap doesn't space the pieces apart.
  return <span>{parts}</span>;
}

export function SearchField({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="search-field">
      <Icon name="search" size={18} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        enterKeyHint="search"
      />
      {value && (
        <button type="button" className="search-clear" onClick={() => onChange('')} aria-label="×">
          <Icon name="close" size={16} />
        </button>
      )}
    </label>
  );
}

export interface MenuAction {
  label: string;
  icon: UiIconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** A "?" beside a field's title: its text shows in a bubble on hover or focus. */
export function InfoTip({ children, label }: { children: ReactNode; /** for screen readers */ label: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // over everything, so a modal body doesn't clip it
  const place = useFloating(open, btn, pop, 'left', () => Math.min(280, innerWidth - 16));
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="infotip"
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // a tap on a phone shows it; inside a <label> it must not reach the input
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <Icon name="info" size={14} />
      </button>
      {open &&
        createPortal(
          <div ref={pop} className="infotip-pop" role="tooltip" style={place ? { top: place.top, left: place.left, width: place.width } : { visibility: 'hidden' }}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

/** A small button that copies `value`: its icon turns into a tick for a moment and a toast says so. */
export function CopyButton({ value, label, copied }: { value: string; /** what is copied, for screen readers */ label: string; /** the toast */ copied: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      showToast(t('common.copyFailed'));
      return;
    }
    showToast(copied);
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1500);
  };
  return (
    <button type="button" className={`copy-btn ${done ? 'copy-btn-done' : ''}`} onClick={() => void copy()} aria-label={`${t('common.copy')}: ${label}`} title={t('common.copy')}>
      <Icon key={done ? 'done' : 'copy'} name={done ? 'check' : 'copy'} size={14} />
    </button>
  );
}

export function CardMenu({ actions }: { actions: MenuAction[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref, pop);
  // floats over the page, so a card (with overflow hidden, or under its neighbours) can't cover it
  const place = useFloating(open, btn, pop, 'right');
  // a press here is not the start of dragging the card or a click on it
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <div className="menu" ref={ref} onClick={stop} onPointerDown={stop} onMouseDown={stop} onTouchStart={stop} onKeyDown={stop}>
      <button
        ref={btn}
        type="button"
        className="icon-btn menu-trigger"
        aria-label={t('common.more')}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <Icon name="more" size={18} />
      </button>
      {open &&
        createPortal(
          <div ref={pop} className="menu-list menu-pop" role="menu" style={place ? { top: place.top, left: place.left } : { visibility: 'hidden' }}>
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                className={a.danger ? 'danger' : ''}
                disabled={a.disabled}
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  a.onSelect();
                }}
              >
                <Icon name={a.icon} size={16} />
                {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function EmptyState({ text, children, icon }: { text: string; children?: ReactNode; icon?: UiIconName }) {
  return (
    <div className="empty">
      {icon && <Icon name={icon} size={28} />}
      <p>{text}</p>
      {children}
    </div>
  );
}

/** Textarea that grows with its content (never scrolls); `rows` stays the minimum height. */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`; // + borders
  };
  useLayoutEffect(fit, [props.value]);
  return <textarea ref={ref} {...props} className={`autosize ${props.className ?? ''}`} />;
}

/**
 * A labelled form field. `group` renders a <div> instead of a <label>: a label forwards hover and
 * clicks to its first control, which is wrong when the field holds several controls.
 */
export function Field({
  label,
  children,
  hint,
  error,
  group = false,
  counter,
  className = '',
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  group?: boolean;
  /** [current, max] length counter */
  counter?: [number, number];
  className?: string;
}) {
  const content = (
    <>
      <span className="field-label">
        {label}
        {counter && <span className={`counter ${counter[0] > counter[1] ? 'over' : ''}`}>{`${counter[0]}/${counter[1]}`}</span>}
      </span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </>
  );
  return group ? (
    <div className={`field ${className}`} role="group">
      {content}
    </div>
  ) : (
    <label className={`field ${className}`}>{content}</label>
  );
}

// ---- pagination ----

export const PAGE_SIZES = [10, 25, 50, 100];

/** Slices a list into pages; the page size is remembered per list. Resets to page 1 when `resetKey` changes. */
/** Pages a list. The page number is kept per list and filter state (resetKey), so Back returns to it; other filters start at page 1. */
export function usePaged<T>(list: T[], prefKey: string, resetKey: unknown = null, defaultSize = 25) {
  const [size, setSizeState] = useState<number>(() => readPref(`pageSize.${prefKey}`, defaultSize));
  const [page, setPage] = useViewState(`page.${prefKey}|${String(resetKey)}|${size}`, 1);
  const pages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(page, pages);
  const items = useMemo(() => list.slice((current - 1) * size, current * size), [list, current, size]);
  return {
    items,
    page: current,
    pages,
    size,
    total: list.length,
    setPage,
    setSize: (n: number) => {
      writePref(`pageSize.${prefKey}`, n);
      setSizeState(n);
    },
  };
}

export function Pagination({ p }: { p: ReturnType<typeof usePaged<unknown>> }) {
  const { t } = useI18n();
  // shown on every non-empty list, so the page size can be picked before the list grows
  if (!p.total) return null;
  const nums: (number | '…')[] = [];
  for (let i = 1; i <= p.pages; i++) {
    if (i === 1 || i === p.pages || Math.abs(i - p.page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <nav className="pagination" aria-label={t('page.label')}>
      <button type="button" className="icon-btn" disabled={p.page <= 1} onClick={() => p.setPage(p.page - 1)} aria-label={t('page.prev')}>
        <Icon name="chevronLeft" size={18} />
      </button>
      {nums.map((n, i) =>
        n === '…' ? (
          <span key={`e${i}`} className="page-gap">
            …
          </span>
        ) : (
          <button key={n} type="button" className={`page-num ${n === p.page ? 'active' : ''}`} onClick={() => p.setPage(n)}>
            {n}
          </button>
        ),
      )}
      <button type="button" className="icon-btn" disabled={p.page >= p.pages} onClick={() => p.setPage(p.page + 1)} aria-label={t('page.next')}>
        <Icon name="chevronRight" size={18} />
      </button>
      <select className="select select-sm" value={p.size} onChange={(e) => p.setSize(Number(e.target.value))} aria-label={t('page.size')}>
        {PAGE_SIZES.map((s) => (
          <option key={s} value={s}>
            {t('page.perPage', { n: s })}
          </option>
        ))}
      </select>
    </nav>
  );
}

// ---- multi select ----

export interface Option {
  value: string;
  label: string;
  /** shown under the label in the list */
  hint?: string;
  icon?: ReactNode;
  /** indent (sub-category) */
  depth?: number;
  group?: string;
  /** shown before the group's name in its heading (Picker), e.g. the contact's picture */
  groupIcon?: ReactNode;
  /** the group's heading in a MultiSelect, instead of its name in small capitals (a tree's parent row) */
  groupRender?: ReactNode;
  /** what the closed Picker shows when this item is chosen, instead of its icon and label */
  chosen?: ReactNode;
  /** its row in the list (Picker, MultiSelect), instead of its icon, label and hint (which still serve the search) */
  render?: ReactNode;
  /** a highlight after the label, e.g. "it's you" */
  badge?: string;
  /** shown but can't be picked (Picker) */
  disabled?: boolean;
}

/** Contacts for a filter or picker: the user's own one first and marked, then the rest by name. */
export function useContactOptions(contacts: Contact[]): Option[] {
  const { t, locale } = useI18n();
  return useMemo(
    () =>
      [...contacts]
        .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || byName<Contact>(locale)(a, b))
        .map((c) => ({
          value: c.id,
          label: c.name,
          icon: <Avatar image={c.image} name={c.name} size={18} />,
          badge: c.isSelf ? t('contacts.meLong') : undefined,
        })),
    [contacts, locale, t],
  );
}

/** Dropdown with checkboxes and a search box. An empty selection means "all". */
/**
 * Places a popover rendered into <body> next to its anchor: under it, or above when there's
 * no room below; aligned to the anchor's left or right edge and kept inside the window.
 */
export function useFloating(open: boolean, anchor: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>, align: 'left' | 'right', width?: (anchorWidth: number) => number, deps: unknown[] = []) {
  const [place, setPlace] = useState<{ top: number; left: number; width?: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return setPlace(null);
    const measure = () => {
      if (!anchor.current) return;
      const r = anchor.current.getBoundingClientRect();
      const h = pop.current?.offsetHeight ?? 0;
      const w = width ? width(r.width) : (pop.current?.offsetWidth ?? 0);
      const left = Math.max(8, Math.min(align === 'left' ? r.left : r.right - w, innerWidth - w - 8));
      const below = r.bottom + 4;
      const top = below + h > innerHeight - 8 && r.top - 4 - h > 8 ? r.top - 4 - h : below;
      setPlace({ top, left, width: width ? w : undefined });
    };
    measure();
    requestAnimationFrame(measure); // again once the popover has its size
    addEventListener('resize', measure);
    addEventListener('scroll', measure, true);
    return () => {
      removeEventListener('resize', measure);
      removeEventListener('scroll', measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align, ...deps]);
  return place;
}

/** Closes a popover on a pointer press outside its elements or on Escape (which then doesn't reach a modal under it). */
export function useDismiss(open: boolean, close: () => void, ...refs: RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => !refs.some((r) => r.current?.contains(e.target as Node)) && close();
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    // capture phase: another menu or card that stops the event must not keep this one open
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close, ...refs]);
}

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  allLabel,
  summary: fixedSummary,
  searchable = options.length > 8,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  allLabel?: string;
  /** what the closed button shows, instead of "all" / the one chosen / "n chosen" */
  summary?: string;
  searchable?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);

  const selected = new Set(value);
  const shown = options.filter((o) => matchesAny(q, o.label, o.hint));
  const summary =
    fixedSummary ??
    (value.length === 0
      ? (allLabel ?? t('filter.all'))
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? '1')
        : t('filter.selected', { n: value.length }));
  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  let lastGroup: string | undefined;

  return (
    <div className={`multiselect ${value.length ? 'has-value' : ''}`} ref={ref}>
      <button type="button" className="multiselect-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="multiselect-label">{label}</span>
        <span className="multiselect-value">{summary}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="multiselect-pop">
          {searchable && (
            <div className="multiselect-search">
              <SearchField value={q} onChange={setQ} placeholder={t('filter.search')} autoFocus />
            </div>
          )}
          <div className="multiselect-list">
            {shown.length === 0 && <p className="muted multiselect-empty">{t('filter.noOptions')}</p>}
            {shown.map((o) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={o.value}>
                  {head && (o.groupRender ? <div className="multiselect-parent">{o.groupRender}</div> : <div className="multiselect-group">{head}</div>)}
                  <label className="multiselect-item" style={{ paddingLeft: 10 + (o.depth ?? 0) * 18 }}>
                    <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
                    {o.render ?? (
                      <>
                        {o.icon}
                        <span>
                          <Highlight text={o.label} query={q} />
                          {o.hint && <small className="muted"> · {o.hint}</small>}
                        </span>
                      </>
                    )}
                    {o.badge && <span className="badge badge-accent">{o.badge}</span>}
                  </label>
                </div>
              );
            })}
          </div>
          <div className="multiselect-foot">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange([])} disabled={!value.length}>
              {t('filter.clear')}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
              {t('common.done')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type PickerProps = {
  options: Option[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  ariaLabel?: string;
  /** least width of the list (a filter's list is at least 240px wide) */
  popWidth?: number;
} & ({ multiple?: false; value: string; onChange: (v: string) => void } | { multiple: true; value: string[]; onChange: (v: string[]) => void });

/**
 * A choice from a list whose items may have icons. With `label` it is a toolbar filter
 * that looks like MultiSelect; without, a form control that looks like a select.
 * `multiple` lets several items be ticked; the list then stays open while picking.
 */
export function Picker(props: PickerProps) {
  const { options, label, placeholder = '—', disabled = false, searchable = options.length > 8, ariaLabel, popWidth = label ? 240 : 0 } = props;
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQ('');
  }, []);
  useDismiss(open, close, ref, pop);
  // the list floats over everything (a modal body would clip it)
  const place = useFloating(open, btn, pop, 'left', (w) => Math.min(Math.max(w, popWidth), innerWidth - 16), [popWidth, q]);

  const selected = new Set(props.multiple ? props.value : [props.value]);
  const current = options.filter((o) => selected.has(o.value));
  // a group's name finds all of its items (a contact's name, its accounts)
  const shown = options.filter((o) => matchesAny(q, o.label, o.hint, o.group));
  let lastGroup: string | undefined;
  const pick = (v: string) => {
    if (props.multiple) return props.onChange(selected.has(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    props.onChange(v);
    close();
  };

  return (
    <div className={label ? 'multiselect' : 'multiselect picker'} ref={ref}>
      <button
        ref={btn}
        type="button"
        className={label ? 'multiselect-btn' : 'select picker-btn'}
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {label && <span className="multiselect-label">{label}</span>}
        {current.length ? (
          <span className={label ? 'multiselect-value' : 'picker-value'}>
            {current.map((o) => (
              <span key={o.value} className="picker-chosen">
                {o.chosen ?? (
                  <>
                    {o.icon}
                    <span className="ellipsis">{o.label}</span>
                  </>
                )}
              </span>
            ))}
          </span>
        ) : (
          <span className="picker-value muted">{placeholder}</span>
        )}
        {label && <Icon name="chevronDown" size={16} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            className="multiselect-pop picker-pop"
            style={place ? { top: place.top, left: place.left, width: place.width } : { visibility: 'hidden' }}
          >
            {searchable && (
              <div className="multiselect-search">
                <SearchField value={q} onChange={setQ} placeholder={t('filter.search')} autoFocus />
              </div>
            )}
            <div className="multiselect-list" role="listbox" aria-label={label ?? ariaLabel} aria-multiselectable={props.multiple || undefined}>
              {shown.length === 0 && <p className="muted multiselect-empty">{t('filter.noOptions')}</p>}
              {shown.map((o) => {
                const head = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                return (
                  <div key={o.value} role="presentation">
                    {head && (
                      <div className="multiselect-group picker-group">
                        {o.groupIcon}
                        <span className="ellipsis">{head}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected.has(o.value)}
                      aria-disabled={o.disabled || undefined}
                      disabled={o.disabled}
                      className={`multiselect-item picker-item ${selected.has(o.value) ? 'active' : ''}`}
                      style={o.depth ? { paddingLeft: 10 + o.depth * 18 } : undefined}
                      onClick={() => pick(o.value)}
                    >
                      {o.render ?? (
                        <>
                          {o.icon}
                          <span className="ellipsis">
                            <Highlight text={o.label} query={q} />
                            {o.hint && <small className="muted"> · {o.hint}</small>}
                          </span>
                        </>
                      )}
                      {o.badge && <span className="badge badge-accent">{o.badge}</span>}
                      {selected.has(o.value) && <Icon name="check" size={16} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ---- money ----

export function Money({ value, asset, sign = false, colored = false }: { value: number; asset: Asset | undefined; sign?: boolean; colored?: boolean }) {
  const i18n = useI18n();
  const cls = colored ? (value > 0 ? 'pos' : value < 0 ? 'neg' : '') : value < 0 ? 'neg' : '';
  return <span className={`money ${cls}`}>{money(i18n, value, asset, { sign })}</span>;
}

/** A list of amounts per asset, e.g. account balances. */
export function AssetAmounts({
  map,
  assets,
  empty = '—',
  sign = false,
  colored = false,
  keepZero = false,
  column = false,
}: {
  map: AssetMap;
  assets: Asset[];
  empty?: string;
  sign?: boolean;
  colored?: boolean;
  keepZero?: boolean;
  /** one amount per line instead of a wrapping row */
  column?: boolean;
}) {
  const list = entries(map, assets, { keepZero });
  if (!list.length) return <span className="muted">{empty}</span>;
  return (
    <span className={column ? 'amounts amounts-column' : 'amounts'}>
      {list.map(([a, v]) => (
        <span key={a.id} className="amount-chip">
          <AssetIcon asset={a} size={16} />
          <Money value={v} asset={a} sign={sign} colored={colored} />
        </span>
      ))}
    </span>
  );
}

export function FormBadge({ form }: { form: FormId }) {
  const { t } = useI18n();
  return <span className={`badge badge-${form}`}>{t(`form.${form}`)}</span>;
}

/**
 * A "?" button with a small list of controls, shown on hover or on a click (a tap on a phone).
 * Each item is "what to do — what it does".
 */
export function HelpPopover({ label, items }: { label: string; items: string[] }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(pinned, () => setPinned(false), box);
  const open = hover || pinned;
  return (
    <div className="help" ref={box} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" className="icon-btn help-btn" onClick={() => setPinned((p) => !p)} aria-expanded={open} aria-label={label}>
        ?
      </button>
      {open && (
        <div className="help-pop" role="tooltip">
          <dl>
            {items.map((item) => {
              const [how, what] = item.split(' — ');
              return (
                <div key={item}>
                  <dt>{how}</dt>
                  <dd>{what}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </div>
  );
}

/** An on / off switch with its label; the whole pill is the control. */
export function Switch({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} title={title}>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, children, hint, icon }: { label: string; children: ReactNode; hint?: ReactNode; icon?: UiIconName }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {icon && <Icon name={icon} size={16} />}
        {label}
      </div>
      <div className="stat-value">{children}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export interface TotalsRow {
  key: string;
  label: ReactNode;
  asset: Asset;
  total: number;
  own: number;
}

/** Totals over all accounts vs the user's own ones, and the user's share; rows skip zero lines. */
export function TotalsTable({ head, rows, footer, empty }: { head: string; rows: TotalsRow[]; footer?: TotalsRow; empty: string }) {
  const { t, num } = useI18n();
  const shown = rows.filter((r) => r.total !== 0 || r.own !== 0);
  if (!shown.length) return <span className="muted">{empty}</span>;
  const line = (r: TotalsRow) => {
    // negative balances elsewhere can push the share over 100% - shown as is; only a zero total has none
    const share = r.total !== 0 ? (r.own / r.total) * 100 : null;
    return (
      <tr key={r.key}>
        <td>{r.label}</td>
        <td className="num">
          <Money value={r.total} asset={r.asset} />
        </td>
        <td className="num">{r.own ? <Money value={r.own} asset={r.asset} /> : <span className="muted">—</span>}</td>
        <td className="num">{share === null ? <span className="muted">—</span> : `${num(share, 1)}%`}</td>
      </tr>
    );
  };
  return (
    <div className="table-wrap table-framed">
      <table className="table table-compact">
        <thead>
          <tr>
            <th>{head}</th>
            <th className="num">{t('totals.all')}</th>
            <th className="num">{t('totals.own')}</th>
            <th className="num">{t('totals.share')}</th>
          </tr>
        </thead>
        <tbody>{shown.map(line)}</tbody>
        {footer && shown.length > 1 && <tfoot>{line(footer)}</tfoot>}
      </table>
    </div>
  );
}

/** Small "used by" link list for back-references. */
/** Rows with an arrow at the end: a link (href) or, for things without a page, a button (onClick). */
export function LinkList({
  items,
  empty,
}: {
  items: { href?: string; onClick?: () => void; key?: string; label: string; icon?: ReactNode; badge?: ReactNode; meta?: ReactNode }[];
  empty: string;
}) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="link-list">
      {items.map((x) => {
        const content = (
          <>
            {x.icon}
            <span className="link-list-label">
              {x.label}
              {x.badge}
            </span>
            {x.meta && <span className="link-list-meta">{x.meta}</span>}
            <Icon name="chevronRight" size={16} />
          </>
        );
        return (
          <li key={x.key ?? (x.href ?? '') + x.label}>
            {x.href ? (
              <a href={x.href}>{content}</a>
            ) : (
              <button type="button" className="link-list-btn" onClick={x.onClick}>
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Remembered (per device) value of a small UI choice. */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => readPref(key, fallback));
  return [
    v,
    (x: T) => {
      writePref(key, x);
      setV(x);
    },
  ];
}
