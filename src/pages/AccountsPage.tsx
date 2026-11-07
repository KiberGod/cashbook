import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { AccountIcon, AssetAmounts, FORM_ICON, Segmented, AssetIcon, Avatar, CardMenu, ContactChip, CopyButton, EmptyState, Field, FormBadge, Highlight, MultiSelect, type Option, Pagination, Picker, SearchField, useContactOptions, usePaged } from '../components/bits';
import { DescriptionField, FormFooter, NameField, useTextRules } from '../components/forms';
import { PageHead } from '../components/Layout';
import { dragHandle, swallowNextClick, useDragSensors } from '../components/dnd';
import { useViewState } from '../components/viewState';
import { ConfirmDialog, Modal } from '../components/Modal';
import { Icon, type UiIconName } from '../icons/ui';
import { useI18n } from '../i18n';
import { formPalette, imagePalette, type CardPalette } from '../lib/cardPalette';
import { money, parseAmount } from '../lib/format';
import { accountsInOrder, deleteAccount, moveAccount, saveAccount, servicesInOrder, setInitialBalances } from '../lib/ops';
import { byName, matchesAny } from '../lib/search';
import { accountFlowOf, getIndex, round, templatesUsing } from '../lib/stats';
import { TxBrowser } from '../components/TxBrowser';
import { DateTimeField } from '../components/DateTimeField';
import { ChartCard, extendedSeries, useChartColors } from '../components/charts';
import { BreakdownDonut, type BreakdownSlice } from '../components/BreakdownDonut';
import { FORMS, LIMITS, type Account, type FormId, type Transaction } from '../lib/types';
import { href } from '../router';
import { mutate, useStore } from '../store/store';
import { openTxForm } from '../store/ui';
import { NotFound } from './common';
import { RelatedTemplates, TemplateNames } from '../components/Templates';


const NO_CONTACT = '__none__';

export function AccountsPage({ query }: { query?: URLSearchParams }) {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const contactOptions = useContactOptions(data.contacts);
  // a link with a contact (from a contact's page) has its own remembered filters
  const scope = `accounts.${query?.get('contact') ?? ''}`;
  const selfId = getIndex(data).self?.id;
  const [q, setQ] = useViewState(`${scope}.q`, '');
  // by default the list shows the user's own accounts; the filter can be cleared for all
  const [contacts, setContacts] = useViewState<string[]>(`${scope}.contacts`, query?.get('contact') ? [query.get('contact')!] : selfId ? [selfId] : []);
  const [assets, setAssets] = useViewState<string[]>(`${scope}.assets`, []);
  const [forms, setForms] = useViewState<string[]>(`${scope}.forms`, []);
  const [services, setServices] = useViewState<string[]>(`${scope}.services`, []);
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const [adjust, setAdjust] = useState<Account | null>(null);
  const [del, setDel] = useState<Account | null>(null);

  const list = useMemo(
    () =>
      accountsInOrder(data.accounts).filter(
        (a) =>
          matchesAny(q, a.name, a.requisite) &&
          (!contacts.length || contacts.includes(a.contactId || NO_CONTACT)) &&
          (!assets.length || a.assetIds.some((x) => assets.includes(x))) &&
          (!forms.length || forms.includes(a.form)) &&
          (!services.length || services.includes(a.serviceId)),
      ),
    [data.accounts, q, contacts, assets, forms, services],
  );
  const paged = usePaged(list, 'accounts', `${q}|${contacts}|${assets}|${forms}|${services}`);
  const filtered = !!(q.trim() || contacts.length || assets.length || forms.length || services.length);
  // the order is changed on the full list or on one person's accounts (the default view is the user's own),
  // never on search or other filter results; a card moves to where the other one is in the whole list
  const sortable = !q.trim() && !assets.length && !forms.length && !services.length && contacts.length <= 1;
  const sensors = useDragSensors();
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    swallowNextClick();
    if (over && active.id !== over.id) mutate((d) => moveAccount(d, String(active.id), String(over.id)));
  };

  return (
    <>
      <PageHead
        title={t('nav.accounts')}
        icon={<Icon name="wallet" />}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={18} />
            {t('accounts.add')}
          </button>
        }
      />
      <div className="toolbar toolbar-wide">
        <SearchField value={q} onChange={setQ} placeholder={t('accounts.search')} />
        <MultiSelect
          label={t('filter.contact')}
          options={[
            ...contactOptions,
            { value: NO_CONTACT, label: t('tx.noContact') },
          ]}
          value={contacts}
          onChange={setContacts}
        />
        <MultiSelect
          label={t('filter.asset')}
          options={data.assets.map((a) => ({ value: a.id, label: a.code, icon: <AssetIcon asset={a} size={18} /> }))}
          value={assets}
          onChange={setAssets}
        />
        <MultiSelect label={t('filter.form')} options={FORMS.map((f) => ({ value: f, label: t(`form.${f}`) }))} value={forms} onChange={setForms} />
        <MultiSelect
          label={t('filter.service')}
          options={servicesInOrder(data.services).map((s) => ({ value: s.id, label: s.name, icon: <Avatar image={s.image} name={s.name} size={18} /> }))}
          value={services}
          onChange={setServices}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState icon="wallet" text={filtered ? t('common.nothingFound') : t('accounts.empty')} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={paged.items.map((a) => a.id)} strategy={rectSortingStrategy} disabled={!sortable}>
            <div className="acc-grid">
              {paged.items.map((a) => (
                <AccountCard key={a.id} a={a} q={q} sortable={sortable} onEdit={() => setEdit(a)} onAdjust={() => setAdjust(a)} onDelete={() => setDel(a)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <Pagination p={paged} />
      {edit && <AccountEditor account={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {adjust && <BalanceAdjustment account={adjust} onClose={() => setAdjust(null)} />}
      {del && <DeleteAccount account={del} onClose={() => setDel(null)} />}
    </>
  );
}


/** The card colours: from the service logo once it is read, the form's colours meanwhile or without one. */
function useCardPalette(image: string | undefined, form: FormId): CardPalette {
  const [palette, setPalette] = useState<CardPalette | null>(null);
  useEffect(() => {
    let live = true;
    setPalette(null);
    if (image) void imagePalette(image).then((p) => live && setPalette(p));
    return () => {
      live = false;
    };
  }, [image]);
  return palette ?? formPalette(form);
}

/** What a bank card shows; `inLink` when the card itself is a link (the contact chip then navigates by script). */
function AccountCardFace({ a, q = '', menu, inLink }: { a: Account; q?: string; menu?: ReactNode; inLink: boolean }) {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const contact = a.contactId ? ix.contacts.get(a.contactId) : undefined;
  const service = a.serviceId ? ix.services.get(a.serviceId) : undefined;
  // one under another, the two largest amounts at most
  const balances = ix.account.get(a.id)!.balances;
  const top = a.assetIds
    .map((x) => ix.assets.get(x))
    .filter((x) => !!x)
    .sort((x, y) => Math.abs(balances.get(y.id) ?? 0) - Math.abs(balances.get(x.id) ?? 0))
    .slice(0, 2);
  return (
    <>
      <div className="acc-card-top">
        <span className="acc-card-logo">
          {service?.image ? <Avatar image={service.image} name={service.name} size={44} /> : <Icon name={FORM_ICON[a.form]} size={24} />}
        </span>
        <div className="acc-card-head">
          <span className="acc-card-name">
            <Highlight text={a.name} query={q} />
          </span>
          <span className="acc-card-form">
            {t(`form.${a.form}`)}
            {service && ` · ${service.name}`}
          </span>
        </div>
        {menu}
      </div>
      <div className="acc-card-balances">
        <AssetAmounts map={balances} assets={top} keepZero column />
      </div>
      <div className="acc-card-bottom">
        {contact ? <ContactChip contact={contact} href={href.detail('contacts', contact.id)} inLink={inLink} /> : <span className="acc-card-nobody">{t('tx.noContact')}</span>}
        {contact?.isSelf && <span className="acc-card-own-badge">{t('accounts.yours')}</span>}
      </div>
    </>
  );
}

const paletteStyle = (p: CardPalette) => ({ '--card-from': p.from, '--card-to': p.to }) as CSSProperties;

/** An account as a bank card in the grid; drag it onto another card to change the order. */
function AccountCard({ a, q, sortable, onEdit, onAdjust, onDelete }: { a: Account; q: string; sortable: boolean; onEdit: () => void; onAdjust: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const service = a.serviceId ? getIndex(data).services.get(a.serviceId) : undefined;
  const palette = useCardPalette(service?.image || undefined, a.form);
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: a.id });
  return (
    <a
      ref={setNodeRef}
      className={`acc-card ${isDragging ? 'acc-card-dragging' : ''}`}
      href={href.detail('accounts', a.id)}
      style={{ ...paletteStyle(palette), transform: CSS.Translate.toString(transform), transition }}
      {...dragHandle(sortable, attributes, listeners)}
    >
      <AccountCardFace
        a={a}
        q={q}
        inLink
        menu={
          <CardMenu
            actions={[
              { label: t('tx.add'), icon: 'plus', onSelect: () => openTxForm({ prefill: { fromId: a.id } }) },
              { label: t('common.edit'), icon: 'edit', onSelect: onEdit },
              { label: t('accounts.adjust'), icon: 'scale', onSelect: onAdjust },
              { label: t('common.delete'), icon: 'trash', danger: true, onSelect: onDelete },
            ]}
          />
        }
      />
    </a>
  );
}

/** The same card on the account's own page: nothing to open, so not a link. */
function AccountCardStatic({ a }: { a: Account }) {
  const data = useStore((s) => s.data);
  const service = a.serviceId ? getIndex(data).services.get(a.serviceId) : undefined;
  const palette = useCardPalette(service?.image || undefined, a.form);
  return (
    <div className="acc-card acc-card-static" style={paletteStyle(palette)}>
      <AccountCardFace a={a} inLink={false} />
    </div>
  );
}

export function AccountRow({ a, q = '', onEdit, onDelete }: { a: Account; q?: string; onEdit?: () => void; onDelete?: () => void }) {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const contact = a.contactId ? ix.contacts.get(a.contactId) : undefined;
  const service = a.serviceId ? ix.services.get(a.serviceId) : undefined;
  const s = ix.account.get(a.id)!;
  return (
    <a className={`row ${contact?.isSelf ? 'row-own' : ''}`} href={href.detail('accounts', a.id)}>
      {service ? <Avatar image={service.image} name={service.name} /> : <Avatar name={a.name} />}
      <div className="row-main">
        <div className="row-title">
          <Highlight text={a.name} query={q} />
          <FormBadge form={a.form} />
        </div>
        <div className="row-meta">
          {contact && <ContactChip contact={contact} href={href.detail('contacts', contact.id)} inLink />}
          {service && <span className="muted">{service.name}</span>}
        </div>
      </div>
      <div className="row-side">
        <AssetAmounts map={s.balances} assets={data.assets} keepZero />
      </div>
      {(onEdit || onDelete) && (
        <CardMenu
          actions={[
            { label: t('tx.add'), icon: 'plus', onSelect: () => openTxForm({ prefill: { fromId: a.id } }) },
            ...(onEdit ? [{ label: t('common.edit'), icon: 'edit' as const, onSelect: onEdit }] : []),
            ...(onDelete ? [{ label: t('common.delete'), icon: 'trash' as const, danger: true, onSelect: onDelete }] : []),
          ]}
        />
      )}
    </a>
  );
}

const PAGE_TABS = ['overview', 'stats', 'activity'] as const;
type PageTab = (typeof PAGE_TABS)[number];

export function AccountDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t, num } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const account = ix.accounts.get(id);
  const [edit, setEdit] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [del, setDel] = useState(false);
  // the page's sections: what the account is / its numbers / its transactions. Opening an account
  // starts on the overview; the open tab is kept in the address (?tab=), so Back returns to it
  const [pageTab, setPageTabState] = useState<PageTab>(() => {
    const tab = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab');
    return PAGE_TABS.includes(tab as PageTab) ? (tab as PageTab) : 'overview';
  });
  const setPageTab = (tab: PageTab) => {
    setPageTabState(tab);
    history.replaceState(history.state, '', href.detail('accounts', id) + (tab === 'overview' ? '' : `?tab=${tab}`));
  };
  const side = useMemo(() => new Set([id]), [id]);
  const s = ix.account.get(id);
  // the statistics tab's period (both ends included to the minute); remembered per account
  const [statsRange, setStatsRange] = useViewState(`account.${id}.statsRange`, { from: '', to: '' });
  const periodTxs = useMemo(() => {
    if (!s) return [];
    const from = statsRange.from ? new Date(statsRange.from).getTime() : null;
    const to = statsRange.to ? new Date(statsRange.to).getTime() + 60_000 : null;
    return s.txs.filter((x) => {
      const time = ix.time.get(x.id) ?? new Date(x.date).getTime();
      return (from === null || time >= from) && (to === null || time < to);
    });
  }, [s, statsRange, ix]);
  const flow = useMemo(() => accountFlowOf(id, periodTxs), [id, periodTxs]);


  if (!account || !s) return <NotFound />;
  const contact = account.contactId ? ix.contacts.get(account.contactId) : undefined;
  const service = account.serviceId ? ix.services.get(account.serviceId) : undefined;
  const assets = account.assetIds.map((x) => ix.assets.get(x)!).filter(Boolean);

  return (
    <>
      <PageHead
        crumbs={[{ label: t('nav.accounts'), href: href.list('accounts') }]}
        title={account.name}
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => openTxForm({ prefill: { fromId: id } })}>
              <Icon name="arrowOut" size={18} />
              {t('accounts.send')}
            </button>
            <button type="button" className="btn" onClick={() => openTxForm({ prefill: { toId: id } })}>
              <Icon name="arrowIn" size={18} />
              {t('accounts.receive')}
            </button>
            <button type="button" className="btn" onClick={() => setEdit(true)}>
              <Icon name="edit" size={18} />
              {t('common.edit')}
            </button>
            <button type="button" className="btn" onClick={() => setAdjust(true)}>
              <Icon name="scale" size={18} />
              {t('accounts.adjust')}
            </button>
            <button type="button" className="btn btn-danger-ghost" onClick={() => setDel(true)}>
              <Icon name="trash" size={18} />
              {t('common.delete')}
            </button>
          </>
        }
      />
      <nav className="page-tabs" role="tablist" aria-label={account.name}>
        {PAGE_TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={pageTab === k} className={pageTab === k ? 'active' : ''} onClick={() => setPageTab(k)}>
            {t(`accounts.page.${k}`)}
          </button>
        ))}
      </nav>
      {pageTab === 'overview' && (
        <div className="acc-layout">
          {/* the card with the related templates right under it */}
          <div className="detail-col">
            <AccountCardStatic a={account} />
            <RelatedTemplates kind="accounts" id={id} />
          </div>
          <section className="panel acc-details">
            <h2>{t('common.details')}</h2>
            <div className="cells cells-3">
              <div className="cell">
                <span className="cell-label">{t('accounts.balanceNow')}</span>
                <AssetAmounts map={s.balances} assets={assets} keepZero column />
              </div>
              <div className="cell">
                <span className="cell-label">{t('accounts.contact')}</span>
                {contact ? <ContactChip contact={contact} href={href.detail('contacts', contact.id)} /> : <span className="muted">{t('tx.noContact')}</span>}
              </div>
              <div className="cell">
                <span className="cell-label">{t('accounts.service')}</span>
                {service ? (
                  <a className="cell-link" href={href.detail('services', service.id)}>
                    <Avatar image={service.image} name={service.name} size={22} />
                    {service.name}
                  </a>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
              <div className="cell">
                <span className="cell-label">{t('accounts.form')}</span>
                <FormBadge form={account.form} />
              </div>
              <div className="cell">
                <span className="cell-label">{t('accounts.requisite')}</span>
                {account.requisite ? (
                  <span className="requisite-copy">
                    <span className="requisite">{account.requisite}</span>
                    <CopyButton value={account.requisite} label={t('accounts.requisite')} copied={t('accounts.requisiteCopied')} />
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
              <div className="cell">
                <span className="cell-label">{t('accounts.createdWith')}</span>
                <AssetAmounts map={new Map(Object.entries(account.initialBalances))} assets={assets} keepZero column />
              </div>
            </div>
            <div className="cell">
              <span className="cell-label">{t('common.description')}</span>
              <span className="pre">{account.description || <span className="muted">—</span>}</span>
            </div>
            <div className="cells cells-3">
              <div className="cell">
                <span className="cell-label">{t('common.created')}</span>
                <span>{i18n.dateTime(account.createdAt)}</span>
              </div>
              <div className="cell">
                <span className="cell-label">{t('common.updated')}</span>
                <span>{i18n.dateTime(account.updatedAt)}</span>
              </div>
            </div>
          </section>
        </div>
      )}
      {pageTab === 'stats' && (
        <>
          {/* the whole tab counts over this period; empty ends = all time */}
          <div className="stats-period acc-tab-panel">
            {/* first: the fields stay put at the right edge when it shows up */}
            {(statsRange.from || statsRange.to) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatsRange({ from: '', to: '' })}>
                {t('stats.allTime')}
              </button>
            )}
            <span className="field-label">{t('filter.period')}</span>
            <span className="range-input range-input-dates">
              <DateTimeField value={statsRange.from} onChange={(v) => setStatsRange((r) => ({ ...r, from: v }))} placeholder={t('filter.min')} defaultTime="00:00" ariaLabel={`${t('filter.period')}, ${t('filter.min')}`} />
              <span>–</span>
              <DateTimeField value={statsRange.to} onChange={(v) => setStatsRange((r) => ({ ...r, to: v }))} placeholder={t('filter.max')} defaultTime="23:59" ariaLabel={`${t('filter.period')}, ${t('filter.max')}`} />
            </span>
          </div>
          <section className="panel acc-stats">
            <h2 className="panel-title-badge">
              {t('accounts.turnover')}
              <PeriodBadge range={statsRange} />
            </h2>
            <div className="cells">
              <div className="cell">
                <span className="cell-label">
                  <Icon name="arrowIn" size={14} className="flow-in" />
                  {t('stats.received')}
                </span>
                <AssetAmounts map={flow.in} assets={assets} column />
              </div>
              <div className="cell">
                <span className="cell-label">
                  <Icon name="arrowOut" size={14} className="flow-out" />
                  {t('stats.sent')}
                </span>
                <AssetAmounts map={flow.out} assets={assets} column />
              </div>
              <div className="cell">
                <span className="cell-label">{t('stats.transactions')}</span>
                <span className="tx-split" title={t('stats.inOutCount', { in: num(flow.txIn), out: num(flow.txOut) })}>
                  {num(flow.tx)}
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
          <FlowBreakdown account={account} dim="contacts" txs={periodTxs} range={statsRange} />
          <FlowBreakdown account={account} dim="accounts" txs={periodTxs} range={statsRange} />
          <FlowBreakdown account={account} dim="categories" txs={periodTxs} range={statsRange} />
        </>
      )}
      {pageTab === 'activity' && (
        <div className="acc-tab-panel">
          <TxBrowser txs={s.txs} side={side} stateKey={`account.${id}`} prefKey="accountTx" />
        </div>
      )}
      {edit && <AccountEditor account={account} onClose={() => setEdit(false)} />}
      {adjust && <BalanceAdjustment account={account} onClose={() => setAdjust(false)} />}
      {del && <DeleteAccount account={account} onClose={() => setDel(false)} onDeleted={() => (location.hash = href.list('accounts'))} />}
    </>
  );
}

type Dim = 'contacts' | 'accounts' | 'categories';
const DIM_ICON: Record<Dim, UiIconName> = { contacts: 'users', accounts: 'wallet', categories: 'tag' };

/** A link chip for an account or a category in a legend (the contact chip's look). */
function EntityChip({ href: to, icon, name }: { href: string; icon: ReactNode; name: string }) {
  return (
    <a className="contact-chip contact-chip-link" href={to}>
      {icon}
      <span className="contact-chip-name">{name}</span>
    </a>
  );
}

/**
 * An account's received and sent money split by a grouping - the other side's contact, the
 * other side's account, or the category - one ring each. Each ring can show amounts or counts,
 * and an account holding several assets gets an asset choice per ring; one group keeps one
 * colour in both rings.
 */
type StatsRange = { from: string; to: string };

/** The exact period the statistics count over ("1 окт. 2026 г., 00:00 – 31 окт. …", "с …", "по …", "За всё время"). */
function PeriodBadge({ range }: { range: StatsRange }) {
  const { t, dateTime } = useI18n();
  const text =
    range.from && range.to
      ? `${dateTime(range.from)} – ${dateTime(range.to)}`
      : range.from
        ? t('stats.since', { date: dateTime(range.from) })
        : range.to
          ? t('stats.until', { date: dateTime(range.to) })
          : t('stats.allTime');
  return (
    <span className="chart-dim period-badge">
      <Icon name="calendar" size={13} />
      {text}
    </span>
  );
}

function FlowBreakdown({ account, dim, txs, range }: { account: Account; dim: Dim; txs: Transaction[]; /** the period `txs` were taken from */ range: StatsRange }) {
  const { t } = useI18n();
  const period = !!(range.from || range.to);
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const colors = useChartColors();
  // colours are ranked on all the account's transactions, so a period change doesn't repaint them
  const allTxs = ix.account.get(account.id)!.txs;
  const assets = account.assetIds.map((x) => ix.assets.get(x)).filter((x) => !!x);
  const key = `account.${account.id}.${dim}`;
  const [inAsset, setInAsset] = useViewState(`${key}.inAsset`, account.assetIds[0]);
  const [outAsset, setOutAsset] = useViewState(`${key}.outAsset`, account.assetIds[0]);
  const [inMeasure, setInMeasure] = useViewState<'sum' | 'count'>(`${key}.inMeasure`, 'sum');
  const [outMeasure, setOutMeasure] = useViewState<'sum' | 'count'>(`${key}.outMeasure`, 'sum');

  // the group of a transaction, seen from this account's side
  const groupOf = (x: Transaction): string => {
    if (dim === 'categories') return x.categoryId || '__nocategory';
    const otherId = x.toId === account.id ? x.fromId : x.toId;
    const other = otherId ? ix.accounts.get(otherId) : undefined;
    if (!other) return '__external';
    return dim === 'accounts' ? other.id : other.contactId || '__nocontact';
  };
  const describe = (k: string): Pick<BreakdownSlice, 'label' | 'icon' | 'chip'> => {
    if (k === '__external') return { label: t('tx.external') };
    if (k === '__nocontact') return { label: t('tx.noContact') };
    if (k === '__nocategory') return { label: t('tx.noCategory') };
    if (dim === 'contacts') {
      const c = ix.contacts.get(k);
      if (!c) return { label: '?' };
      return { label: c.name, icon: <Avatar image={c.image} name={c.name} size={20} />, chip: <ContactChip contact={c} href={href.detail('contacts', c.id)} /> };
    }
    if (dim === 'accounts') {
      const a = ix.accounts.get(k);
      if (!a) return { label: '?' };
      const svc = a.serviceId ? ix.services.get(a.serviceId) : undefined;
      return { label: a.name, icon: <AccountIcon account={a} service={svc} size={20} />, chip: <EntityChip href={href.detail('accounts', a.id)} icon={<AccountIcon account={a} service={svc} size={18} />} name={a.name} /> };
    }
    const c = ix.categories.get(k);
    if (!c) return { label: '?' };
    const parent = c.parentId ? ix.categories.get(c.parentId) : undefined;
    const name = parent ? `${parent.name} / ${c.name}` : c.name;
    const pic = c.image || parent?.image || '';
    return { label: name, icon: <Avatar image={pic} name={c.name} size={20} fallback="tag" />, chip: <EntityChip href={href.detail('categories', c.id)} icon={<Avatar image={pic} name={c.name} size={18} fallback="tag" />} name={name} /> };
  };
  const slices = (dir: 'in' | 'out', assetId: string): BreakdownSlice[] => {
    const sums = new Map<string, { value: number; count: number }>();
    for (const x of txs) {
      if (x.assetId !== assetId) continue;
      if (dir === 'in' ? x.toId !== account.id : x.fromId !== account.id) continue;
      const k = groupOf(x);
      const sum = sums.get(k) ?? { value: 0, count: 0 };
      sums.set(k, { value: sum.value + x.amount, count: sum.count + 1 });
    }
    return [...sums].map(([k, { value, count }]) => ({ key: k, value, count, ...describe(k) }));
  };
  const received = slices('in', inAsset);
  const sent = slices('out', outAsset);

  // a colour per group, the same in both rings whatever asset each shows: groups ranked by how many
  // transactions they had with the account, in every asset and both directions
  const rank = useMemo(() => {
    const n = new Map<string, { count: number; amount: number }>();
    for (const x of allTxs) {
      const g = n.get(groupOf(x)) ?? { count: 0, amount: 0 };
      n.set(groupOf(x), { count: g.count + 1, amount: g.amount + x.amount });
    }
    // ties (as many transactions) go by amount, so the bigger sectors take the stronger colours
    return [...n].sort((a, b) => b[1].count - a[1].count || b[1].amount - a[1].amount || a[0].localeCompare(b[0])).map(([k]) => k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTxs, account.id, ix, dim]);
  const series = extendedSeries(colors);
  const colorOf = (k: string) => series[Math.max(0, rank.indexOf(k)) % series.length];

  // amount / count: in the card's top right corner
  const measureSwitch = (measure: 'sum' | 'count', setMeasure: (v: 'sum' | 'count') => void) => (
    <Segmented<'sum' | 'count'>
      value={measure}
      onChange={setMeasure}
      options={[
        { value: 'sum', label: t('chart.measureSum') },
        { value: 'count', label: t('chart.measureCount') },
      ]}
    />
  );
  const title = (icon: 'arrowIn' | 'arrowOut', text: string) => (
    <span className="chart-title-icon">
      <Icon name={icon} size={16} className={icon === 'arrowIn' ? 'flow-in' : 'flow-out'} />
      {text}
    </span>
  );
  // a row of its own under the title (what it groups by; the asset when the account holds several),
  // so the rings of neighbouring cards line up
  const toolbar = (asset: string, setAsset: (v: string) => void) => (
    <div className="chart-toolbar">
      <span className="chart-badges">
        <span className="chart-dim">
          <Icon name={DIM_ICON[dim]} size={13} />
          {t(`chart.dim.${dim}`)}
        </span>
        <PeriodBadge range={range} />
      </span>
      {assets.length > 1 && (
        <Picker label={t('filter.asset')} value={asset} onChange={setAsset} options={assets.map((a) => ({ value: a.id, label: a.code, icon: <AssetIcon asset={a} size={18} /> }))} />
      )}
    </div>
  );

  return (
    <div className="acc-flow">
      <ChartCard title={title('arrowIn', t('accounts.receivedFrom'))} actions={measureSwitch(inMeasure, setInMeasure)}>
        {toolbar(inAsset, setInAsset)}
        <BreakdownDonut slices={received} asset={ix.assets.get(inAsset)} colorOf={colorOf} measure={inMeasure} empty={period ? t('accounts.noReceivedPeriod') : t('accounts.noReceived')} ariaLabel={`${t('accounts.receivedFrom')}: ${t(`chart.dim.${dim}`)}`} />
      </ChartCard>
      <ChartCard title={title('arrowOut', t('accounts.sentTo'))} actions={measureSwitch(outMeasure, setOutMeasure)}>
        {toolbar(outAsset, setOutAsset)}
        <BreakdownDonut slices={sent} asset={ix.assets.get(outAsset)} colorOf={colorOf} measure={outMeasure} empty={period ? t('accounts.noSentPeriod') : t('accounts.noSent')} ariaLabel={`${t('accounts.sentTo')}: ${t(`chart.dim.${dim}`)}`} />
      </ChartCard>
    </div>
  );
}

/**
 * Balance adjustment: the balances the account really holds now are typed in, and its starting
 * balances shift so the computed balances become exactly these; the transactions stay.
 */
export function BalanceAdjustment({ account, onClose }: { account: Account; onClose: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const balances = ix.account.get(account.id)?.balances;
  const current = (x: string) => balances?.get(x) ?? 0;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(account.assetIds.map((x) => [x, String(current(x))])));
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const parsed = Object.fromEntries(account.assetIds.map((x) => [x, values[x]?.trim() ? parseAmount(values[x]) : 0]));
  const errors = Object.fromEntries(account.assetIds.map((x) => [x, parsed[x] === null ? t('form.badNumber') : null]));
  const invalid = Object.values(errors).some(Boolean);
  const diff = (x: string) => (parsed[x] === null ? 0 : round(parsed[x]! - current(x)));
  const changed = account.assetIds.some((x) => diff(x) !== 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    setConfirm(true);
  };
  // only once confirmed: the old balances are gone after this
  const save = () => {
    const initial = Object.fromEntries(account.assetIds.map((x) => [x, round((account.initialBalances[x] ?? 0) + diff(x))]));
    mutate((d) => setInitialBalances(d, account.id, initial));
    onClose();
  };

  return (
    <Modal title={t('accounts.adjustTitle', { name: account.name })} onClose={onClose} footer={<FormFooter onCancel={onClose} disabled={!changed} />}>
      <form id="entity-form" className="form" onSubmit={submit} noValidate>
        <div className="warn-box">
          <Icon name="alert" />
          <div>
            <strong>{t('accounts.adjustWarnTitle')}</strong>
            <p>{t('accounts.adjustWarnText')}</p>
          </div>
        </div>
        {account.assetIds.map((x) => {
          const asset = ix.assets.get(x);
          const d = diff(x);
          return (
            <div key={x} className="initial-row">
              <Field label={t('accounts.newBalanceFor', { code: asset?.code ?? '' })} error={tried ? errors[x] : null}>
                <input type="text" inputMode="decimal" value={values[x] ?? ''} onChange={(e) => setValues({ ...values, [x]: e.target.value })} placeholder="0" />
              </Field>
              {/* the balance now, and by how much the adjustment moves it */}
              <div className="initial-preview">
                <span className="cell-label">{t('accounts.balanceNow')}</span>
                <span className="initial-preview-values">
                  {money(i18n, current(x), asset)}
                  {d !== 0 && <span className={`money ${d > 0 ? 'pos' : 'neg'}`}>({money(i18n, d, asset, { sign: true })})</span>}
                </span>
              </div>
            </div>
          );
        })}
      </form>
      {confirm && (
        <ConfirmDialog
          title={t('accounts.adjustConfirmTitle')}
          text={t('accounts.adjustConfirmText', { name: account.name })}
          confirmLabel={t('accounts.adjustConfirm')}
          onConfirm={save}
          onClose={() => setConfirm(false)}
        >
          <ul className="adjust-list">
            {account.assetIds
              .filter((x) => diff(x) !== 0)
              .map((x) => {
                const asset = ix.assets.get(x);
                return (
                  <li key={x}>
                    <AssetIcon asset={asset} size={18} />
                    <span className="muted">{money(i18n, current(x), asset)}</span>
                    <Icon name="chevronRight" size={14} className="muted" />
                    <strong>{money(i18n, parsed[x]!, asset)}</strong>
                  </li>
                );
              })}
          </ul>
        </ConfirmDialog>
      )}
    </Modal>
  );
}

export function DeleteAccount({ account, onClose, onDeleted }: { account: Account; onClose: () => void; onDeleted?: () => void }) {
  const { t, tn } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const n = ix.account.get(account.id)?.flow.tx ?? 0;
  const templates = templatesUsing(ix, 'accounts', account.id);
  return (
    <ConfirmDialog
      title={t('accounts.deleteTitle', { name: account.name })}
      text={n ? t('accounts.deleteWithTx', { tx: tn('counts.transactions', n) }) : t('common.cannotUndo')}
      phrase={n ? account.name : undefined}
      onClose={onClose}
      onConfirm={() => {
        mutate((d) => deleteAccount(d, account.id));
        onDeleted?.();
      }}
    >
      {templates.length > 0 && (
        <>
          <p className="muted">{t('accounts.deleteTemplates', { n: templates.length })}</p>
          <TemplateNames list={templates} />
        </>
      )}
    </ConfirmDialog>
  );
}

export function AccountEditor({ account, contactId, onClose }: { account: Account | null; contactId?: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const rules = useTextRules();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [name, setName] = useState(account?.name ?? '');
  const [form, setForm] = useState<FormId>(account?.form ?? 'bank');
  const [assetIds, setAssetIds] = useState<string[]>(account?.assetIds ?? []);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [requisite, setRequisite] = useState(account?.requisite ?? '');
  const [serviceId, setServiceId] = useState(account?.serviceId ?? '');
  const [contact, setContact] = useState(account ? account.contactId : (contactId ?? ix.self?.id ?? ''));
  const [description, setDescription] = useState(account?.description ?? '');
  const [tried, setTried] = useState(false);

  const isNew = !account;
  const contactOptions = useContactOptions(data.contacts);
  const fixedAssets = new Set(account?.assetIds ?? []);
  const formAssets = data.assets.filter((a) => a.forms.includes(form) || fixedAssets.has(a.id)).sort(byName(locale));
  const assetOptions: Option[] = formAssets.map((a) => ({ value: a.id, label: a.code, icon: <AssetIcon asset={a} size={22} /> }));
  const services = servicesInOrder(data.services).filter((s) => s.forms.includes(form));
  // assets whose starting balance can still be set: all on creation, newly added ones for crypto
  const editableBalance = assetIds.filter((x) => !fixedAssets.has(x));

  const changeForm = (f: FormId) => {
    setForm(f);
    setAssetIds([]);
    setServiceId('');
  };

  const balanceErrors = Object.fromEntries(
    editableBalance.map((x) => [x, balances[x]?.trim() && parseAmount(balances[x]) === null ? t('form.badNumber') : null]),
  );
  const errors = {
    name: rules.required(name),
    assets: assetIds.length ? null : form === 'crypto' ? t('accounts.assetsRequired') : t('accounts.assetRequired'),
    requisite: requisite.length > LIMITS.requisite ? t('form.tooLong', { n: LIMITS.requisite }) : null,
    balances: Object.values(balanceErrors).some(Boolean) ? 'x' : null,
    description: rules.optional(description),
  };
  const invalid = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (tried ? errors[k] : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    const initialBalances: Record<string, number> = { ...(account?.initialBalances ?? {}) };
    for (const x of editableBalance) initialBalances[x] = parseAmount(balances[x] ?? '') ?? 0;
    mutate(
      (d) =>
        saveAccount(
          d,
          {
            name: name.trim(),
            form,
            assetIds,
            initialBalances,
            requisite: form === 'cash' ? '' : requisite.trim(),
            serviceId: form === 'cash' ? '' : serviceId,
            contactId: contact,
            description: description.trim(),
          },
          account?.id,
        ).data,
    );
    onClose();
  };

  return (
    <Modal title={account ? t('accounts.edit') : t('accounts.new')} onClose={onClose} size="lg" footer={<FormFooter onCancel={onClose} />}>
      <form id="entity-form" className="form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <NameField value={name} onChange={setName} error={err('name')} />
          <Field label={t('accounts.contact')} group>
            <Picker value={contact} onChange={setContact} options={[{ value: '', label: t('common.absent') }, ...contactOptions]} placeholder={t('common.absent')} ariaLabel={t('accounts.contact')} />
          </Field>
        </div>
        {/* the form and the assets are chosen once, when the account is created */}
        {isNew && (
          <div className="form-grid">
            <Field label={t('accounts.form')} group>
              <Picker value={form} onChange={(v) => changeForm(v as FormId)} options={FORMS.map((f) => ({ value: f, label: t(`form.${f}`) }))} ariaLabel={t('accounts.form')} />
            </Field>
            <Field label={form === 'crypto' ? t('accounts.assets') : t('accounts.asset')} group error={err('assets')}>
              {formAssets.length === 0 ? (
                <p className="muted">{t('accounts.noFormAssets')}</p>
              ) : form === 'crypto' ? (
                <Picker multiple value={assetIds} onChange={setAssetIds} options={assetOptions} placeholder={t('common.absent')} ariaLabel={t('accounts.assets')} />
              ) : (
                <Picker value={assetIds[0] ?? ''} onChange={(v) => setAssetIds([v])} options={assetOptions} placeholder={t('common.absent')} ariaLabel={t('accounts.asset')} />
              )}
            </Field>
          </div>
        )}
        {editableBalance.length > 0 && (
          <div className="initial-box">
            <div className="initial-box-head">
              <Icon name="star" size={18} />
              <div>
                <strong>{t('accounts.initialTitle')}</strong>
                <p>{t('accounts.initialText')}</p>
              </div>
            </div>
            <div className="form-grid">
              {editableBalance.map((x) => {
                const a = ix.assets.get(x);
                return (
                  <Field key={x} label={t('accounts.initialFor', { code: a?.code ?? '' })} error={tried ? balanceErrors[x] : null}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={balances[x] ?? ''}
                      onChange={(e) => setBalances({ ...balances, [x]: e.target.value })}
                      placeholder="0"
                    />
                  </Field>
                );
              })}
            </div>
          </div>
        )}
        {form !== 'cash' && (
          <div className="form-grid">
            <Field label={t('accounts.requisite')} error={err('requisite')}>
              <input type="text" value={requisite} onChange={(e) => setRequisite(e.target.value)} placeholder={form === 'crypto' ? 'T…' : '4149 …'} />
            </Field>
            <Field label={t('accounts.service')} group>
              <Picker
                value={serviceId}
                onChange={setServiceId}
                options={[
                  { value: '', label: t('common.absent') },
                  ...services.map((x) => ({ value: x.id, label: x.name, icon: <Avatar image={x.image} name={x.name} size={22} /> })),
                ]}
                placeholder={t('common.absent')}
                ariaLabel={t('accounts.service')}
              />
            </Field>
          </div>
        )}
        <DescriptionField value={description} onChange={setDescription} error={err('description')} />
      </form>
    </Modal>
  );
}
