import { useMemo, useRef } from 'react';
import { ActivityCalendar } from '../components/ActivityCalendar';
import { SearchField } from '../components/bits';
import { PageHead } from '../components/Layout';
import { useViewState } from '../components/viewState';
import { TxFilterGroups } from '../components/TxFilters';
import { directionOf, TxList } from '../components/TxList';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { activeFilters, emptyFilter, filterUndated, inDates, ownAccountIds, type TxFilter } from '../lib/analytics';
import { getIndex } from '../lib/stats';
import { useStore } from '../store/store';
import { openTxForm } from '../store/ui';

/** Initial filters from links like #/transactions?account=… (back-links from other pages). */
function fromQuery(q: URLSearchParams): TxFilter {
  const f = emptyFilter();
  const one = (k: string) => (q.get(k) ? [q.get(k)!] : []);
  return {
    ...f,
    categories: one('category'),
    assets: one('asset'),
    debts: one('debt'),
    services: one('service'),
    forms: one('form'),
  };
}

/**
 * Every transaction in the book: the activity calendar (a click picks a date range) and the list
 * with search and grouped filters. Directions are seen from the user's own accounts.
 */
export function TransactionsPage({ query }: { query: URLSearchParams }) {
  const { t, num } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const qs = query.toString();
  // remembered per link: the plain list and every pre-filtered link (from an account, a debt...) keep their own filters
  const [stored, setFilter] = useViewState<TxFilter>(`transactions?${qs}`, () => fromQuery(query));
  // filters remembered by an older version lack the newer fields (and may hold a period, now the date range's job)
  const f = useMemo(() => ({ ...emptyFilter(), ...stored, period: emptyFilter().period }), [stored]);
  const [moreFilters, setMoreFilters] = useViewState(`transactions?${qs}.filtersOpen`, () => activeFilters(fromQuery(query)) > 0);
  const set = <K extends keyof TxFilter>(k: K) => (v: TxFilter[K]) => setFilter((prev) => ({ ...emptyFilter(), ...prev, [k]: v }));
  const activeCount = activeFilters(f);
  const section = useRef<HTMLElement>(null);

  const own = useMemo(() => ownAccountIds(ix), [ix]);
  const all = ix.txSorted;
  // the calendar shows what the search and filters find on any date; the list, only within the chosen dates
  const undated = useMemo(() => filterUndated(ix, f), [ix, f]);
  const shown = useMemo(() => undated.filter(inDates(ix, f)), [undated, ix, f]);
  const counts = useMemo(() => {
    const c = { in: 0, out: 0, internal: 0 };
    for (const x of shown) {
      const d = directionOf(x, own);
      if (d !== 'other') c[d]++;
    }
    return c;
  }, [shown, own]);

  return (
    <>
      <PageHead
        title={t('nav.transactions')}
        icon={<Icon name="swap" />}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => openTxForm()}>
            <Icon name="plus" size={18} />
            {t('tx.add')}
          </button>
        }
      />
      <section className="panel acc-activity">
        <h2>{t('stats.activity')}</h2>
        {/* a click on a day, month or year sets the date range of the transactions below */}
        <ActivityCalendar
          txs={undated}
          scope={all}
          pick={{
            value: { from: f.from, to: f.to },
            onChange: (r) => {
              setFilter((prev) => ({ ...emptyFilter(), ...prev, from: r?.from ?? '', to: r?.to ?? '' }));
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
            <span className="count" title={`${t('dir.inMine')}: ${num(counts.in)} · ${t('dir.outMine')}: ${num(counts.out)} · ${t('dir.internalMine')}: ${num(counts.internal)}`}>
              {num(shown.length)}
              {shown.length !== all.length && <span className="muted"> / {num(all.length)}</span>}
              <span className="count-dirs">
                (<Icon name="arrowIn" size={12} className="flow-in" />
                {num(counts.in)}
                <Icon name="arrowOut" size={12} className="flow-out" />
                {num(counts.out)}
                <Icon name="refresh" size={12} className="flow-any" />
                {num(counts.internal)})
              </span>
            </span>
          </h2>
        </div>
        <div className="toolbar toolbar-wide">
          <SearchField value={f.q} onChange={set('q')} placeholder={t('tx.search')} />
          <button type="button" className={`btn ${moreFilters ? 'btn-active' : ''}`} onClick={() => setMoreFilters(!moreFilters)} aria-expanded={moreFilters}>
            <Icon name="filter" size={18} />
            {t('filter.more')}
            {activeCount > 0 && <span className="badge badge-accent">{activeCount}</span>}
          </button>
          {activeCount > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setFilter({ ...emptyFilter(), q: f.q })}>
              {t('filter.reset')}
            </button>
          )}
        </div>
        {moreFilters && <TxFilterGroups ix={ix} f={f} onChange={setFilter} />}
        <TxList
          txs={shown}
          side={own}
          q={f.q}
          prefKey="transactions"
          resetKey={JSON.stringify(f)}
          empty={data.transactions.length ? t('common.nothingFound') : t('tx.empty')}
          rich
        />
      </section>
    </>
  );
}
