import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { resolveImage } from '../icons/builtin';
import { Icon, type UiIconName } from '../icons/ui';
import { useI18n } from '../i18n';
import { entries, money } from '../lib/format';
import { matchRanges, matchesAny } from '../lib/search';
import type { AssetMap } from '../lib/stats';
import { readPref, writePref } from '../lib/storage';
import type { Asset, Contact, FormId } from '../lib/types';

/** Picture (url / builtin) or, without one, a text symbol or the first letter on a tinted circle. */
export function Avatar({
  image,
  symbol,
  name,
  size = 36,
  square = false,
}: {
  image?: string;
  symbol?: string;
  name: string;
  size?: number;
  square?: boolean;
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
      {text}
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
export function ContactChip({ contact, query = '' }: { contact: Contact | undefined; query?: string }) {
  if (!contact) return <span className="contact-chip">?</span>;
  return (
    <span className={contact.isSelf ? 'contact-chip contact-chip-self' : 'contact-chip'}>
      <Avatar image={contact.image} name={contact.name} size={18} />
      <Highlight text={contact.name} query={query} />
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

export function CardMenu({ actions }: { actions: MenuAction[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <button
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
      {open && (
        <div className="menu-list" role="menu">
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
        </div>
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
export function usePaged<T>(list: T[], prefKey: string, resetKey: unknown = null, defaultSize = 25) {
  const [size, setSizeState] = useState<number>(() => readPref(`pageSize.${prefKey}`, defaultSize));
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(list.length / size));
  useEffect(() => setPage(1), [resetKey, size]);
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
  if (p.total <= PAGE_SIZES[0]) return null;
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
}

/** Dropdown with checkboxes and a search box. An empty selection means "all". */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  allLabel,
  searchable = options.length > 8,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  allLabel?: string;
  searchable?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const selected = new Set(value);
  const shown = options.filter((o) => matchesAny(q, o.label, o.hint));
  const summary =
    value.length === 0
      ? (allLabel ?? t('filter.all'))
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? '1')
        : t('filter.selected', { n: value.length });
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
                  {head && <div className="multiselect-group">{head}</div>}
                  <label className="multiselect-item" style={{ paddingLeft: 10 + (o.depth ?? 0) * 18 }}>
                    <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
                    {o.icon}
                    <span>
                      <Highlight text={o.label} query={q} />
                      {o.hint && <small className="muted"> · {o.hint}</small>}
                    </span>
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
export function LinkList({ items, empty }: { items: { href: string; label: string; icon?: ReactNode; badge?: ReactNode; meta?: ReactNode }[]; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="link-list">
      {items.map((x) => (
        <li key={x.href + x.label}>
          <a href={x.href}>
            {x.icon}
            <span className="link-list-label">
              {x.label}
              {x.badge}
            </span>
            {x.meta && <span className="link-list-meta">{x.meta}</span>}
            <Icon name="chevronRight" size={16} />
          </a>
        </li>
      ))}
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
