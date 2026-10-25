import { useMemo } from 'react';
import { AssetAmounts, EmptyState, Stat } from '../components/bits';
import { CashflowChart, ChartCard, Donut } from '../components/charts';
import { PageHead } from '../components/Layout';
import { TxList } from '../components/TxList';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { buckets, byCategory, cashflow, mainAsset, ownAccountIds, periodRange, totals } from '../lib/analytics';
import { add, getIndex, sortAccountsForPicker, type AssetMap } from '../lib/stats';
import { href, navigate } from '../router';
import { useStore } from '../store/store';
import { openTxForm } from '../store/ui';
import { AccountRow } from './AccountsPage';
import { DebtRow } from './DebtsPage';

export function DashboardPage() {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const own = useMemo(() => ownAccountIds(ix), [ix]);
  const self = ix.self ? ix.contact.get(ix.self.id) : undefined;

  const month = useMemo(() => {
    const [s, e] = periodRange({ mode: 'month', anchor: Date.now() })!;
    const txs = ix.txSorted.filter((x) => {
      const time = ix.time.get(x.id)!;
      return time >= s && time < e && (own.has(x.fromId) || own.has(x.toId));
    });
    return { txs, sum: totals(txs, own, own, true) };
  }, [ix, own]);

  const ownTxs = useMemo(() => ix.txSorted.filter((x) => own.has(x.fromId) || own.has(x.toId)), [ix, own]);
  const assetId = mainAsset(ownTxs, data.assets[0]?.id ?? '');
  const asset = ix.assets.get(assetId);

  const flow = useMemo(() => {
    const now = new Date();
    const bs = buckets(new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime(), Date.now() + 1, 'month');
    return cashflow(ix, ownTxs, bs, assetId, own, own, true);
  }, [ix, ownTxs, assetId, own]);
  const cats = useMemo(() => byCategory(ix, month.txs, assetId, 'out', own, own, true), [ix, month.txs, assetId, own]);

  const capital: AssetMap = self?.balances ?? new Map();
  const myAccounts = sortAccountsForPicker(ix, self?.accounts ?? [], locale);
  const selfId = ix.self?.id;
  const openDebts = data.debts
    .filter((d) => (d.creditorId === selfId || d.debtorId === selfId) && ix.debt.get(d.id)!.remaining !== 0)
    .slice(0, 5);
  const net: AssetMap = new Map();
  for (const [x, v] of month.sum.net) add(net, x, v);

  return (
    <>
      <PageHead
        title={t('nav.dashboard')}
        icon={<Icon name="dashboard" />}
        subtitle={t('dash.subtitle', { month: i18n.month(Date.now()) })}
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => openTxForm()}>
              <Icon name="plus" size={18} />
              {t('tx.add')}
            </button>
            <a className="btn" href={href.analytics()}>
              <Icon name="chart" size={18} />
              {t('dash.fullAnalytics')}
            </a>
          </>
        }
      />
      <div className="stats-row">
        <Stat label={t('dash.capital')} icon="coins" hint={t('dash.capitalHint')}>
          <AssetAmounts map={capital} assets={data.assets} />
        </Stat>
        <Stat label={t('stats.balanceWithDebts')} icon="handshake">
          <AssetAmounts map={self?.balancesWithDebts ?? new Map()} assets={data.assets} />
        </Stat>
      </div>
      <div className="stats-row">
        <Stat label={t('dash.incomeMonth')} icon="arrowIn">
          <AssetAmounts map={month.sum.income} assets={data.assets} />
        </Stat>
        <Stat label={t('dash.expenseMonth')} icon="arrowOut">
          <AssetAmounts map={month.sum.expense} assets={data.assets} />
        </Stat>
        <Stat label={t('dash.feesMonth')} icon="fee">
          <AssetAmounts map={month.sum.fees} assets={data.assets} />
        </Stat>
        <Stat label={t('dash.netMonth')} icon="chart">
          <AssetAmounts map={net} assets={data.assets} sign colored />
        </Stat>
      </div>

      <div className="chart-grid">
        <ChartCard
          title={t('dash.flow6', { asset: asset?.code ?? '' })}
          actions={
            <a className="btn btn-sm btn-ghost" href={href.analytics('cashflow')}>
              {t('common.more2')}
            </a>
          }
        >
          <CashflowChart points={flow} g="month" asset={asset} height={260} />
        </ChartCard>
        <ChartCard
          title={t('dash.categoriesMonth', { asset: asset?.code ?? '' })}
          actions={
            <a className="btn btn-sm btn-ghost" href={href.analytics('categories')}>
              {t('common.more2')}
            </a>
          }
        >
          <Donut
            slices={cats.map((r) => ({ key: r.id || '__none', label: r.id ? (ix.categories.get(r.id)?.name ?? '?') : t('tx.noCategory'), value: r.amount }))}
            asset={asset}
            otherLabel={t('analytics.other')}
            onPick={(k) => k !== '__none' && navigate(href.detail('categories', k))}
          />
        </ChartCard>
      </div>

      <div className="detail-grid detail-grid-2">
        <section className="panel">
          <div className="section-head">
            <h2>{t('dash.myAccounts')}</h2>
            <a className="btn btn-sm btn-ghost" href={href.list('accounts')}>
              {t('common.openAll')}
            </a>
          </div>
          {myAccounts.length ? (
            <div className="rows rows-compact">
              {myAccounts.map((a) => (
                <AccountRow key={a.id} a={a} />
              ))}
            </div>
          ) : (
            <EmptyState icon="wallet" text={t('accounts.empty')} />
          )}
        </section>
        <section className="panel">
          <div className="section-head">
            <h2>{t('dash.openDebts')}</h2>
            <a className="btn btn-sm btn-ghost" href={href.list('debts')}>
              {t('common.openAll')}
            </a>
          </div>
          {openDebts.length ? (
            <div className="rows rows-compact">
              {openDebts.map((d) => (
                <DebtRow key={d.id} d={d} />
              ))}
            </div>
          ) : (
            <p className="muted">{t('debts.none')}</p>
          )}
        </section>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>{t('dash.recent')}</h2>
          <a className="btn btn-sm btn-ghost" href={href.transactions()}>
            {t('common.openAll')}
          </a>
        </div>
        <TxList txs={ownTxs.slice(0, 10)} side={own} prefKey="dashTx" empty={t('dash.noTx')} />
      </section>
    </>
  );
}
