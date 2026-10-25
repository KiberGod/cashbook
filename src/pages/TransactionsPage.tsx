import { useEffect, useMemo, useState } from 'react';
import { AssetAmounts, Stat } from '../components/bits';
import { PageHead } from '../components/Layout';
import { TxFilters } from '../components/TxFilters';
import { TxList } from '../components/TxList';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { emptyFilter, filterTransactions, ownAccountIds, totals, type TxFilter } from '../lib/analytics';
import { getIndex } from '../lib/stats';
import { useStore } from '../store/store';
import { openTxForm } from '../store/ui';

/** Initial filters from links like #/transactions?account=… (back-links from other pages). */
function fromQuery(q: URLSearchParams): TxFilter {
  const f = emptyFilter();
  const one = (k: string) => (q.get(k) ? [q.get(k)!] : []);
  return {
    ...f,
    accounts: one('account'),
    contacts: one('contact'),
    categories: one('category'),
    assets: one('asset'),
    debts: one('debt'),
    services: one('service'),
    forms: one('form'),
  };
}

export function TransactionsPage({ query }: { query: URLSearchParams }) {
  const { t, tn, num } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const qs = query.toString();
  const [filter, setFilter] = useState<TxFilter>(() => fromQuery(query));
  useEffect(() => setFilter(fromQuery(query)), [qs]);

  const txs = useMemo(() => filterTransactions(ix, filter), [ix, filter]);
  const own = useMemo(() => ownAccountIds(ix), [ix]);
  const sum = useMemo(() => totals(txs, own, own, true), [txs, own]);

  return (
    <>
      <PageHead
        title={t('nav.transactions')}
        icon={<Icon name="swap" />}
        subtitle={t('tx.subtitle')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => openTxForm()}>
            <Icon name="plus" size={18} />
            {t('tx.add')}
          </button>
        }
      />
      <TxFilters ix={ix} value={filter} onChange={setFilter} />
      <div className="stats-row stats-row-compact">
        <Stat label={t('tx.found')} hint={t('stats.inOutInternal', { in: num(sum.count.in), out: num(sum.count.out), internal: num(sum.count.internal) })}>
          {tn('counts.transactions', txs.length)}
        </Stat>
        <Stat label={t('stats.income')} icon="arrowIn" hint={t('stats.forMyAccounts')}>
          <AssetAmounts map={sum.income} assets={data.assets} />
        </Stat>
        <Stat label={t('stats.expense')} icon="arrowOut" hint={t('stats.forMyAccounts')}>
          <AssetAmounts map={sum.expense} assets={data.assets} />
        </Stat>
        <Stat label={t('stats.fees')} icon="fee">
          <AssetAmounts map={sum.fees} assets={data.assets} />
        </Stat>
      </div>
      <TxList txs={txs} side={own} q={filter.q} prefKey="transactions" resetKey={JSON.stringify(filter)} empty={data.transactions.length ? t('common.nothingFound') : t('tx.empty')} />
    </>
  );
}
