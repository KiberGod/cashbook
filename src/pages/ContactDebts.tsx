import { useMemo, useState } from 'react';
import { BreakdownDonut, type BreakdownSlice } from '../components/BreakdownDonut';
import { AssetAmounts, AssetIcon, Avatar, ContactChip, EmptyState, MultiSelect, Pagination, Picker, SearchField, Stat, useContactOptions, usePaged } from '../components/bits';
import { ChartCard, extendedSeries, useChartColors } from '../components/charts';
import { useViewState } from '../components/viewState';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { matchesAny } from '../lib/search';
import { getIndex } from '../lib/stats';
import type { Contact, Debt } from '../lib/types';
import { href } from '../router';
import { useStore } from '../store/store';
import { DebtEditor, DebtRow, DeleteDebt } from './DebtsPage';

type Status = 'open' | 'closed' | 'all';
type Side = 'owed' | 'owing';

/**
 * A contact's debts tab: what is owed to them and what they owe, two rings splitting the open
 * debts by the other contact, and their debts with the debts page's search and filters.
 */
export function ContactDebts({ contact }: { contact: Contact }) {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const id = contact.id;
  const s = ix.contact.get(id)!;
  const key = `contact.${id}.debts`;
  const [q, setQ] = useViewState(`${key}.q`, '');
  const [status, setStatus] = useViewState<Status>(`${key}.status`, 'open');
  const [contacts, setContacts] = useViewState<string[]>(`${key}.contacts`, []);
  const [assets, setAssets] = useViewState<string[]>(`${key}.assets`, []);
  const [edit, setEdit] = useState<Debt | null>(null);
  const [del, setDel] = useState<Debt | null>(null);

  // the other side of each debt: who the contact owes, or who owes the contact
  const otherOf = (d: Debt) => (d.debtorId === id ? d.creditorId : d.debtorId);
  const others = useMemo(() => {
    const ids = new Set(s.debts.map((d) => (d.debtorId === id ? d.creditorId : d.debtorId)));
    return data.contacts.filter((c) => ids.has(c.id));
  }, [s.debts, data.contacts, id]);
  const contactOptions = useContactOptions(others);
  const assetOptions = useMemo(() => {
    const ids = new Set(s.debts.map((d) => d.assetId));
    return data.assets.filter((a) => ids.has(a.id)).map((a) => ({ value: a.id, label: a.code, icon: <AssetIcon asset={a} size={18} /> }));
  }, [s.debts, data.assets]);

  const list = useMemo(
    () =>
      s.debts
        .filter((d) => {
          const ds = ix.debt.get(d.id)!;
          if (status === 'open' && ds.closed) return false;
          if (status === 'closed' && !ds.closed) return false;
          if (contacts.length && !contacts.includes(d.debtorId === id ? d.creditorId : d.debtorId)) return false;
          if (assets.length && !assets.includes(d.assetId)) return false;
          return matchesAny(q, d.name, ix.contacts.get(d.debtorId)?.name, ix.contacts.get(d.creditorId)?.name);
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [s.debts, ix, q, status, contacts, assets, id],
  );
  const paged = usePaged(list, 'contactDebts', `${id}|${q}|${status}|${contacts}|${assets}`);
  // only the open debts, as it starts: "no open debts" rather than "nothing found"
  const asStarted = !q.trim() && status === 'open' && !contacts.length && !assets.length;

  // one colour per contact in both rings: ranked by how many debts they share with this contact
  const colors = useChartColors();
  const rank = useMemo(() => {
    const n = new Map<string, number>();
    for (const d of s.debts) n.set(otherOf(d), (n.get(otherOf(d)) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.debts, id]);
  const series = extendedSeries(colors);
  const colorOf = (k: string) => series[Math.max(0, rank.indexOf(k)) % series.length];

  const self = contact.isSelf;
  const owedLabel = self ? t('debts.owedToMeShort') : t('debts.owedToMe', { name: contact.name });
  const owingLabel = self ? t('debts.iOweShort') : t('debts.iOwe', { name: contact.name });

  return (
    <>
      <div className="stats-row">
        <Stat label={owedLabel} icon="arrowIn">
          <AssetAmounts map={s.owedToMe} assets={data.assets} />
        </Stat>
        <Stat label={owingLabel} icon="arrowOut">
          <AssetAmounts map={s.iOwe} assets={data.assets} />
        </Stat>
      </div>

      <div className="acc-flow">
        <DebtBreakdown contact={contact} side="owed" title={owedLabel} colorOf={colorOf} />
        <DebtBreakdown contact={contact} side="owing" title={owingLabel} colorOf={colorOf} />
      </div>

      <section className="section">
        <div className="section-head">
          <h2>
            {t('nav.debts')}{' '}
            <span className="count">
              {list.length}
              {list.length !== s.debts.length && <span className="muted"> / {s.debts.length}</span>}
            </span>
          </h2>
        </div>
        {s.debts.length > 0 && (
          <div className="toolbar toolbar-wide">
            <SearchField value={q} onChange={setQ} placeholder={t('debts.search')} />
            <Picker
              label={t('debts.status')}
              value={status}
              onChange={(v) => setStatus(v as Status)}
              options={[
                { value: 'open', label: t('debts.open') },
                { value: 'closed', label: t('debts.closedMany') },
                { value: 'all', label: t('filter.all') },
              ]}
            />
            <MultiSelect label={t('filter.contact')} options={contactOptions} value={contacts} onChange={setContacts} />
            <MultiSelect label={t('filter.asset')} options={assetOptions} value={assets} onChange={setAssets} />
          </div>
        )}
        {list.length === 0 ? (
          <EmptyState icon="handshake" text={!s.debts.length ? t('debts.empty') : asStarted ? t('debts.none') : t('common.nothingFound')} />
        ) : (
          <div className="rows">
            {paged.items.map((d) => (
              <DebtRow key={d.id} d={d} q={q} onEdit={() => setEdit(d)} onDelete={() => setDel(d)} />
            ))}
          </div>
        )}
        <Pagination p={paged} />
      </section>

      {edit && <DebtEditor debt={edit} onClose={() => setEdit(null)} />}
      {del && <DeleteDebt debt={del} onClose={() => setDel(null)} />}
    </>
  );
}

/**
 * The contact's open debts on one side split by the other contact: who owes them ("owed"), or
 * whom they owe ("owing"); the sizes are what is still owed, in one asset at a time.
 */
function DebtBreakdown({ contact, side, title, colorOf }: { contact: Contact; side: Side; title: string; colorOf: (k: string) => string }) {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const id = contact.id;
  const s = ix.contact.get(id)!;

  // the open debts on this side, and the assets they are in (the biggest total first)
  const open = s.debts.filter((d) => (side === 'owed' ? d.creditorId === id : d.debtorId === id) && !ix.debt.get(d.id)!.closed);
  const totals = new Map<string, number>();
  for (const d of open) totals.set(d.assetId, (totals.get(d.assetId) ?? 0) + ix.debt.get(d.id)!.remaining);
  const assets = [...totals]
    .sort((a, b) => b[1] - a[1])
    .map(([x]) => ix.assets.get(x))
    .filter((a) => !!a);
  const [stored, setAsset] = useViewState(`contact.${id}.debts.${side}Asset`, '');
  // a remembered asset no longer owed falls back to the biggest one
  const assetId = assets.some((a) => a.id === stored) ? stored : (assets[0]?.id ?? '');

  const sums = new Map<string, { value: number; count: number }>();
  for (const d of open) {
    if (d.assetId !== assetId) continue;
    const other = side === 'owed' ? d.debtorId : d.creditorId;
    const sum = sums.get(other) ?? { value: 0, count: 0 };
    sums.set(other, { value: sum.value + ix.debt.get(d.id)!.remaining, count: sum.count + 1 });
  }
  const slices: BreakdownSlice[] = [...sums].map(([k, { value, count }]) => {
    const c = ix.contacts.get(k);
    return c
      ? { key: k, value, count, label: c.name, icon: <Avatar image={c.image} name={c.name} size={20} />, chip: <ContactChip contact={c} href={href.detail('contacts', c.id)} /> }
      : { key: k, value, count, label: '?' };
  });

  return (
    <ChartCard
      title={
        <span className="chart-title-icon">
          <Icon name={side === 'owed' ? 'arrowIn' : 'arrowOut'} size={16} className={side === 'owed' ? 'flow-in' : 'flow-out'} />
          {title}
        </span>
      }
    >
      {/* a row of its own under the title, so the rings of the two cards line up */}
      <div className="chart-toolbar">
        <span className="chart-badges">
          <span className="chart-dim">
            <Icon name="users" size={13} />
            {t('chart.dim.contacts')}
          </span>
        </span>
        {assets.length > 0 && (
          <Picker
            label={t('filter.asset')}
            value={assetId}
            onChange={setAsset}
            options={assets.map((a) => ({ value: a.id, label: a.code, icon: <AssetIcon asset={a} size={18} /> }))}
          />
        )}
      </div>
      <BreakdownDonut slices={slices} asset={ix.assets.get(assetId)} colorOf={colorOf} empty={t('debts.none')} ariaLabel={`${title}: ${t('chart.dim.contacts')}`} />
    </ChartCard>
  );
}
