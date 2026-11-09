import { useMemo } from 'react';
import { AssetAmounts, MultiSelect } from '../components/bits';
import { DateTimeField } from '../components/DateTimeField';
import { useFilterOptions } from '../components/TxFilters';
import { useViewState } from '../components/viewState';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { NONE } from '../lib/analytics';
import { getIndex, round, withChildren, type AssetMap } from '../lib/stats';
import type { Contact, Transaction } from '../lib/types';
import { useStore } from '../store/store';
import { FlowBreakdown, flowDir, PeriodBadge, type FlowScope, type StatsRange } from './AccountsPage';

/**
 * A contact's statistics, like an account's: the turnover over a period and six rings - received
 * and sent by contact, by account, by category - seen from the contact's accounts (moving money
 * between them is neither). More filters than an account's: which of its accounts, with whom,
 * which categories, the period.
 */
export function ContactStats({ contact }: { contact: Contact }) {
  const { t, num } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const id = contact.id;
  const s = ix.contact.get(id)!;
  const key = `contact.${id}.stats`;
  const [accounts, setAccounts] = useViewState<string[]>(`${key}.accounts`, []);
  const [parties, setParties] = useViewState<string[]>(`${key}.parties`, []);
  const [categories, setCategories] = useViewState<string[]>(`${key}.categories`, []);
  const [range, setRange] = useViewState<StatsRange>(`${key}.range`, { from: '', to: '' });
  const opts = useFilterOptions(ix);

  const ownAll = useMemo(() => new Set(s.accounts.map((a) => a.id)), [s.accounts]);
  const accountOptions = opts.accounts.filter((o) => ownAll.has(o.value));
  // with whom: the contacts on the other side of its transactions (and "no contact")
  const partyOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const x of s.txs) for (const a of [x.fromId, x.toId]) if (!ownAll.has(a)) ids.add((a && ix.accounts.get(a)?.contactId) || NONE);
    return opts.contactsWithNone.filter((o) => ids.has(o.value));
  }, [s.txs, ownAll, ix, opts.contactsWithNone]);
  const filtered = accounts.length > 0 || parties.length > 0 || categories.length > 0 || !!range.from || !!range.to;

  // the rings' scope: the chosen accounts (all by default); all its accounts are "its own"
  const scope = useMemo<FlowScope>(() => {
    const side = accounts.length ? new Set(accounts.filter((a) => ownAll.has(a))) : ownAll;
    const assetIds = new Set(s.accounts.flatMap((a) => a.assetIds));
    return { side, inner: ownAll, allTxs: s.txs, assets: data.assets.filter((a) => assetIds.has(a.id)), stateKey: key };
  }, [accounts, ownAll, s, data.assets, key]);

  // the filters' transactions: in the period, of the chosen categories, with the chosen parties
  const txs = useMemo(() => {
    const cats = categories.length ? withChildren(ix, categories.filter((c) => c !== NONE)) : null;
    const noCategory = categories.includes(NONE);
    const who = parties.length ? new Set(parties) : null;
    const from = range.from ? new Date(range.from).getTime() : null;
    const to = range.to ? new Date(range.to).getTime() + 60_000 : null;
    return s.txs.filter((x) => {
      const time = ix.time.get(x.id)!;
      if (from !== null && time < from) return false;
      if (to !== null && time >= to) return false;
      if (cats && !(x.categoryId ? cats.has(x.categoryId) : noCategory)) return false;
      if (who) {
        const other = scope.side.has(x.toId) ? x.fromId : x.toId;
        if (!who.has((other && ix.accounts.get(other)?.contactId) || NONE)) return false;
      }
      return true;
    });
  }, [s.txs, ix, categories, parties, range, scope.side]);

  // the turnover: what came in, went out (and the fees paid on it), how many times
  const flow = useMemo(() => {
    const add = (m: AssetMap, k: string, v: number) => m.set(k, round((m.get(k) ?? 0) + v));
    const f = { in: new Map() as AssetMap, out: new Map() as AssetMap, fees: new Map() as AssetMap, txIn: 0, txOut: 0 };
    for (const x of txs as Transaction[]) {
      const d = flowDir(scope, x);
      if (d === 'in') {
        add(f.in, x.assetId, x.amount);
        f.txIn++;
      } else if (d === 'out') {
        add(f.out, x.assetId, x.amount);
        if (x.fee) add(f.fees, x.feeAssetId, x.fee);
        f.txOut++;
      }
    }
    return f;
  }, [txs, scope]);

  return (
    <>
      {/* the filters: the whole tab counts over them */}
      <div className="cat-filters">
        <MultiSelect label={t('filter.accounts')} options={accountOptions} value={accounts} onChange={setAccounts} />
        <MultiSelect label={t('filter.contact')} options={partyOptions} value={parties} onChange={setParties} />
        <MultiSelect label={t('filter.category')} options={opts.categories} value={categories} onChange={setCategories} />
        <span className="field-label">{t('filter.period')}</span>
        <span className="range-input range-input-dates">
          <DateTimeField value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} placeholder={t('filter.min')} defaultTime="00:00" ariaLabel={`${t('filter.period')}, ${t('filter.min')}`} />
          <span>–</span>
          <DateTimeField value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} placeholder={t('filter.max')} defaultTime="23:59" ariaLabel={`${t('filter.period')}, ${t('filter.max')}`} />
        </span>
        {filtered && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setAccounts([]);
              setParties([]);
              setCategories([]);
              setRange({ from: '', to: '' });
            }}
          >
            {t('filter.reset')}
          </button>
        )}
      </div>

      <section className="panel acc-stats">
        <h2 className="panel-title-badge">
          {t('accounts.turnover')}
          <PeriodBadge range={range} />
        </h2>
        <div className="cells">
          <div className="cell">
            <span className="cell-label">
              <Icon name="arrowIn" size={14} className="flow-in" />
              {t('stats.received')}
            </span>
            <AssetAmounts map={flow.in} assets={data.assets} column />
          </div>
          <div className="cell">
            <span className="cell-label">
              <Icon name="arrowOut" size={14} className="flow-out" />
              {t('stats.sent')}
            </span>
            <AssetAmounts map={flow.out} assets={data.assets} column />
          </div>
          <div className="cell">
            <span className="cell-label">{t('stats.transactions')}</span>
            <span className="tx-split" title={t('stats.inOutCount', { in: num(flow.txIn), out: num(flow.txOut) })}>
              {num(flow.txIn + flow.txOut)}
              <span className="muted">
                (<Icon name="arrowIn" size={13} className="flow-in" />
                {num(flow.txIn)}
                <Icon name="arrowOut" size={13} className="flow-out" />
                {num(flow.txOut)})
              </span>
            </span>
          </div>
          <div className="cell">
            <span className="cell-label">{t('accounts.feesSpent')}</span>
            <AssetAmounts map={flow.fees} assets={data.assets} column />
          </div>
        </div>
      </section>
      <FlowBreakdown scope={scope} dim="contacts" txs={txs} range={range} />
      <FlowBreakdown scope={scope} dim="accounts" txs={txs} range={range} />
      <FlowBreakdown scope={scope} dim="categories" txs={txs} range={range} />
    </>
  );
}
