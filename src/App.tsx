import { useEffect } from 'react';
import { Footer, Sidebar, SyncBanner, Toasts, TopBar } from './components/Layout';
import { TxFormHost } from './components/TxForm';
import { AccountDetail, AccountsPage } from './pages/AccountsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AssetDetail, AssetsPage } from './pages/AssetsPage';
import { CategoriesPage, CategoryDetail } from './pages/CategoriesPage';
import { ContactDetail, ContactsPage } from './pages/ContactsPage';
import { DashboardPage } from './pages/DashboardPage';
import { DebtDetail, DebtsPage } from './pages/DebtsPage';
import { AuthScreen, ConnectScreen, ErrorScreen, LoadingScreen, SetupScreen, UnlockScreen } from './pages/GateScreens';
import { ServiceDetail, ServicesPage } from './pages/ServicesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { parseHash, useHash, type Route } from './router';
import { useStore } from './store/store';

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

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'dashboard':
      return <DashboardPage />;
    case 'analytics':
      return <AnalyticsPage tab={route.tab} />;
    case 'transactions':
      return <TransactionsPage query={route.query} />;
    case 'list': {
      const List = LISTS[route.kind];
      return <List />;
    }
    case 'detail': {
      const Detail = DETAILS[route.kind];
      return <Detail key={route.id} id={route.id} />;
    }
    case 'settings':
      return <SettingsPage />;
  }
}

export function App() {
  const phase = useStore((s) => s.phase);
  const error = useStore((s) => s.error);
  const hash = useHash();
  const route = parseHash(hash);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [hash.split('?')[0]]);

  if (phase === 'loading') return <LoadingScreen />;
  if (phase === 'connect') return <ConnectScreen />;
  if (phase === 'auth') return <AuthScreen />;
  if (phase === 'setup') return <SetupScreen />;
  if (phase === 'unlock') return <UnlockScreen />;
  if (phase === 'error' && error) return <ErrorScreen error={error} />;

  return (
    <div className="app">
      <Sidebar route={route} />
      <div className="app-body">
        <TopBar route={route} />
        <main className="main">
          <SyncBanner />
          <Page route={route} />
        </main>
        <Footer />
      </div>
      <TxFormHost />
      <Toasts />
    </div>
  );
}
