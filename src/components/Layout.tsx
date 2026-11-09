import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type UiIconName } from '../icons/ui';
import { useI18n } from '../i18n';
import type { DictKey } from '../i18n/en';
import { APP_VERSION } from '../lib/version';
import { href, type Route } from '../router';
import { getIndex } from '../lib/stats';
import { discardAndReload, flush, reload, signIn, useStore } from '../store/store';
import { openTxForm, useUi } from '../store/ui';
import { TabStrip } from './Tabs';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="logo" aria-hidden="true" style={{ width: size, height: size }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 3 3 17.5 12 21l9-3.5z" />
        <path d="M12 3v18" />
      </svg>
    </span>
  );
}

/** Simplified Google Sheets file mark. */
export function SheetsMark() {
  return (
    <svg className="sheets-mark" width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
      <path d="M1.5 0H9l5 5v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 0 16.5v-15A1.5 1.5 0 0 1 1.5 0z" fill="#0f9d58" />
      <path d="M9 0l5 5H10a1 1 0 0 1-1-1z" fill="#87ceac" />
      <path d="M3 8h8v6H3zm1 1v1.5h2.5V9zm3.5 0v1.5H10V9zM4 11.5V13h2.5v-1.5zm3.5 0V13H10v-1.5z" fill="#fff" fillRule="evenodd" />
    </svg>
  );
}

function SyncIndicator({ refreshing }: { refreshing: boolean }) {
  const { t } = useI18n();
  const sync = useStore((s) => s.sync);
  const label = t(`sync.${sync}` as DictKey);
  return (
    <span className={`sync sync-${sync}`} aria-label={label} role="status">
      {sync === 'saving' || refreshing ? <span className="spinner" /> : sync === 'error' ? <Icon name="alert" size={18} /> : <span className="sync-dot" />}
    </span>
  );
}

interface NavItem {
  to: string;
  icon: UiIconName;
  label: DictKey;
  /** `self`: the user's own contact, whose page is the home page */
  active: (r: Route, self: string) => boolean;
}

const isSelf = (r: Route, self: string) => r.name === 'detail' && r.kind === 'contacts' && r.id === self;

const NAV: NavItem[][] = [
  [
    { to: href.dashboard(), icon: 'dashboard', label: 'nav.dashboard', active: (r, self) => r.name === 'dashboard' || isSelf(r, self) },
  ],
  [
    { to: href.list('contacts'), icon: 'users', label: 'nav.contacts', active: (r, self) => 'kind' in r && r.kind === 'contacts' && !isSelf(r, self) },
    { to: href.list('accounts'), icon: 'wallet', label: 'nav.accounts', active: (r) => 'kind' in r && r.kind === 'accounts' },
    { to: href.transactions(), icon: 'swap', label: 'nav.transactions', active: (r) => r.name === 'transactions' || r.name === 'transaction' },
    { to: href.list('debts'), icon: 'handshake', label: 'nav.debts', active: (r) => 'kind' in r && r.kind === 'debts' },
  ],
  [
    { to: href.list('categories'), icon: 'tag', label: 'nav.categories', active: (r) => 'kind' in r && r.kind === 'categories' },
    { to: href.list('assets'), icon: 'currency', label: 'nav.assets', active: (r) => 'kind' in r && r.kind === 'assets' },
    { to: href.list('services'), icon: 'bank', label: 'nav.servicesShort', active: (r) => 'kind' in r && r.kind === 'services' },
    { to: href.templates(), icon: 'template', label: 'nav.templates', active: (r) => r.name === 'templates' },
  ],
  [{ to: href.settings(), icon: 'settings', label: 'settings.title', active: (r) => r.name === 'settings' }],
];

function NavLinks({ route, onPick }: { route: Route; onPick?: () => void }) {
  const { t } = useI18n();
  const self = useStore((s) => getIndex(s.data).self?.id ?? '');
  return (
    <>
      {NAV.map((group, i) => (
        <div className="nav-group" key={i}>
          {group.map((n) => (
            <a key={n.to} href={n.to} className={n.active(route, self) ? 'active' : ''} onClick={onPick}>
              <Icon name={n.icon} size={19} />
              <span>{t(n.label)}</span>
            </a>
          ))}
        </div>
      ))}
    </>
  );
}

/** The connected spreadsheet: its name and sync state; a click re-reads it. */
function SheetStatus() {
  const { t } = useI18n();
  const title = useStore((s) => s.title);
  const refreshing = useStore((s) => s.refreshing);
  return (
    <button
      type="button"
      className="sheet-status"
      onClick={() => void reload()}
      disabled={refreshing}
      title={title ? `${title} · ${t('refresh')}` : t('refresh')}
      aria-label={`${t('refresh')}: ${title}`}
    >
      <SheetsMark />
      {title && <span className="sheet-status-name">{title}</span>}
      <SyncIndicator refreshing={refreshing} />
    </button>
  );
}

export function Sidebar({ route }: { route: Route }) {
  return (
    <aside className="sidebar">
      <a className="brand" href={href.dashboard()}>
        <Logo />
        <span>Cashbook</span>
      </a>
      <nav className="side-nav">
        <NavLinks route={route} />
      </nav>
      {/* the connected spreadsheet: its name and sync state; a click re-reads it */}
      <div className="sidebar-foot">
        <SheetStatus />
      </div>
    </aside>
  );
}

/** The top bar: the tabs, like a browser's (on a phone also the menu and "add a transaction"). */
export function TopBar({ route }: { route: Route }) {
  const { t } = useI18n();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [route]);

  return (
    <header className="topbar">
      <button type="button" className="icon-btn mobile-only" onClick={() => setDrawer(true)} aria-label={t('nav.menu')}>
        <Icon name="menu" />
      </button>
      <TabStrip />
      <button type="button" className="btn btn-primary btn-sm mobile-only topbar-add" onClick={() => openTxForm()} aria-label={t('tx.add')}>
        <Icon name="plus" size={18} />
      </button>
      {/* in a portal: the top bar's blur would otherwise make it the drawer's frame */}
      {drawer &&
        createPortal(
          <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
            <div className="drawer">
              <div className="drawer-head">
                <a className="brand" href={href.dashboard()}>
                  <Logo size={28} />
                  <span>Cashbook</span>
                </a>
                <button type="button" className="icon-btn" onClick={() => setDrawer(false)} aria-label={t('common.close')}>
                  <Icon name="close" />
                </button>
              </div>
              <nav className="side-nav">
                <NavLinks route={route} onPick={() => setDrawer(false)} />
              </nav>
              <div className="sidebar-foot">
                <SheetStatus />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </header>
  );
}

export function SyncBanner() {
  const { t } = useI18n();
  const syncError = useStore((s) => s.syncError);
  if (!syncError) return null;

  if (syncError.code === 'auth') {
    return (
      <div className="banner banner-warn">
        <Icon name="alert" />
        <span>{t('banner.auth')}</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void signIn()}>
          {t('banner.authButton')}
        </button>
      </div>
    );
  }
  if (syncError.code === 'formatChanged') {
    return (
      <div className="banner banner-error">
        <Icon name="alert" />
        <span>{t('banner.formatChanged')}</span>
        <button type="button" className="btn btn-sm" onClick={() => void discardAndReload()}>
          {t('banner.reload')}
        </button>
      </div>
    );
  }
  if (syncError.code === 'readOnly') {
    return (
      <div className="banner banner-error">
        <Icon name="alert" />
        <span>{t('banner.readOnly')}</span>
        <a className="btn btn-sm" href={href.settings()}>
          {t('banner.change')}
        </a>
      </div>
    );
  }
  return (
    <div className="banner banner-error">
      <Icon name="alert" />
      <span>
        {t('banner.error')} {t(`error.${syncError.code}` as DictKey, { message: syncError.message })}
      </span>
      <button type="button" className="btn btn-sm" onClick={() => void flush()}>
        {t('common.retry')}
      </button>
    </div>
  );
}

export function Toasts() {
  const { t } = useI18n();
  const loadedAt = useStore((s) => s.loadedAt);
  const toast = useUi((s) => s.toast);
  const first = useRef(loadedAt);
  // the last toast stays in the UI state: one raised before this mount (e.g. before signing in again) is old news
  const seen = useRef(toast);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!loadedAt || loadedAt === first.current) return;
    setText(t('refreshed'));
  }, [loadedAt]);
  useEffect(() => {
    if (toast && toast !== seen.current) setText(toast.text);
  }, [toast]);
  useEffect(() => {
    if (!text) return;
    const id = setTimeout(() => setText(null), 2200);
    return () => clearTimeout(id);
  }, [text]);
  return text ? (
    <div className="toast" role="status">
      <Icon name="check" size={18} />
      {text}
    </div>
  ) : null;
}

export function Footer() {
  return (
    <footer className="app-footer">
      Cashbook <span className="version">v{APP_VERSION}</span>
    </footer>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHead({
  crumbs,
  title,
  icon,
  actions,
  subtitle,
  badge,
}: {
  crumbs?: Crumb[];
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  subtitle?: ReactNode;
  /** a small mark right after the title, on its line */
  badge?: ReactNode;
}) {
  return (
    <div className="page-head">
      {crumbs && crumbs.length > 0 && (
        <nav className="crumbs" aria-label="breadcrumbs">
          {crumbs.map((c, i) => (
            <span key={i}>
              {c.href ? <a href={c.href}>{c.label}</a> : c.label}
              <Icon name="chevronRight" size={14} />
            </span>
          ))}
        </nav>
      )}
      <div className="page-title-row">
        <h1 className="page-title">
          {icon}
          <span>{title}</span>
          {badge}
        </h1>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {subtitle && <div className="page-subtitle">{subtitle}</div>}
    </div>
  );
}
