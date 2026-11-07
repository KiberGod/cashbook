import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { AssetAmounts, FORM_ICON, AssetIcon, Avatar, CardMenu, ContactChip, EmptyState, Field, FormBadge, Highlight, MultiSelect, type Option, Pagination, Picker, SearchField, Segmented, useContactOptions, usePaged } from '../components/bits';
import { DescriptionField, FormFooter, NameField, useTextRules } from '../components/forms';
import { PageHead } from '../components/Layout';
import { dragHandle, swallowNextClick, useDragSensors } from '../components/dnd';
import { useViewState } from '../components/viewState';
import { ConfirmDialog, Modal } from '../components/Modal';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { formPalette, imagePalette, type CardPalette } from '../lib/cardPalette';
import { parseAmount } from '../lib/format';
import { accountsInOrder, deleteAccount, moveAccount, saveAccount, servicesInOrder } from '../lib/ops';
import { byName, matchesAny } from '../lib/search';
import { getIndex } from '../lib/stats';
import { TxBrowser } from '../components/TxBrowser';
import { FORMS, LIMITS, type Account, type FormId } from '../lib/types';
import { href } from '../router';
import { mutate, useStore } from '../store/store';
import { openTxForm } from '../store/ui';
import { NotFound } from './common';

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
                <AccountCard key={a.id} a={a} q={q} sortable={sortable} onEdit={() => setEdit(a)} onDelete={() => setDel(a)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <Pagination p={paged} />
      {edit && <AccountEditor account={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
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
function AccountCard({ a, q, sortable, onEdit, onDelete }: { a: Account; q: string; sortable: boolean; onEdit: () => void; onDelete: () => void }) {
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

export function AccountDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t, num } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const account = ix.accounts.get(id);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [tab, setTab] = useViewState<'main' | 'more'>('account.detailsTab', 'main');
  const side = useMemo(() => new Set([id]), [id]);
  const s = ix.account.get(id);


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
            <button type="button" className="btn btn-danger-ghost" onClick={() => setDel(true)}>
              <Icon name="trash" size={18} />
              {t('common.delete')}
            </button>
          </>
        }
      />
      <div className="acc-layout">
        <AccountCardStatic a={account} />
        <section className="panel acc-stats">
          <h2>{t('accounts.stats')}</h2>
          <div className="cells cells-3">
            <div className="cell">
              <span className="cell-label">{t('accounts.balance')}</span>
              <AssetAmounts map={s.balances} assets={assets} keepZero column />
            </div>
            <div className="cell">
              <span className="cell-label">{t('stats.transactions')}</span>
              <span>
                {num(s.flow.tx)} <span className="muted small">({t('stats.inOutCount', { in: num(s.flow.txIn), out: num(s.flow.txOut) })})</span>
              </span>
            </div>
            <div className="cell">
              <span className="cell-label">{t('stats.fees')}</span>
              <AssetAmounts map={s.flow.fees} assets={data.assets} column />
            </div>
            <div className="cell">
              <span className="cell-label">
                <Icon name="arrowIn" size={14} className="flow-in" />
                {t('stats.received')}
              </span>
              <AssetAmounts map={s.flow.in} assets={assets} column />
            </div>
            <div className="cell">
              <span className="cell-label">
                <Icon name="arrowOut" size={14} className="flow-out" />
                {t('stats.sent')}
              </span>
              <AssetAmounts map={s.flow.out} assets={assets} column />
            </div>
          </div>
        </section>
      </div>
      <section className="panel acc-details">
        <div className="panel-head">
          <h2>{t('common.details')}</h2>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'main', label: t('accounts.tabMain') },
              { value: 'more', label: t('accounts.tabMore') },
            ]}
          />
        </div>
        {tab === 'main' ? (
          <>
            <div className="cells cells-3">
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
                {account.requisite ? <span className="requisite">{account.requisite}</span> : <span className="muted">—</span>}
              </div>
            </div>
            <div className="cell">
              <span className="cell-label">{t('common.description')}</span>
              <span className="pre">{account.description || <span className="muted">—</span>}</span>
            </div>
          </>
        ) : (
          <div className="cells cells-3">
            <div className="cell">
              <span className="cell-label">{t('accounts.createdWith')}</span>
              <AssetAmounts map={new Map(Object.entries(account.initialBalances))} assets={assets} keepZero column />
            </div>
            <div className="cell">
              <span className="cell-label">{t('common.created')}</span>
              <span>{i18n.dateTime(account.createdAt)}</span>
            </div>
            <div className="cell">
              <span className="cell-label">{t('common.updated')}</span>
              <span>{i18n.dateTime(account.updatedAt)}</span>
            </div>
          </div>
        )}
      </section>
      <TxBrowser txs={s.txs} side={side} stateKey={`account.${id}`} prefKey="accountTx" />
      {edit && <AccountEditor account={account} onClose={() => setEdit(false)} />}
      {del && <DeleteAccount account={account} onClose={() => setDel(false)} onDeleted={() => (location.hash = href.list('accounts'))} />}
    </>
  );
}

export function DeleteAccount({ account, onClose, onDeleted }: { account: Account; onClose: () => void; onDeleted?: () => void }) {
  const { t, tn } = useI18n();
  const data = useStore((s) => s.data);
  const n = getIndex(data).account.get(account.id)?.flow.tx ?? 0;
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
    />
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
