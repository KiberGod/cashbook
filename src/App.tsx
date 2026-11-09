import { memo, useEffect, useLayoutEffect, useMemo } from 'react';
import { Footer, Sidebar, SyncBanner, Toasts, TopBar } from './components/Layout';
import { LinkMenu, TabProvider, useTabNav } from './components/Tabs';
import { TemplateFormHost, TxFormHost } from './components/TxForm';
import { AccountDetail, AccountsPage } from './pages/AccountsPage';
import { AssetDetail, AssetsPage } from './pages/AssetsPage';
import { CategoriesPage, CategoryDetail } from './pages/CategoriesPage';
import { ContactDetail, ContactsPage } from './pages/ContactsPage';
import { DebtDetail, DebtsPage } from './pages/DebtsPage';
import { AuthScreen, ConnectScreen, ErrorScreen, LoadingScreen, SetupScreen, UnlockScreen } from './pages/GateScreens';
import { ServiceDetail, ServicesPage } from './pages/ServicesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { TransactionDetail } from './pages/TransactionDetail';
import { TransactionsPage } from './pages/TransactionsPage';
import { useI18n } from './i18n';
import { getIndex } from './lib/stats';
import { NotFound } from './pages/common';
import { href, parseHash, type Route } from './router';
import { useStore } from './store/store';
import { setTabLimitNotice, tabHash, takePendingScroll, useTabs, type Tab } from './store/tabs';
import { showToast } from './store/ui';

const LISTS = {
  assets: AssetsPage,
  services: ServicesPage,
  contacts: ContactsPage,
  accounts: AccountsPage,
  categories: CategoriesPage,
  debts: DebtsPage,
};
const DETAILS = {
  assets: AssetDetail,
  services: ServiceDetail,
  contacts: ContactDetail,
  accounts: AccountDetail,
  categories: CategoryDetail,
  debts: DebtDetail,
};

/** The home page is the user's own contact, on its overview: the tab goes there in place of "home". */
function Home() {
  const data = useStore((s) => s.data);
  const self = getIndex(data).self;
  const nav = useTabNav();
  useLayoutEffect(() => {
    if (self) nav.navigate(href.detail('contacts', self.id), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [self?.id]);
  return self ? null : <NotFound />;
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'dashboard':
      return <Home />;
    case 'transactions':
      return <TransactionsPage query={route.query} />;
    case 'transaction':
      return <TransactionDetail key={route.id} id={route.id} />;
    case 'list': {
      const List = LISTS[route.kind];
      return <List />;
    }
    case 'detail': {
      const Detail = DETAILS[route.kind];
      return <Detail key={route.id} id={route.id} />;
    }
    case 'templates':
      return <TemplatesPage key={route.query.toString()} query={route.query} />;
    case 'settings':
      return <SettingsPage />;
  }
}

/**
 * One tab's page. Every open tab stays mounted (the hidden ones out of sight), so it keeps its
 * filters, typed text and dialogs; it re-renders only when its own page or its visibility changes
 * (and, like every page, when the data does).
 */
const TabPane = memo(function TabPane({ tab, active }: { tab: Tab; active: boolean }) {
  const hash = tabHash(tab);
  const value = useMemo(() => ({ id: tab.id, hash, active }), [tab.id, hash, active]);
  return (
    <div className="tab-pane" data-tab={tab.id} hidden={!active}>
      <TabProvider value={value}>
        <Page route={parseHash(hash)} />
      </TabProvider>
    </div>
  );
});

function Shell() {
  const { t } = useI18n();
  const { tabs, active } = useTabs();
  const route = parseHash(tabHash(tabs.find((x) => x.id === active) ?? tabs[0]));

  useEffect(() => setTabLimitNotice(() => showToast(t('tabs.limit'))), [t]);
  // a tab shown again goes back to where it was scrolled; a new page starts at the top
  useLayoutEffect(() => {
    const y = takePendingScroll();
    if (y !== null) window.scrollTo(0, y);
  });

  return (
    <div className="app">
      <Sidebar route={route} />
      <div className="app-body">
        <TopBar route={route} />
        <main className="main">
          <SyncBanner />
          {tabs.map((tab) => (
            <TabPane key={tab.id} tab={tab} active={tab.id === active} />
          ))}
        </main>
        <Footer />
      </div>
      <TxFormHost />
      <TemplateFormHost />
      <LinkMenu />
      <Toasts />
    </div>
  );
}

export function App() {
  const phase = useStore((s) => s.phase);
  const error = useStore((s) => s.error);

  if (phase === 'loading') return <LoadingScreen />;
  if (phase === 'connect') return <ConnectScreen />;
  if (phase === 'auth') return <AuthScreen />;
  if (phase === 'setup') return <SetupScreen />;
  if (phase === 'unlock') return <UnlockScreen />;
  if (phase === 'error' && error) return <ErrorScreen error={error} />;
  return <Shell />;
}
