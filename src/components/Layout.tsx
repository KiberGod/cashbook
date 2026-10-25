import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type UiIconName } from '../icons/ui';
import { useI18n } from '../i18n';
import type { DictKey } from '../i18n/en';
import { APP_VERSION } from '../lib/version';
import { href, type Route } from '../router';
import { discardAndReload, flush, reload, signIn, useStore } from '../store/store';
import { openTxForm, useUi } from '../store/ui';

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

function SyncIndicator() {
  const { t } = useI18n();
  const sync = useStore((s) => s.sync);
  const label = t(`sync.${sync}` as DictKey);
  return (
    <span className={`sync sync-${sync}`} title={label} aria-label={label} role="status">
      {sync === 'saving' ? <span className="spinner" /> : sync === 'error' ? <Icon name="alert" size={18} /> : <span className="sync-dot" />}
    </span>
  );
}

interface NavItem {
  to: string;
  icon: UiIconName;
  label: DictKey;
  active: (r: Route) => boolean;
}

const NAV: NavItem[][] = [
  [
    { to: href.dashboard(), icon: 'dashboard', label: 'nav.dashboard', active: (r) => r.name === 'dashboard' },
    { to: href.analytics(), icon: 'chart', label: 'nav.analytics', active: (r) => r.name === 'analytics' },
    { to: href.transactions(), icon: 'swap', label: 'nav.transactions', active: (r) => r.name === 'transactions' },
  ],
  [
    { to: href.list('accounts'), icon: 'wallet', label: 'nav.accounts', active: (r) => 'kind' in r && r.kind === 'accounts' },
    { to: href.list('contacts'), icon: 'users', label: 'nav.contacts', active: (r) => 'kind' in r && r.kind === 'contacts' },
    { to: href.list('debts'), icon: 'handshake', label: 'nav.debts', active: (r) => 'kind' in r && r.kind === 'debts' },
  ],
  [
    { to: href.list('categories'), icon: 'tag', label: 'nav.categories', active: (r) => 'kind' in r && r.kind === 'categories' },
    { to: href.list('assets'), icon: 'coins', label: 'nav.assets', active: (r) => 'kind' in r && r.kind === 'assets' },
    { to: href.list('services'), icon: 'bank', label: 'nav.services', active: (r) => 'kind' in r && r.kind === 'services' },
  ],
  [{ to: href.settings(), icon: 'settings', label: 'settings.title', active: (r) => r.name === 'settings' }],
];

function NavLinks({ route, onPick }: { route: Route; onPick?: () => void }) {
  const { t } = useI18n();
  return (
    <>
      {NAV.map((group, i) => (
        <div className="nav-group" key={i}>
          {group.map((n) => (
            <a key={n.to} href={n.to} className={n.active(route) ? 'active' : ''} onClick={onPick}>
              <Icon name={n.icon} size={19} />
              <span>{t(n.label)}</span>
            </a>
          ))}
        </div>
      ))}
    </>
  );
}

export function Sidebar({ route }: { route: Route }) {
  const { t } = useI18n();
  const encrypted = useStore((s) => s.encrypted);
  const title = useStore((s) => s.title);
  return (
    <aside className="sidebar">
      <a className="brand" href={href.dashboard()}>
        <Logo />
        <span>Cashbook</span>
      </a>
      <button type="button" className="btn btn-primary btn-block add-tx" onClick={() => openTxForm()}>
        <Icon name="plus" size={18} />
        {t('tx.add')}
      </button>
      <nav className="side-nav">
        <NavLinks route={route} />
      </nav>
      <div className="sidebar-foot" title={title}>
        <Icon name={encrypted ? 'lock' : 'unlock'} size={14} />
        <span>{encrypted ? t('enc.on') : t('enc.off')}</span>
      </div>
    </aside>
  );
}

export function TopBar({ route }: { route: Route }) {
  const { t } = useI18n();
  const refreshing = useStore((s) => s.refreshing);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [route]);

  return (
    <header className="topbar">
      <button type="button" className="icon-btn mobile-only" onClick={() => setDrawer(true)} aria-label={t('nav.menu')}>
        <Icon name="menu" />
      </button>
      <a className="brand mobile-only" href={href.dashboard()}>
        <Logo size={28} />
        <span>Cashbook</span>
      </a>
      <SyncIndicator />
      <div className="topbar-actions">
        <button
          type="button"
          className={`icon-btn ${refreshing ? 'spin' : ''}`}
          onClick={() => void reload()}
          disabled={refreshing}
          aria-label={t('refresh')}
          title={t('refresh')}
        >
          <Icon name="refresh" />
        </button>
        <a className="icon-btn desktop-only" href={href.settings()} aria-label={t('settings.title')} title={t('settings.title')}>
          <Icon name="settings" />
        </a>
        <button type="button" className="btn btn-primary btn-sm mobile-only" onClick={() => openTxForm()} aria-label={t('tx.add')}>
          <Icon name="plus" size={18} />
        </button>
      </div>
      {drawer && (
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
          </div>
        </div>
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
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!loadedAt || loadedAt === first.current) return;
    setText(t('refreshed'));
  }, [loadedAt]);
  useEffect(() => {
    if (toast) setText(toast.text);
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
}: {
  crumbs?: Crumb[];
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  subtitle?: ReactNode;
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
        </h1>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {subtitle && <div className="page-subtitle">{subtitle}</div>}
    </div>
  );
}
