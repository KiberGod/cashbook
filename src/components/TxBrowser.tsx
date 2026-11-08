import { useMemo, useRef } from 'react';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { emptyFilter, inDates, NONE, searchTexts } from '../lib/analytics';
import { parseAmount } from '../lib/format';
import { matchesAny } from '../lib/search';
import { getIndex, withChildren, type Index } from '../lib/stats';
import type { Transaction } from '../lib/types';
import { useStore } from '../store/store';
import { ActivityCalendar } from './ActivityCalendar';
import { Field, MultiSelect, Picker, SearchField } from './bits';
import { DateTimeField } from './DateTimeField';
import { useFilterOptions } from './TxFilters';
import { directionOf, TxList } from './TxList';
import { useViewState } from './viewState';

/** Filters of a record's transactions (an account's, a debt's); `dir` is seen from that record. */
interface TxBrowserFilter {
  q: string;
  dir: 'all' | 'in' | 'out';
  /** the record's own accounts a transaction must touch (a contact's); none chosen = all of them */
  ownAccounts?: string[];
  toContacts: string[];
  fromAccounts: string[];
  toAccounts: string[];
  categories: string[];
  services: string[];
  minAmount: string;
  maxAmount: string;
  /** local date-time, as a datetime-local input gives it */
  from: string;
  to: string;
}

const EMPTY: TxBrowserFilter = { q: '', dir: 'all', ownAccounts: [], toContacts: [], fromAccounts: [], toAccounts: [], categories: [], services: [], minAmount: '', maxAmount: '', from: '', to: '' };

const countFilters = (f: TxBrowserFilter) =>
  [f.dir !== 'all', f.ownAccounts?.length, f.toContacts.length, f.fromAccounts?.length, f.toAccounts.length, f.categories.length, f.services.length, f.minAmount || f.maxAmount, f.from || f.to].filter(Boolean).length;

type Dir = 'in' | 'out' | 'other';

/** Everything but the dates (those are `inDates`): what the activity calendar shows. */
function filterTxs(ix: Index, list: Transaction[], f: TxBrowserFilter, dirOf: (t: Transaction) => Dir): Transaction[] {
  const set = (l: string[]) => (l.length ? new Set(l) : null);
  const ownAccounts = set(f.ownAccounts ?? []);
  const toContacts = set(f.toContacts);
  const fromAccounts = set(f.fromAccounts ?? []);
  const toAccounts = set(f.toAccounts);
  const services = set(f.services);
  const categories = f.categories.length ? withChildren(ix, f.categories) : null;
  const num = (v: string) => (v.trim() ? parseAmount(v) : null);
  const min = num(f.minAmount);
  const max = num(f.maxAmount);
  return list.filter((x) => {
    if (f.dir !== 'all' && dirOf(x) !== f.dir) return false;
    if (ownAccounts && !ownAccounts.has(x.fromId) && !ownAccounts.has(x.toId)) return false;
    if (fromAccounts && !fromAccounts.has(x.fromId || NONE)) return false;
    if (toAccounts && !toAccounts.has(x.toId || NONE)) return false;
    if (toContacts && !toContacts.has((x.toId && ix.accounts.get(x.toId)?.contactId) || NONE)) return false;
    if (categories && !categories.has(x.categoryId || NONE)) return false;
    if (services && !services.has(ix.accounts.get(x.fromId)?.serviceId ?? '') && !services.has(ix.accounts.get(x.toId)?.serviceId ?? '')) return false;
    if (min !== null && x.amount < min) return false;
    if (max !== null && x.amount > max) return false;
    // the same fields as on the transactions page
    return !f.q.trim() || matchesAny(f.q, ...searchTexts(ix, x));
  });
}

/**
 * A record's transactions: the activity calendar (a click picks a date range) and the list
 * with search and filters, all remembered under `stateKey`. `side` = the accounts the list
 * is seen from (arrows, colours); `dirOf` decides what "in" and "out" mean for the record
 * (by default: money coming to / leaving `side`), `dirLabels` how they are called.
 */
export function TxBrowser({
  txs,
  side,
  stateKey,
  prefKey,
  recipient = true,
  own,
  fromTo,
  dirOf,
  dirLabels,
  empty,
}: {
  txs: Transaction[];
  side: Set<string>;
  stateKey: string;
  prefKey: string;
  /** the "who receives" filter group */
  recipient?: boolean;
  /** a group to narrow the list to some of these accounts (a contact's), all of them by default */
  own?: string[];
  /** an "accounts" group with both sides instead, offering these accounts (and "external") */
  fromTo?: string[];
  dirOf?: (t: Transaction) => Dir;
  dirLabels?: { in: string; out: string };
  /** shown when the record has no transactions at all */
  empty?: string;
}) {
  const { t, num } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [f, setF] = useViewState<TxBrowserFilter>(`${stateKey}.txFilter`, EMPTY);
  const [moreFilters, setMoreFilters] = useViewState(`${stateKey}.filtersOpen`, false);
  const opts = useFilterOptions(ix);
  const setFilter = <K extends keyof TxBrowserFilter>(k: K) => (v: TxBrowserFilter[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const activeCount = countFilters(f);
  const section = useRef<HTMLElement>(null);
  const dir = useMemo(() => dirOf ?? ((x: Transaction): Dir => {
    const d = directionOf(x, side);
    return d === 'in' || d === 'out' ? d : 'other';
  }), [dirOf, side]);
  const labels = dirLabels ?? { in: t('dir.in'), out: t('dir.out') };

  // the chosen recipients narrow the "to account" choice to their accounts (no contact = accounts without one and "external")
  const fitsContacts = (accountId: string, contacts: string[]) =>
    !contacts.length || contacts.includes(accountId === NONE ? NONE : ix.accounts.get(accountId)?.contactId || NONE);
  const toAccountOptions = opts.accountsWithNone.filter((o) => fitsContacts(o.value, f.toContacts));
  const setToContacts = (toContacts: string[]) => setF((prev) => ({ ...prev, toContacts, toAccounts: prev.toAccounts.filter((a) => fitsContacts(a, toContacts)) }));

  const ownOptions = own ? opts.accounts.filter((o) => own.includes(o.value)) : [];
  const sideOptions = fromTo ? opts.accountsWithNone.filter((o) => o.value === NONE || fromTo.includes(o.value)) : [];

  // the calendar shows what the search and filters find on any date; the list, only within the chosen dates
  const undated = useMemo(() => filterTxs(ix, txs, f, dir), [ix, txs, f, dir]);
  const shown = useMemo(() => undated.filter(inDates(ix, { ...emptyFilter(), from: f.from, to: f.to })), [undated, ix, f.from, f.to]);
  const counts = useMemo(() => {
    let inN = 0;
    let outN = 0;
    // like on the transactions page: the directions of what is shown
    for (const x of shown) {
      const d = dir(x);
      if (d === 'in') inN++;
      else if (d === 'out') outN++;
    }
    return { in: inN, out: outN };
  }, [shown, dir]);

  return (
    <>
      <section className="panel acc-activity">
        <h2>{t('stats.activity')}</h2>
        {/* a click on a day, month or year sets the date range of the transactions below */}
        <ActivityCalendar
          txs={undated}
          scope={txs}
          pick={{
            value: { from: f.from, to: f.to },
            onChange: (r) => {
              setF((prev) => ({ ...prev, from: r?.from ?? '', to: r?.to ?? '' }));
              // show what was picked: the list scrolls into view once it is re-rendered
              if (r) requestAnimationFrame(() => section.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
            },
          }}
        />
      </section>
      <section className="section acc-tx" ref={section}>
        <div className="section-head">
          <h2>
            {t('nav.transactions')}{' '}
            <span className="count" title={`${labels.in}: ${num(counts.in)} · ${labels.out}: ${num(counts.out)}`}>
              {num(shown.length)}
              {shown.length !== txs.length && <span className="muted"> / {num(txs.length)}</span>}
              <span className="count-dirs">
                (<Icon name="arrowIn" size={12} className="flow-in" />
                {num(counts.in)}
                <Icon name="arrowOut" size={12} className="flow-out" />
                {num(counts.out)})
              </span>
            </span>
          </h2>
        </div>
        <div className="toolbar toolbar-wide">
          <SearchField value={f.q} onChange={setFilter('q')} placeholder={t('tx.search')} />
          <button type="button" className={`btn ${moreFilters ? 'btn-active' : ''}`} onClick={() => setMoreFilters(!moreFilters)} aria-expanded={moreFilters}>
            <Icon name="filter" size={18} />
            {t('filter.more')}
            {activeCount > 0 && <span className="badge badge-accent">{activeCount}</span>}
          </button>
          {activeCount > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setF({ ...EMPTY, q: f.q })}>
              {t('filter.reset')}
            </button>
          )}
        </div>
        {moreFilters && (
          <div className="filter-panel filter-groups">
            {own && (
              <div className="field" role="group">
                <span className="field-label">{t('filter.ownAccounts')}</span>
                <div className="filter-group-row">
                  <MultiSelect label={t('filter.account')} options={ownOptions} value={f.ownAccounts ?? []} onChange={setFilter('ownAccounts')} />
                </div>
              </div>
            )}
            {recipient && (
              <div className="field" role="group">
                <span className="field-label">{t('filter.recipient')}</span>
                <div className="filter-group-row">
                  <MultiSelect label={t('filter.toContact')} options={opts.contactsWithNone} value={f.toContacts} onChange={setToContacts} />
                  <MultiSelect label={t('filter.toAccount')} options={toAccountOptions} value={f.toAccounts} onChange={setFilter('toAccounts')} />
                </div>
              </div>
            )}
            {fromTo && (
              <div className="field" role="group">
                <span className="field-label">{t('filter.accounts')}</span>
                <div className="filter-group-row">
                  <MultiSelect label={t('filter.fromAccount')} options={sideOptions} value={f.fromAccounts ?? []} onChange={setFilter('fromAccounts')} />
                  <MultiSelect label={t('filter.toAccount')} options={sideOptions} value={f.toAccounts} onChange={setFilter('toAccounts')} />
                </div>
              </div>
            )}
            <div className="field" role="group">
              <span className="field-label">{t('filter.params')}</span>
              <div className="filter-group-row">
                <Picker
                  label={t('filter.direction')}
                  value={f.dir}
                  onChange={(v) => setFilter('dir')(v as TxBrowserFilter['dir'])}
                  options={[
                    { value: 'all', label: t('dir.all'), icon: <Icon name="swap" size={16} className="flow-any" /> },
                    { value: 'in', label: labels.in, icon: <Icon name="arrowIn" size={16} className="flow-in" /> },
                    { value: 'out', label: labels.out, icon: <Icon name="arrowOut" size={16} className="flow-out" /> },
                  ]}
                />
                <MultiSelect label={t('filter.category')} options={opts.categories} value={f.categories} onChange={setFilter('categories')} />
                <MultiSelect label={t('filter.service')} options={opts.services} value={f.services} onChange={setFilter('services')} />
              </div>
            </div>
            <Field label={t('filter.amount')} group>
              <span className="range-input">
                <input type="text" inputMode="decimal" value={f.minAmount} onChange={(e) => setFilter('minAmount')(e.target.value)} placeholder={t('filter.min')} aria-label={`${t('filter.amount')}, ${t('filter.min')}`} />
                <span>–</span>
                <input type="text" inputMode="decimal" value={f.maxAmount} onChange={(e) => setFilter('maxAmount')(e.target.value)} placeholder={t('filter.max')} aria-label={`${t('filter.amount')}, ${t('filter.max')}`} />
              </span>
            </Field>
            <Field label={t('filter.dateTime')} group>
              <span className="range-input range-input-dates">
                <DateTimeField value={f.from} onChange={setFilter('from')} placeholder={t('filter.min')} defaultTime="00:00" ariaLabel={`${t('filter.dateTime')}, ${t('filter.min')}`} />
                <span>–</span>
                <DateTimeField value={f.to} onChange={setFilter('to')} placeholder={t('filter.max')} defaultTime="23:59" ariaLabel={`${t('filter.dateTime')}, ${t('filter.max')}`} />
              </span>
            </Field>
          </div>
        )}
        <TxList
          txs={shown}
          side={side}
          q={f.q}
          prefKey={prefKey}
          resetKey={`${stateKey}|${JSON.stringify(f)}`}
          empty={txs.length ? t('common.nothingFound') : empty}
          rich
        />
      </section>
    </>
  );
}
