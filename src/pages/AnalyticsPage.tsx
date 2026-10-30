import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ActivityCalendar } from '../components/ActivityCalendar';
import { AssetAmounts, AssetIcon, Avatar, EmptyState, Field, Money, MultiSelect, Segmented, Stat, usePref } from '../components/bits';
import { BalanceChart, BarList, CashflowChart, ChartCard, CountBars, Donut, useBucketLabel } from '../components/charts';
import { PageHead } from '../components/Layout';
import { useViewState } from '../components/viewState';
import { TxFilters, useFilterOptions } from '../components/TxFilters';
import { TxList } from '../components/TxList';
import { Icon, type UiIconName } from '../icons/ui';
import { useI18n } from '../i18n';
import type { DictKey } from '../i18n/en';
import {
  autoGranularity,
  balanceSeries,
  balancesAt,
  buckets,
  byCategory,
  cashflow,
  chartRange,
  counterparties,
  emptyFilter,
  feeBreakdown,
  filterTransactions,
  mainAsset,
  ownAccountIds,
  periodRange,
  timeOfActivity,
  totals,
  type Granularity,
  type TxFilter,
} from '../lib/analytics';
import { entries, money, toDateInput } from '../lib/format';
import { add, getIndex, round, type AssetMap, type Index } from '../lib/stats';
import type { Asset, Transaction } from '../lib/types';
import { href, navigate } from '../router';
import { useStore } from '../store/store';
import { DebtRow } from './DebtsPage';

const TABS: { key: string; icon: UiIconName; label: DictKey }[] = [
  { key: 'overview', icon: 'dashboard', label: 'analytics.overview' },
  { key: 'cashflow', icon: 'chart', label: 'analytics.cashflow' },
  { key: 'categories', icon: 'tag', label: 'analytics.categories' },
  { key: 'capital', icon: 'coins', label: 'analytics.capital' },
  { key: 'accounts', icon: 'wallet', label: 'analytics.accounts' },
  { key: 'parties', icon: 'users', label: 'analytics.parties' },
  { key: 'fees', icon: 'fee', label: 'analytics.fees' },
  { key: 'debts', icon: 'handshake', label: 'analytics.debts' },
  { key: 'activity', icon: 'calendar', label: 'analytics.activity' },
  { key: 'transactions', icon: 'swap', label: 'analytics.transactions' },
];

/** Everything a tab needs, computed once per change of filters. */
interface Ctx {
  ix: Index;
  assets: Asset[];
  txs: Transaction[];
  sel: Set<string>;
  own: Set<string>;
  ownTransfers: boolean;
  asset: Asset | undefined;
  g: Granularity;
  range: [number, number];
  filter: TxFilter;
}

export function AnalyticsPage({ tab }: { tab: string }) {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const opts = useFilterOptions(ix);
  const active = TABS.some((x) => x.key === tab) ? tab : 'overview';

  const [filter, setFilter] = useViewState<TxFilter>('analytics.filter', emptyFilter);
  const [accounts, setAccounts] = useViewState<string[]>('analytics.accounts', []);
  const [ownTransfers, setOwnTransfers] = usePref('analytics.ownTransfers', true);
  const [assetPick, setAssetPick] = useViewState('analytics.asset', '');
  const [gPick, setGPick] = usePref<'auto' | Granularity>('analytics.granularity', 'auto');

  const own = useMemo(() => ownAccountIds(ix), [ix]);
  const sel = useMemo(() => (accounts.length ? new Set(accounts) : own), [accounts, own]);
  const txs = useMemo(() => {
    // only transactions touching the selected accounts matter here
    const list = filterTransactions(ix, filter);
    return list.filter((x) => sel.has(x.fromId) || sel.has(x.toId));
  }, [ix, filter, sel]);
  const range = useMemo(() => chartRange(ix, filter.period), [ix, filter.period]);
  const g = gPick === 'auto' ? autoGranularity(range[0], range[1]) : gPick;
  const assetId = assetPick && ix.assets.has(assetPick) ? assetPick : mainAsset(txs, data.assets[0]?.id ?? '');
  const ctx: Ctx = { ix, assets: data.assets, txs, sel, own, ownTransfers, asset: ix.assets.get(assetId), g, range, filter };

  return (
    <>
      <PageHead title={t('nav.analytics')} icon={<Icon name="chart" />} />
      <div className="analytics-controls panel">
        <TxFilters ix={ix} value={filter} onChange={setFilter} />
        <div className="toolbar toolbar-tight">
          <MultiSelect
            label={t('analytics.accounts')}
            options={opts.accounts}
            value={accounts}
            onChange={setAccounts}
            allLabel={t('analytics.allMyAccounts')}
          />
          <Field label={t('analytics.chartAsset')}>
            <select className="select" value={assetId} onChange={(e) => setAssetPick(e.target.value)}>
              {data.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('analytics.granularity')}>
            <select className="select" value={gPick} onChange={(e) => setGPick(e.target.value as 'auto' | Granularity)}>
              {(['auto', 'day', 'week', 'month', 'year'] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`gran.${x}`)}
                </option>
              ))}
            </select>
          </Field>
          <label className="check filter-check" title={t('analytics.ownTransfersHint')}>
            <input type="checkbox" checked={ownTransfers} onChange={(e) => setOwnTransfers(e.target.checked)} />
            <span>{t('analytics.ownTransfers')}</span>
          </label>
        </div>
      </div>
      <nav className="subtabs" aria-label={t('nav.analytics')}>
        {TABS.map((x) => (
          <a key={x.key} href={href.analytics(x.key)} className={active === x.key ? 'active' : ''}>
            <Icon name={x.icon} size={16} />
            {t(x.label)}
          </a>
        ))}
      </nav>
      {active === 'overview' && <Overview c={ctx} />}
      {active === 'cashflow' && <Cashflow c={ctx} />}
      {active === 'categories' && <Categories c={ctx} />}
      {active === 'capital' && <Capital c={ctx} />}
      {active === 'accounts' && <AccountsTab c={ctx} />}
      {active === 'parties' && <Parties c={ctx} />}
      {active === 'fees' && <Fees c={ctx} />}
      {active === 'debts' && <Debts c={ctx} />}
      {active === 'activity' && <Activity c={ctx} />}
      {active === 'transactions' && <TxList txs={txs} side={sel} q={filter.q} prefKey="analyticsTx" resetKey={JSON.stringify(filter) + [...sel]} />}
    </>
  );
}

function selectedAccounts(c: Ctx) {
  return [...c.sel].map((id) => c.ix.accounts.get(id)!).filter(Boolean);
}

function Totals({ c }: { c: Ctx }) {
  const { t, num } = useI18n();
  const s = useMemo(() => totals(c.txs, c.sel, c.own, c.ownTransfers), [c.txs, c.sel, c.own, c.ownTransfers]);
  return (
    <div className="stats-row">
      <Stat label={t('stats.income')} icon="arrowIn" hint={t('stats.countN', { n: num(s.count.in) })}>
        <AssetAmounts map={s.income} assets={c.assets} />
      </Stat>
      <Stat label={t('stats.expense')} icon="arrowOut" hint={t('stats.countN', { n: num(s.count.out) })}>
        <AssetAmounts map={s.expense} assets={c.assets} />
      </Stat>
      <Stat label={t('stats.fees')} icon="fee">
        <AssetAmounts map={s.fees} assets={c.assets} />
      </Stat>
      <Stat label={t('stats.net')} icon="chart" hint={t('stats.netHint')}>
        <AssetAmounts map={s.net} assets={c.assets} sign colored />
      </Stat>
      <Stat label={t('stats.internal')} icon="swap" hint={t('stats.countN', { n: num(s.count.internal) })}>
        <AssetAmounts map={s.internal} assets={c.assets} />
      </Stat>
    </div>
  );
}

/** Current capital of the selection, with and without the user's debts. */
function Capital0({ c }: { c: Ctx }) {
  const { t } = useI18n();
  const accounts = selectedAccounts(c);
  const balances: AssetMap = new Map();
  for (const a of accounts) for (const [x, v] of c.ix.account.get(a.id)!.balances) add(balances, x, v);
  const self = c.ix.self ? c.ix.contact.get(c.ix.self.id) : undefined;
  const withDebts: AssetMap = new Map(balances);
  for (const [x, v] of self?.owedToMe ?? []) add(withDebts, x, v);
  for (const [x, v] of self?.iOwe ?? []) add(withDebts, x, -v);
  return (
    <div className="stats-row">
      <Stat label={t('analytics.capitalNow')} icon="coins" hint={t('analytics.capitalNowHint')}>
        <AssetAmounts map={balances} assets={c.assets} />
      </Stat>
      <Stat label={t('debts.owedToMeShort')} icon="arrowIn">
        <AssetAmounts map={self?.owedToMe ?? new Map()} assets={c.assets} />
      </Stat>
      <Stat label={t('debts.iOweShort')} icon="arrowOut">
        <AssetAmounts map={self?.iOwe ?? new Map()} assets={c.assets} />
      </Stat>
      <Stat label={t('stats.balanceWithDebts')} icon="handshake">
        <AssetAmounts map={withDebts} assets={c.assets} />
      </Stat>
    </div>
  );
}

function useFlow(c: Ctx) {
  return useMemo(() => {
    const bs = buckets(c.range[0], c.range[1], c.g);
    return cashflow(c.ix, c.txs, bs, c.asset?.id ?? '', c.sel, c.own, c.ownTransfers);
  }, [c.ix, c.txs, c.range, c.g, c.asset, c.sel, c.own, c.ownTransfers]);
}

function Overview({ c }: { c: Ctx }) {
  const { t, tn } = useI18n();
  const points = useFlow(c);
  const cats = useMemo(() => byCategory(c.ix, c.txs, c.asset?.id ?? '', 'out', c.sel, c.own, c.ownTransfers), [c]);
  const parties = useMemo(
    () => counterparties(c.ix, c.txs, c.sel, c.own, c.ownTransfers, 'contact').sort((a, b) => b.count - a.count).slice(0, 8),
    [c],
  );
  return (
    <>
      <Totals c={c} />
      <Capital0 c={c} />
      <div className="chart-grid">
        <ChartCard title={t('analytics.cashflowTitle', { asset: c.asset?.code ?? '' })}>
          <CashflowChart points={points} g={c.g} asset={c.asset} />
        </ChartCard>
        <ChartCard title={t('analytics.expenseByCategory', { asset: c.asset?.code ?? '' })}>
          <Donut
            slices={cats.map((r) => ({ key: r.id || '__none', label: r.id ? (c.ix.categories.get(r.id)?.name ?? '?') : t('tx.noCategory'), value: r.amount }))}
            asset={c.asset}
            otherLabel={t('analytics.other')}
            onPick={(k) => k !== '__none' && navigate(href.detail('categories', k))}
          />
        </ChartCard>
        <ChartCard title={t('analytics.topParties')}>
          {parties.length ? (
            <BarList
              rows={parties.map((p) => ({
                key: p.id || '_',
                label: partyName(c.ix, p.id, p.isAccount, t('tx.unknownParty')),
                value: p.count,
                text: tn('counts.transactions', p.count),
                href: p.id ? (p.isAccount ? href.detail('accounts', p.id) : href.detail('contacts', p.id)) : undefined,
              }))}
            />
          ) : (
            <p className="muted chart-empty">{t('analytics.noData')}</p>
          )}
        </ChartCard>
        <ChartCard title={t('analytics.recent')}>
          <TxList txs={c.txs.slice(0, 6)} side={c.sel} prefKey="overviewTx" />
        </ChartCard>
      </div>
    </>
  );
}

function partyName(ix: Index, id: string, isAccount: boolean, unknown: string) {
  if (!id) return unknown;
  return isAccount ? (ix.accounts.get(id)?.name ?? '?') : (ix.contacts.get(id)?.name ?? '?');
}

function Cashflow({ c }: { c: Ctx }) {
  const i18n = useI18n();
  const { t, num } = i18n;
  const points = useFlow(c);
  const label = useBucketLabel();
  const rows = [...points].reverse().filter((p) => p.income || p.expense || p.fees || p.count);
  return (
    <>
      <Totals c={c} />
      <ChartCard title={t('analytics.cashflowTitle', { asset: c.asset?.code ?? '' })} note={t('analytics.perAssetNote')}>
        <CashflowChart points={points} g={c.g} asset={c.asset} height={320} />
      </ChartCard>
      <section className="section">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('analytics.period')}</th>
                <th className="num">{t('stats.income')}</th>
                <th className="num">{t('stats.expense')}</th>
                <th className="num">{t('stats.fees')}</th>
                <th className="num">{t('stats.net')}</th>
                <th className="num">{t('stats.transactions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.start}>
                  <td>{label(p.start, c.g, true)}</td>
                  <td className="num">
                    <Money value={p.income} asset={c.asset} />
                  </td>
                  <td className="num">
                    <Money value={p.expense} asset={c.asset} />
                  </td>
                  <td className="num">
                    <Money value={p.fees} asset={c.asset} />
                  </td>
                  <td className="num">
                    <Money value={p.net} asset={c.asset} sign colored />
                  </td>
                  <td className="num">{num(p.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <EmptyState text={t('analytics.noData')} />}
        </div>
      </section>
    </>
  );
}

function Categories({ c }: { c: Ctx }) {
  const i18n = useI18n();
  const { t, num } = i18n;
  const [kind, setKind] = useState<'out' | 'in'>('out');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = useMemo(() => byCategory(c.ix, c.txs, c.asset?.id ?? '', kind, c.sel, c.own, c.ownTransfers), [c, kind]);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const name = (id: string) => (id ? (c.ix.categories.get(id)?.name ?? '?') : t('tx.noCategory'));
  const pct = (v: number) => (total ? `${Math.round((v / total) * 1000) / 10}%` : '—');

  return (
    <>
      <div className="toolbar">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'out', label: t('stats.expense') },
            { value: 'in', label: t('stats.income') },
          ]}
        />
        <span className="muted">{t('analytics.categoriesHint', { asset: c.asset?.code ?? '' })}</span>
      </div>
      <div className="chart-grid">
        <ChartCard title={kind === 'out' ? t('analytics.expenseByCategory', { asset: c.asset?.code ?? '' }) : t('analytics.incomeByCategory', { asset: c.asset?.code ?? '' })}>
          <Donut
            slices={rows.map((r) => ({ key: r.id || '__none', label: name(r.id), value: r.amount }))}
            asset={c.asset}
            otherLabel={t('analytics.other')}
            onPick={(k) => k !== '__none' && navigate(href.detail('categories', k))}
          />
        </ChartCard>
        <section className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('tx.category')}</th>
                  <th className="num">{t('stats.transactions')}</th>
                  <th className="num">{t('analytics.amount')}</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id || '_'}>
                    <tr className={r.children.length ? 'expandable' : ''} onClick={() => r.children.length && setOpen(toggle(open, r.id))}>
                      <td>
                        {r.children.length > 0 && <Icon name={open.has(r.id) ? 'chevronDown' : 'chevronRight'} size={14} />} {r.id ? <a href={href.transactions({ category: r.id })} onClick={(e) => e.stopPropagation()}>{name(r.id)}</a> : name(r.id)}
                      </td>
                      <td className="num">{num(r.count)}</td>
                      <td className="num">
                        <Money value={r.amount} asset={c.asset} />
                      </td>
                      <td className="num">{pct(r.amount)}</td>
                    </tr>
                    {open.has(r.id) &&
                      r.children.map((ch) => (
                        <tr key={ch.id} className="sub-row">
                          <td>
                            <a href={href.transactions({ category: ch.id })}>{ch.id === r.id ? t('analytics.directly') : name(ch.id)}</a>
                          </td>
                          <td className="num">{num(ch.count)}</td>
                          <td className="num">
                            <Money value={ch.amount} asset={c.asset} />
                          </td>
                          <td className="num">{pct(ch.amount)}</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {!rows.length && <EmptyState text={t('analytics.noData')} />}
          </div>
        </section>
      </div>
    </>
  );
}

const toggle = (s: Set<string>, k: string) => {
  const n = new Set(s);
  if (n.has(k)) n.delete(k);
  else n.add(k);
  return n;
};

function Capital({ c }: { c: Ctx }) {
  const i18n = useI18n();
  const { t } = i18n;
  const accounts = selectedAccounts(c);
  const accKey = accounts.map((a) => a.id).join();
  const series = useMemo(() => balanceSeries(c.ix, accounts, buckets(c.range[0], c.range[1], c.g), c.asset?.id ?? ''), [c, accKey]);
  const r = periodRange(c.filter.period);
  const startAt = r && Number.isFinite(r[0]) ? r[0] : c.range[0];
  const endAt = Math.min(r && Number.isFinite(r[1]) ? r[1] : Date.now() + 1, Date.now() + 1);
  const atStart = useMemo(() => balancesAt(c.ix, accounts, startAt), [c.ix, accKey, startAt]);
  const atEnd = useMemo(() => balancesAt(c.ix, accounts, endAt), [c.ix, accKey, endAt]);
  const change: AssetMap = new Map(atEnd);
  for (const [x, v] of atStart) add(change, x, -v);

  const today = new Date();
  const [dateA, setDateA] = useState(toDateInput(new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())));
  const [dateB, setDateB] = useState(toDateInput(today));
  const endOf = (d: string) => new Date(`${d}T00:00`).getTime() + 86_400_000;
  const a = useMemo(() => (dateA ? balancesAt(c.ix, accounts, endOf(dateA)) : new Map()), [c.ix, accKey, dateA]);
  const b = useMemo(() => (dateB ? balancesAt(c.ix, accounts, endOf(dateB)) : new Map()), [c.ix, accKey, dateB]);
  const compareAssets = c.assets.filter((x) => a.get(x.id) || b.get(x.id));

  return (
    <>
      <div className="stats-row">
        <Stat label={t('analytics.atStart')} hint={i18n.date(startAt)}>
          <AssetAmounts map={atStart} assets={c.assets} />
        </Stat>
        <Stat label={t('analytics.atEnd')} hint={i18n.date(endAt - 1)}>
          <AssetAmounts map={atEnd} assets={c.assets} />
        </Stat>
        <Stat label={t('analytics.change')}>
          <AssetAmounts map={change} assets={c.assets} sign colored />
        </Stat>
      </div>
      <ChartCard title={t('analytics.capitalTrend', { asset: c.asset?.code ?? '' })} note={t('analytics.capitalNote')}>
        <BalanceChart points={series} g={c.g} asset={c.asset} height={320} />
      </ChartCard>
      <Capital0 c={c} />
      <ChartCard title={t('analytics.compare')}>
        <div className="toolbar">
          <Field label={t('analytics.dateA')}>
            <input type="date" value={dateA} onChange={(e) => setDateA(e.target.value)} />
          </Field>
          <Field label={t('analytics.dateB')}>
            <input type="date" value={dateB} onChange={(e) => setDateB(e.target.value)} />
          </Field>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('filter.asset')}</th>
                <th className="num">{dateA ? i18n.date(endOf(dateA) - 1) : 'A'}</th>
                <th className="num">{dateB ? i18n.date(endOf(dateB) - 1) : 'B'}</th>
                <th className="num">{t('analytics.change')}</th>
                <th className="num">%</th>
              </tr>
            </thead>
            <tbody>
              {compareAssets.map((x) => {
                const va = a.get(x.id) ?? 0;
                const vb = b.get(x.id) ?? 0;
                return (
                  <tr key={x.id}>
                    <td>
                      <AssetIcon asset={x} size={16} /> {x.code}
                    </td>
                    <td className="num">
                      <Money value={va} asset={x} />
                    </td>
                    <td className="num">
                      <Money value={vb} asset={x} />
                    </td>
                    <td className="num">
                      <Money value={round(vb - va)} asset={x} sign colored />
                    </td>
                    <td className="num">{va ? `${Math.round(((vb - va) / Math.abs(va)) * 1000) / 10}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!compareAssets.length && <EmptyState text={t('analytics.noData')} />}
        </div>
      </ChartCard>
    </>
  );
}

function AccountsTab({ c }: { c: Ctx }) {
  const { t, num } = useI18n();
  const accounts = selectedAccounts(c);
  const accKey = accounts.map((a) => a.id).join();
  const stats = useMemo(() => {
    const m = new Map<string, { in: AssetMap; out: AssetMap; fees: AssetMap; txIn: number; txOut: number }>();
    for (const a of accounts) m.set(a.id, { in: new Map(), out: new Map(), fees: new Map(), txIn: 0, txOut: 0 });
    for (const x of c.txs) {
      const f = m.get(x.fromId);
      const to = m.get(x.toId);
      if (f) {
        add(f.out, x.assetId, x.amount);
        f.txOut++;
        if (x.fee) add(f.fees, x.feeAssetId, x.fee);
      }
      if (to) {
        add(to.in, x.assetId, x.amount);
        to.txIn++;
      }
    }
    return m;
  }, [c.txs, accKey]);

  // per service and per form, from the per-account numbers
  const groups = (key: (a: (typeof accounts)[number]) => string) => {
    const g = new Map<string, { balance: AssetMap; in: AssetMap; out: AssetMap; n: number }>();
    for (const a of accounts) {
      const k = key(a);
      if (!g.has(k)) g.set(k, { balance: new Map(), in: new Map(), out: new Map(), n: 0 });
      const row = g.get(k)!;
      row.n++;
      for (const [x, v] of c.ix.account.get(a.id)!.balances) add(row.balance, x, v);
      const s = stats.get(a.id)!;
      for (const [x, v] of s.in) add(row.in, x, v);
      for (const [x, v] of s.out) add(row.out, x, v);
    }
    return [...g.entries()];
  };

  const head = (
    <tr>
      <th>{t('analytics.name')}</th>
      <th>{t('accounts.balance')}</th>
      <th>{t('stats.received')}</th>
      <th>{t('stats.sent')}</th>
    </tr>
  );

  return (
    <>
      <section className="section">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('accounts.one')}</th>
                <th>{t('accounts.balance')}</th>
                <th>{t('stats.received')}</th>
                <th>{t('stats.sent')}</th>
                <th>{t('stats.fees')}</th>
                <th className="num">{t('stats.txInOut')}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const s = stats.get(a.id)!;
                return (
                  <tr key={a.id}>
                    <td>
                      <a href={href.detail('accounts', a.id)}>{a.name}</a>
                      <div className="muted small">
                        {t(`form.${a.form}`)}
                        {a.serviceId ? ` · ${c.ix.services.get(a.serviceId)?.name ?? ''}` : ''}
                      </div>
                    </td>
                    <td>
                      <AssetAmounts map={c.ix.account.get(a.id)!.balances} assets={c.assets} keepZero />
                    </td>
                    <td>
                      <AssetAmounts map={s.in} assets={c.assets} />
                    </td>
                    <td>
                      <AssetAmounts map={s.out} assets={c.assets} />
                    </td>
                    <td>
                      <AssetAmounts map={s.fees} assets={c.assets} />
                    </td>
                    <td className="num">
                      {num(s.txIn + s.txOut)}
                      <div className="muted small">
                        ↓{num(s.txIn)} ↑{num(s.txOut)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="field-hint">{t('analytics.accountsNote')}</p>
      </section>
      <div className="chart-grid">
        <ChartCard title={t('analytics.byService')}>
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>{head}</thead>
              <tbody>
                {groups((a) => a.serviceId).map(([k, r]) => (
                  <tr key={k || '_'}>
                    <td>{k ? <a href={href.detail('services', k)}>{c.ix.services.get(k)?.name}</a> : <span className="muted">{t('accounts.noService')}</span>}</td>
                    <td>
                      <AssetAmounts map={r.balance} assets={c.assets} />
                    </td>
                    <td>
                      <AssetAmounts map={r.in} assets={c.assets} />
                    </td>
                    <td>
                      <AssetAmounts map={r.out} assets={c.assets} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
        <ChartCard title={t('analytics.byForm')}>
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>{head}</thead>
              <tbody>
                {groups((a) => a.form).map(([k, r]) => (
                  <tr key={k}>
                    <td>{t(`form.${k}` as DictKey)}</td>
                    <td>
                      <AssetAmounts map={r.balance} assets={c.assets} />
                    </td>
                    <td>
                      <AssetAmounts map={r.in} assets={c.assets} />
                    </td>
                    <td>
                      <AssetAmounts map={r.out} assets={c.assets} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </>
  );
}

function Parties({ c }: { c: Ctx }) {
  const i18n = useI18n();
  const { t, num } = i18n;
  const [by, setBy] = useState<'contact' | 'account'>('contact');
  const [sort, setSort] = useState<'count' | 'turnover' | 'sent' | 'received' | 'last'>('count');
  const aid = c.asset?.id ?? '';
  const rows = useMemo(() => {
    const list = counterparties(c.ix, c.txs, c.sel, c.own, c.ownTransfers, by);
    const v = (r: (typeof list)[number]) =>
      sort === 'count'
        ? r.count
        : sort === 'sent'
          ? (r.sent.get(aid) ?? 0)
          : sort === 'received'
            ? (r.received.get(aid) ?? 0)
            : sort === 'last'
              ? r.last
              : (r.sent.get(aid) ?? 0) + (r.received.get(aid) ?? 0);
    return list.sort((a, b) => v(b) - v(a));
  }, [c, by, sort, aid]);

  return (
    <>
      <div className="toolbar">
        <Segmented
          value={by}
          onChange={setBy}
          options={[
            { value: 'contact', label: t('analytics.byContact') },
            { value: 'account', label: t('analytics.byAccount') },
          ]}
        />
        <Field label={t('analytics.sortBy')}>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="count">{t('analytics.sortCount')}</option>
            <option value="turnover">{t('analytics.sortTurnover', { asset: c.asset?.code ?? '' })}</option>
            <option value="sent">{t('analytics.sortSent', { asset: c.asset?.code ?? '' })}</option>
            <option value="received">{t('analytics.sortReceived', { asset: c.asset?.code ?? '' })}</option>
            <option value="last">{t('analytics.sortLast')}</option>
          </select>
        </Field>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{by === 'contact' ? t('analytics.contact') : t('accounts.one')}</th>
              <th className="num">{t('stats.transactions')}</th>
              <th>{t('analytics.receivedFrom')}</th>
              <th>{t('analytics.sentTo')}</th>
              <th>{t('analytics.last')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const contact = !r.isAccount && r.id ? c.ix.contacts.get(r.id) : undefined;
              return (
                <tr key={r.id || '_'}>
                  <td className="num muted">{i + 1}</td>
                  <td>
                    {r.id ? (
                      <a href={r.isAccount ? href.detail('accounts', r.id) : href.detail('contacts', r.id)} className="cell-link">
                        {contact && <Avatar image={contact.image} name={contact.name} size={22} />}
                        {partyName(c.ix, r.id, r.isAccount, '')}
                      </a>
                    ) : (
                      <span className="muted">{t('tx.unknownParty')}</span>
                    )}
                  </td>
                  <td className="num">{num(r.count)}</td>
                  <td>
                    <AssetAmounts map={r.received} assets={c.assets} />
                  </td>
                  <td>
                    <AssetAmounts map={r.sent} assets={c.assets} />
                  </td>
                  <td className="muted">{r.last ? i18n.date(r.last) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <EmptyState text={t('analytics.noData')} />}
      </div>
    </>
  );
}

function Fees({ c }: { c: Ctx }) {
  const i18n = useI18n();
  const { t, num } = i18n;
  const f = useMemo(() => feeBreakdown(c.ix, c.txs, c.sel), [c]);
  const points = useFlow(c);
  const label = useBucketLabel();
  const aid = c.asset?.id ?? '';
  const mapRows = (m: Map<string, AssetMap>, name: (k: string) => ReactNode, link: (k: string) => string | undefined) =>
    [...m.entries()]
      .map(([k, v]) => ({ k, v, main: v.get(aid) ?? 0 }))
      .sort((a, b) => b.main - a.main)
      .map(({ k, v }) => ({
        key: k || '_',
        label: name(k),
        value: v.get(aid) ?? 0,
        text: entries(v, c.assets)
          .map(([a, x]) => money(i18n, x, a))
          .join(' · '),
        href: link(k),
      }));

  return (
    <>
      <div className="stats-row">
        <Stat label={t('analytics.feesTotal')} icon="fee" hint={t('stats.countN', { n: num(f.count) })}>
          <AssetAmounts map={f.total} assets={c.assets} />
        </Stat>
      </div>
      <div className="chart-grid">
        <ChartCard title={t('analytics.feesOverTime', { asset: c.asset?.code ?? '' })}>
          <CountBars
            labels={points.map((p) => label(p.start, c.g))}
            values={points.map((p) => p.fees)}
            name={`${t('stats.fees')}, ${c.asset?.code ?? ''}`}
          />
        </ChartCard>
        <ChartCard title={t('analytics.feesByAccount')}>
          <BarList rows={mapRows(f.perAccount, (k) => c.ix.accounts.get(k)?.name ?? '?', (k) => href.detail('accounts', k))} />
        </ChartCard>
        <ChartCard title={t('analytics.feesByService')}>
          <BarList rows={mapRows(f.perService, (k) => (k ? (c.ix.services.get(k)?.name ?? '?') : t('accounts.noService')), (k) => (k ? href.detail('services', k) : undefined))} />
        </ChartCard>
      </div>
      <section className="section">
        <div className="section-head">
          <h2>{t('analytics.feeTransactions')}</h2>
        </div>
        <TxList txs={f.txs} side={c.sel} prefKey="feeTx" />
      </section>
    </>
  );
}

function Debts({ c }: { c: Ctx }) {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const selfId = c.ix.self?.id;
  const mine = data.debts.filter((d) => d.debtorId === selfId || d.creditorId === selfId);
  const others = data.debts.filter((d) => d.debtorId !== selfId && d.creditorId !== selfId);
  const open = (list: typeof mine) => list.filter((d) => !c.ix.debt.get(d.id)!.closed);
  return (
    <>
      <Capital0 c={c} />
      <section className="section">
        <div className="section-head">
          <h2>{t('analytics.myDebts')}</h2>
          <a className="btn btn-sm" href={href.list('debts')}>
            {t('common.openAll')}
          </a>
        </div>
        {open(mine).length ? (
          <div className="rows">
            {open(mine).map((d) => (
              <DebtRow key={d.id} d={d} />
            ))}
          </div>
        ) : (
          <EmptyState icon="handshake" text={t('debts.none')} />
        )}
      </section>
      {open(others).length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{t('analytics.otherDebts')}</h2>
          </div>
          <div className="rows">
            {open(others).map((d) => (
              <DebtRow key={d.id} d={d} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Activity({ c }: { c: Ctx }) {
  const { t, locale } = useI18n();
  const dist = useMemo(() => timeOfActivity(c.ix, c.txs), [c]);
  const wd = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(2024, 0, 1 + i)));
  }, [locale]);
  return (
    <>
      <ChartCard title={t('stats.activity')}>
        <ActivityCalendar txs={c.txs} />
      </ChartCard>
      <div className="chart-grid">
        <ChartCard title={t('analytics.byWeekday')}>
          <CountBars labels={wd} values={dist.weekday} name={t('stats.transactions')} />
        </ChartCard>
        <ChartCard title={t('analytics.byHour')}>
          <CountBars labels={dist.hour.map((_, h) => String(h))} values={dist.hour} name={t('stats.transactions')} />
        </ChartCard>
      </div>
    </>
  );
}
