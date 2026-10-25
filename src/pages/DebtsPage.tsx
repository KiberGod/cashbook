import { useMemo, useState, type FormEvent } from 'react';
import { AssetAmounts, AssetIcon, Avatar, CardMenu, EmptyState, Field, Highlight, Money, MultiSelect, Pagination, SearchField, Segmented, Stat, usePaged } from '../components/bits';
import { DescriptionField, FormFooter, NameField, useTextRules } from '../components/forms';
import { PageHead } from '../components/Layout';
import { ConfirmDialog, Modal } from '../components/Modal';
import { TxList } from '../components/TxList';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { parseAmount } from '../lib/format';
import { deleteDebt, saveDebt } from '../lib/ops';
import { byName, matchesAny } from '../lib/search';
import { getIndex } from '../lib/stats';
import type { Debt } from '../lib/types';
import { href } from '../router';
import { mutate, useStore } from '../store/store';
import { openTxForm } from '../store/ui';
import { NotFound } from './common';

type Status = 'open' | 'closed' | 'all';

export function DebtRow({ d, q = '', onEdit, onDelete }: { d: Debt; q?: string; onEdit?: () => void; onDelete?: () => void }) {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const s = ix.debt.get(d.id)!;
  const asset = ix.assets.get(d.assetId);
  const debtor = ix.contacts.get(d.debtorId);
  const creditor = ix.contacts.get(d.creditorId);
  const total = d.amount + s.added;
  const progress = total > 0 ? Math.min(1, Math.max(0, s.repaid / total)) : s.remaining === 0 ? 1 : 0;
  // overpaid: the direction flips
  const [owes, owed] = s.remaining >= 0 ? [debtor, creditor] : [creditor, debtor];
  return (
    <a className="row" href={href.detail('debts', d.id)}>
      <AssetIcon asset={asset} size={34} />
      <div className="row-main">
        <div className="row-title">
          <Highlight text={d.name} query={q} />
          {s.remaining === 0 && <span className="badge">{t('debts.closed')}</span>}
        </div>
        <div className="row-meta">
          <span>
            <Highlight text={owes?.name ?? '?'} query={q} /> → <Highlight text={owed?.name ?? '?'} query={q} />
          </span>
        </div>
        <div className="progress" title={t('debts.repaidPart', { p: Math.round(progress * 100) })}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div className="row-side">
        <Money value={Math.abs(s.remaining)} asset={asset} />
        <div className="muted small">{t('debts.remaining')}</div>
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
  const { t, locale } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>('open');
  const [contacts, setContacts] = useState<string[]>([]);
  const [assets, setAssets] = useState<string[]>([]);
  const [edit, setEdit] = useState<Debt | 'new' | null>(null);
  const [del, setDel] = useState<Debt | null>(null);

  const list = useMemo(
    () =>
      data.debts
        .filter((d) => {
          const s = ix.debt.get(d.id)!;
          if (status === 'open' && s.remaining === 0) return false;
          if (status === 'closed' && s.remaining !== 0) return false;
          if (contacts.length && !contacts.includes(d.debtorId) && !contacts.includes(d.creditorId)) return false;
          if (assets.length && !assets.includes(d.assetId)) return false;
          return matchesAny(q, d.name, ix.contacts.get(d.debtorId)?.name, ix.contacts.get(d.creditorId)?.name);
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.debts, ix, q, status, contacts, assets],
  );
  const paged = usePaged(list, 'debts', `${q}|${status}|${contacts}|${assets}`);
  const self = ix.self ? ix.contact.get(ix.self.id) : undefined;

  return (
    <>
      <PageHead
        title={t('nav.debts')}
        icon={<Icon name="handshake" />}
        subtitle={t('debts.subtitle')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={18} />
            {t('debts.add')}
          </button>
        }
      />
      {self && (
        <div className="stats-row">
          <Stat label={t('debts.owedToMeShort')} icon="arrowIn">
            <AssetAmounts map={self.owedToMe} assets={data.assets} />
          </Stat>
          <Stat label={t('debts.iOweShort')} icon="arrowOut">
            <AssetAmounts map={self.iOwe} assets={data.assets} />
          </Stat>
        </div>
      )}
      <div className="toolbar">
        <SearchField value={q} onChange={setQ} placeholder={t('debts.search')} />
        <Segmented<Status>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: t('debts.open') },
            { value: 'closed', label: t('debts.closedMany') },
            { value: 'all', label: t('filter.all') },
          ]}
        />
        <MultiSelect
          label={t('filter.contact')}
          options={[...data.contacts].sort(byName(locale)).map((c) => ({ value: c.id, label: c.name }))}
          value={contacts}
          onChange={setContacts}
        />
        <MultiSelect
          label={t('filter.asset')}
          options={data.assets.map((a) => ({ value: a.id, label: a.code, hint: a.name, icon: <AssetIcon asset={a} size={18} /> }))}
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
        icon={<AssetIcon asset={asset} size={34} />}
        subtitle={
          <span className="badges">
            {debtor && (
              <a href={href.detail('contacts', debtor.id)}>
                <Avatar image={debtor.image} name={debtor.name} size={20} /> {debtor.name}
              </a>
            )}
            <span className="muted">{t('debts.owesTo')}</span>
            {creditor && (
              <a href={href.detail('contacts', creditor.id)}>
                <Avatar image={creditor.image} name={creditor.name} size={20} /> {creditor.name}
              </a>
            )}
            {s.remaining === 0 && <span className="badge">{t('debts.closed')}</span>}
          </span>
        }
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
      <div className="stats-row">
        <Stat label={t('debts.remaining')} hint={s.remaining < 0 ? t('debts.overpaid') : undefined}>
          <Money value={Math.abs(s.remaining)} asset={asset} />
        </Stat>
        <Stat label={t('debts.initial')}>
          <Money value={debt.amount} asset={asset} />
        </Stat>
        <Stat label={t('debts.added')} icon="arrowOut">
          <Money value={s.added} asset={asset} />
        </Stat>
        <Stat label={t('debts.repaid')} icon="arrowIn">
          <Money value={s.repaid} asset={asset} />
        </Stat>
      </div>
      {debt.description && <p className="muted pre detail-desc">{debt.description}</p>}
      <p className="field-hint">
        {t('common.createdAt', { d: i18n.dateTime(debt.createdAt) })} · {t('common.updatedAt', { d: i18n.dateTime(debt.updatedAt) })}
      </p>
      <section className="section">
        <div className="section-head">
          <h2>
            {t('debts.history')} <span className="count">{s.txs.length}</span>
          </h2>
        </div>
        <TxList txs={s.txs} side={side} prefKey="debtTx" empty={t('debts.noHistory')} />
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
  const { t, locale } = useI18n();
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
  const contacts = [...data.contacts].sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || byName<typeof a>(locale)(a, b));
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
        <div className="form-grid form-grid-swap">
          <Field label={t('debts.debtor')} error={err('parties')}>
            <select className="select" value={debtorId} onChange={(e) => setDebtorId(e.target.value)} disabled={locked}>
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {!locked && (
            <button type="button" className="icon-btn swap-btn" onClick={swap} aria-label={t('debts.swap')} title={t('debts.swap')}>
              <Icon name="swap" size={18} />
            </button>
          )}
          <Field label={t('debts.creditor')}>
            <select className="select" value={creditorId} onChange={(e) => setCreditorId(e.target.value)} disabled={locked}>
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field label={t('debts.asset')} error={err('asset')}>
            <select className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)} disabled={locked}>
              {data.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('debts.initial')} error={err('amount')} hint={locked ? t('debts.amountLocked') : t('debts.amountHint')}>
            <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={locked} placeholder="0" />
          </Field>
        </div>
        <DescriptionField value={description} onChange={setDescription} error={err('description')} />
      </form>
    </Modal>
  );
}
