import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AssetIcon, Avatar, CardMenu, ContactChip, EmptyState, Field, Highlight, Money, MultiSelect, type Option, Pagination, Picker, SearchField, useContactOptions, usePaged } from '../components/bits';
import { DescriptionField, FormFooter, NameField, useTextRules } from '../components/forms';
import { PageHead } from '../components/Layout';
import { useViewState } from '../components/viewState';
import { ConfirmDialog, Modal } from '../components/Modal';
import { TxList } from '../components/TxList';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { parseAmount } from '../lib/format';
import { deleteDebt, saveDebt } from '../lib/ops';
import { matchesAny } from '../lib/search';
import { getIndex } from '../lib/stats';
import type { Asset, Contact, Debt } from '../lib/types';
import { href } from '../router';
import { mutate, useStore } from '../store/store';
import { openTxForm } from '../store/ui';
import { NotFound } from './common';

type Status = 'open' | 'closed' | 'all';

/**
 * Repayment bar: the repaid amount sits at the end of the filled part, the whole debt
 * (initial amount plus what transactions added) at the end of the bar. When the two
 * labels would run into each other they are joined at the end: "repaid / whole". Each amount
 * carries the avatar of who pays it (debtor) or who receives it (creditor).
 */
function DebtBar({ repaid, total, asset, debtor, creditor }: { repaid: number; total: number; asset: Asset | undefined; debtor?: Contact; creditor?: Contact }) {
  const { t } = useI18n();
  const part = total > 0 ? Math.min(1, Math.max(0, repaid / total)) : repaid > 0 ? 1 : 0;
  const bar = useRef<HTMLDivElement>(null);
  const paid = useRef<HTMLSpanElement>(null);
  const whole = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ bar: 0, paid: 0, whole: 0 });
  useLayoutEffect(() => {
    const measure = () => setSize({ bar: bar.current?.offsetWidth ?? 0, paid: paid.current?.offsetWidth ?? 0, whole: whole.current?.offsetWidth ?? 0 });
    measure();
    // the labels change width too, once fonts or pictures arrive
    const ro = new ResizeObserver(measure);
    for (const el of [bar.current, paid.current, whole.current]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [repaid, total]);

  const joined = Math.max(part * size.bar, size.paid) + 10 > size.bar - size.whole;
  return (
    <div className="debt-bar" ref={bar} title={t('debts.repaidPart', { p: Math.round(part * 100) })}>
      <div className="progress progress-full">
        <span style={{ width: `${part * 100}%` }} />
      </div>
      {repaid > 0 && (
        // spans the filled part and right-aligns the label in it; a label wider than the fill
        // grows the box to the right, so it never crosses the card's left padding
        <span className="debt-bar-paidbox" style={joined ? { left: 'auto', right: size.whole + 4, width: 'auto' } : { width: `${part * 100}%` }}>
          <span ref={paid} className="debt-bar-label debt-bar-paid">
            {debtor && <Avatar image={debtor.image} name={debtor.name} size={16} />}
            <Money value={repaid} asset={asset} />
            {joined && <span className="muted">/</span>}
          </span>
        </span>
      )}
      <span ref={whole} className="debt-bar-label debt-bar-whole">
        {creditor && <Avatar image={creditor.image} name={creditor.name} size={16} />}
        <Money value={total} asset={asset} />
      </span>
    </div>
  );
}

export function DebtRow({ d, q = '', onEdit, onDelete }: { d: Debt; q?: string; onEdit?: () => void; onDelete?: () => void }) {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const s = ix.debt.get(d.id)!;
  const asset = ix.assets.get(d.assetId);
  const debtor = ix.contacts.get(d.debtorId);
  const creditor = ix.contacts.get(d.creditorId);
  return (
    <a className="row" href={href.detail('debts', d.id)}>
      <div className="row-main">
        <div className="row-title">
          <Highlight text={d.name} query={q} />
          {s.closed && <span className="badge">{t('debts.closed')}</span>}
        </div>
        <div className="row-meta debt-parties">
          <ContactChip contact={debtor} query={q} href={debtor && href.detail('contacts', debtor.id)} inLink />
          <span>{t('debts.owesTo')}</span>
          {/* what is owed right now; below zero when overpaid */}
          <span className="amount-chip">
            <AssetIcon asset={asset} size={16} />
            <Money value={s.remaining} asset={asset} />
          </span>
          <ContactChip contact={creditor} query={q} href={creditor && href.detail('contacts', creditor.id)} inLink />
        </div>
        <DebtBar repaid={s.repaid} total={d.amount + s.added} asset={asset} debtor={debtor} creditor={creditor} />
      </div>
      {(onEdit || onDelete) && (
        <CardMenu
          actions={[
            { label: t('debts.addPayment'), icon: 'plus', onSelect: () => openTxForm({ prefill: { debtId: d.id, assetId: d.assetId } }) },
            ...(onEdit ? [{ label: t('common.edit'), icon: 'edit' as const, onSelect: onEdit }] : []),
            ...(onDelete ? [{ label: t('common.delete'), icon: 'trash' as const, danger: true, onSelect: onDelete }] : []),
          ]}
        />
      )}
    </a>
  );
}

export function DebtsPage() {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const contactOptions = useContactOptions(data.contacts);
  const [q, setQ] = useViewState('debts.q', '');
  const [status, setStatus] = useViewState<Status>('debts.status', 'open');
  const [contacts, setContacts] = useViewState<string[]>('debts.contacts', []);
  const [assets, setAssets] = useViewState<string[]>('debts.assets', []);
  const [edit, setEdit] = useState<Debt | 'new' | null>(null);
  const [del, setDel] = useState<Debt | null>(null);

  const list = useMemo(
    () =>
      data.debts
        .filter((d) => {
          const s = ix.debt.get(d.id)!;
          if (status === 'open' && s.closed) return false;
          if (status === 'closed' && !s.closed) return false;
          if (contacts.length && !contacts.includes(d.debtorId) && !contacts.includes(d.creditorId)) return false;
          if (assets.length && !assets.includes(d.assetId)) return false;
          return matchesAny(q, d.name, ix.contacts.get(d.debtorId)?.name, ix.contacts.get(d.creditorId)?.name);
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.debts, ix, q, status, contacts, assets],
  );
  const paged = usePaged(list, 'debts', `${q}|${status}|${contacts}|${assets}`);

  return (
    <>
      <PageHead
        title={t('nav.debts')}
        icon={<Icon name="handshake" />}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={18} />
            {t('debts.add')}
          </button>
        }
      />
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
        <MultiSelect
          label={t('filter.contact')}
          options={contactOptions}
          value={contacts}
          onChange={setContacts}
        />
        <MultiSelect
          label={t('filter.asset')}
          options={data.assets.map((a) => ({ value: a.id, label: a.code, icon: <AssetIcon asset={a} size={18} /> }))}
          value={assets}
          onChange={setAssets}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState icon="handshake" text={data.debts.length ? t('common.nothingFound') : t('debts.empty')} />
      ) : (
        <div className="rows">
          {paged.items.map((d) => (
            <DebtRow key={d.id} d={d} q={q} onEdit={() => setEdit(d)} onDelete={() => setDel(d)} />
          ))}
        </div>
      )}
      <Pagination p={paged} />
      {edit && <DebtEditor debt={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {del && <DeleteDebt debt={del} onClose={() => setDel(null)} />}
    </>
  );
}

export function DebtDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const debt = ix.debts.get(id);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const s = ix.debt.get(id);
  // seen from the creditor's accounts: a repayment is incoming
  const side = useMemo(() => new Set(debt ? (ix.contact.get(debt.creditorId)?.accounts.map((a) => a.id) ?? []) : []), [debt, ix]);
  if (!debt || !s) return <NotFound />;
  const asset = ix.assets.get(debt.assetId);
  const debtor = ix.contacts.get(debt.debtorId);
  const creditor = ix.contacts.get(debt.creditorId);

  return (
    <>
      <PageHead
        crumbs={[{ label: t('nav.debts'), href: href.list('debts') }]}
        title={debt.name}
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => openTxForm({ prefill: { debtId: id, assetId: debt.assetId } })}>
              <Icon name="plus" size={18} />
              {t('debts.addPayment')}
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
      <div className="debt-layout">
        <section className="panel debt-summary">
          <h2 className="panel-title">
            {t('debts.one')}
            {s.closed ? <span className="badge">{t('debts.closed')}</span> : <span className="badge badge-accent">{t('debts.isOpen')}</span>}
          </h2>
          <div className="cell">
            <span className="cell-label">{t('debts.debtor')}</span>
            <ContactChip contact={debtor} href={debtor && href.detail('contacts', debtor.id)} />
          </div>
          <div className="cell">
            <span className="cell-label">{t('debts.creditor')}</span>
            <ContactChip contact={creditor} href={creditor && href.detail('contacts', creditor.id)} />
          </div>
          <div className="cell">
            <span className="cell-label">{t('debts.toRepay')}</span>
            <span className="badges debt-amount">
              <span className="amount-chip">
                <AssetIcon asset={asset} size={18} />
                <Money value={s.remaining} asset={asset} />
              </span>
              {s.remaining < 0 && <span className="badge badge-warn">{t('debts.overpaidBadge')}</span>}
            </span>
          </div>
        </section>
        <section className="panel debt-details">
          <h2>{t('common.details')}</h2>
          <div className="cells">
            <div className="cell">
              <span className="cell-label">{t('debts.total')}</span>
              <Money value={debt.amount + s.added} asset={asset} />
            </div>
            <div className="cell">
              <span className="cell-label">{t('debts.repaid')}</span>
              <Money value={s.repaid} asset={asset} />
            </div>
          </div>
          <DebtBar repaid={s.repaid} total={debt.amount + s.added} asset={asset} debtor={debtor} creditor={creditor} />
          <div className="cell">
            <span className="cell-label">{t('common.description')}</span>
            <span className="pre">{debt.description || <span className="muted">—</span>}</span>
          </div>
          <div className="cells">
            <div className="cell">
              <span className="cell-label">{t('common.created')}</span>
              <span>{i18n.dateTime(debt.createdAt)}</span>
            </div>
            <div className="cell">
              <span className="cell-label">{t('common.updated')}</span>
              <span>{i18n.dateTime(debt.updatedAt)}</span>
            </div>
          </div>
        </section>
      </div>
      <section className="section">
        <div className="section-head">
          <h2>
            {t('debts.history')} <span className="count">{s.txs.length}</span>
          </h2>
        </div>
        <TxList txs={s.txs} side={side} prefKey="debtTx" resetKey={id} empty={t('debts.noHistory')} />
      </section>
      {edit && <DebtEditor debt={debt} onClose={() => setEdit(false)} />}
      {del && <DeleteDebt debt={debt} onClose={() => setDel(false)} onDeleted={() => (location.hash = href.list('debts'))} />}
    </>
  );
}

function DeleteDebt({ debt, onClose, onDeleted }: { debt: Debt; onClose: () => void; onDeleted?: () => void }) {
  const { t, tn } = useI18n();
  const data = useStore((s) => s.data);
  const n = getIndex(data).debt.get(debt.id)?.txs.length ?? 0;
  return (
    <ConfirmDialog
      title={t('debts.deleteTitle', { name: debt.name })}
      text={n ? t('debts.deleteUnlink', { tx: tn('counts.transactions', n) }) : t('common.cannotUndo')}
      onClose={onClose}
      onConfirm={() => {
        mutate((d) => deleteDebt(d, debt.id));
        onDeleted?.();
      }}
    />
  );
}

export function DebtEditor({ debt, contactId, onClose }: { debt: Debt | null; contactId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const rules = useTextRules();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const selfId = ix.self?.id ?? '';
  const [name, setName] = useState(debt?.name ?? '');
  const [description, setDescription] = useState(debt?.description ?? '');
  const [assetId, setAssetId] = useState(debt?.assetId ?? data.assets[0]?.id ?? '');
  const [debtorId, setDebtorId] = useState(debt?.debtorId ?? (contactId && contactId !== selfId ? contactId : ''));
  const [creditorId, setCreditorId] = useState(debt?.creditorId ?? selfId);
  const [amount, setAmount] = useState(debt ? String(debt.amount) : '');
  const [tried, setTried] = useState(false);
  const locked = !!debt;
  const contacts = useContactOptions(data.contacts);
  // "nobody" can be picked to clear a side; the contact chosen on the other side can't be picked here
  const partyOptions = (other: string): Option[] => [
    { value: '', label: t('debts.noParty') },
    ...contacts.map((o) => (o.value === other ? { ...o, disabled: true } : o)),
  ];
  const assets: Option[] = data.assets.map((a) => ({ value: a.id, label: a.code, icon: <AssetIcon asset={a} size={22} /> }));
  const amountN = parseAmount(amount);

  const errors = {
    name: rules.required(name),
    description: rules.optional(description),
    asset: assetId ? null : t('form.required'),
    parties: !debtorId || !creditorId ? t('form.required') : debtorId === creditorId ? t('debts.sameParties') : null,
    amount: locked ? null : amountN === null || amountN < 0 ? t('form.badNumber') : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (tried ? errors[k] : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    mutate(
      (d) =>
        saveDebt(
          d,
          debt
            ? { ...debt, name: name.trim(), description: description.trim() }
            : { name: name.trim(), description: description.trim(), assetId, debtorId, creditorId, amount: amountN ?? 0 },
          debt?.id,
        ).data,
    );
    onClose();
  };

  const swap = () => {
    setDebtorId(creditorId);
    setCreditorId(debtorId);
  };

  return (
    <Modal title={debt ? t('debts.edit') : t('debts.new')} onClose={onClose} footer={<FormFooter onCancel={onClose} />}>
      <form id="entity-form" className="form" onSubmit={submit} noValidate>
        <NameField value={name} onChange={setName} error={err('name')} placeholder={t('debts.namePlaceholder')} />
        {/* one grid for both rows, so the asset and the amount sit exactly under the parties */}
        <div className="form-grid form-grid-swap">
          <Field label={t('debts.debtor')} error={err('parties')} group>
            <Picker value={debtorId} onChange={setDebtorId} options={partyOptions(creditorId)} placeholder={t('debts.noParty')} disabled={locked} ariaLabel={t('debts.debtor')} />
          </Field>
          {locked ? (
            <span className="swap-spacer" />
          ) : (
            // an empty label row keeps the button level with the controls, whatever errors show under them
            <div className="field swap-field">
              <span className="field-label" aria-hidden="true">
                &nbsp;
              </span>
              <button type="button" className="icon-btn swap-btn" onClick={swap} aria-label={t('debts.swap')} title={t('debts.swap')}>
                <Icon name="swap" size={18} />
              </button>
            </div>
          )}
          <Field label={t('debts.creditor')} group>
            <Picker value={creditorId} onChange={setCreditorId} options={partyOptions(debtorId)} placeholder={t('debts.noParty')} disabled={locked} ariaLabel={t('debts.creditor')} />
          </Field>
          <Field label={t('debts.asset')} error={err('asset')} group>
            <Picker value={assetId} onChange={setAssetId} options={assets} disabled={locked} ariaLabel={t('debts.asset')} />
          </Field>
          <span className="swap-spacer" />
          <Field label={t('debts.initial')} error={err('amount')}>
            <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={locked} placeholder="0" />
          </Field>
        </div>
        <DescriptionField value={description} onChange={setDescription} error={err('description')} />
      </form>
    </Modal>
  );
}
