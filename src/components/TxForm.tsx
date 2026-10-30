import { useMemo, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { amountInput, money, parseAmount, toLocalInput } from '../lib/format';
import { categoriesInOrder, saveDebt, saveTransaction } from '../lib/ops';
import { byName } from '../lib/search';
import { debtEffect, getIndex, sortAccountsForPicker, type Index } from '../lib/stats';
import { LIMITS, type Account, type Transaction } from '../lib/types';
import { mutate, useStore } from '../store/store';
import { closeTxForm, showToast, useUi } from '../store/ui';
import { AutoTextarea, Field, Segmented } from './bits';
import { useTextRules } from './forms';
import { Modal } from './Modal';
import { DeleteTx } from './TxList';

/** Renders the global transaction editor when it is open. */
export function TxFormHost() {
  const form = useUi((s) => s.txForm);
  const data = useStore((s) => s.data);
  if (!form) return null;
  const tx = form.id ? getIndex(data).transactions.get(form.id) : undefined;
  if (form.id && !tx) return null;
  return <TxForm key={form.id ?? 'new'} tx={tx} prefill={form.prefill} />;
}

const compatible = (a: Account, b: Account) => a.form === b.form && a.assetIds.some((x) => b.assetIds.includes(x));

function AccountSelect({
  ix,
  value,
  onChange,
  other,
  onlyAsset,
  label,
  error,
}: {
  ix: Index;
  value: string;
  onChange: (id: string) => void;
  other: Account | undefined;
  /** a payment of a debt: only accounts holding the debt's asset */
  onlyAsset?: string;
  label: string;
  error: string | null;
}) {
  const { t, locale } = useI18n();
  const all = useStore((s) => s.data.accounts);
  const groups = useMemo(() => {
    // the other side narrows the choice to accounts of the same form sharing an asset
    const list = sortAccountsForPicker(
      ix,
      all.filter((a) => a.id !== other?.id && (!other || compatible(a, other)) && (!onlyAsset || a.assetIds.includes(onlyAsset))),
      locale,
    );
    const out: { label: string; items: Account[] }[] = [];
    for (const a of list) {
      const name =
        a.contactId === ix.self?.id ? t('tx.myAccounts') : a.contactId ? (ix.contacts.get(a.contactId)?.name ?? '') : t('tx.noContact');
      if (out[out.length - 1]?.label !== name) out.push({ label: name, items: [] });
      out[out.length - 1].items.push(a);
    }
    return out;
  }, [ix, all, other, onlyAsset, locale, t]);

  return (
    <Field label={label} error={error}>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('tx.notSpecified')}</option>
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.assetIds.map((x) => ix.assets.get(x)?.code).join(', ')} · {t(`form.${a.form}`)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Field>
  );
}

type DebtMode = 'none' | 'link' | 'new';

function TxForm({ tx, prefill }: { tx?: Transaction; prefill?: Partial<Transaction> }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const rules = useTextRules();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const init = { ...prefill, ...tx };

  const [date, setDate] = useState(toLocalInput(init.date ?? new Date()));
  const [fromId, setFromId] = useState(init.fromId ?? '');
  const [toId, setToId] = useState(init.toId ?? '');
  const [assetId, setAssetId] = useState(init.assetId ?? '');
  const [amount, setAmount] = useState(amountInput(init.amount));
  const [fee, setFee] = useState(amountInput(init.fee));
  const [feeAssetId, setFeeAssetId] = useState(init.feeAssetId ?? '');
  const [categoryId, setCategoryId] = useState(init.categoryId ?? '');
  const [description, setDescription] = useState(init.description ?? '');
  const [debtMode, setDebtMode] = useState<DebtMode>(init.debtId ? 'link' : 'none');
  const [debtId, setDebtId] = useState(init.debtId ?? '');
  const [debtName, setDebtName] = useState('');
  const [debtorId, setDebtorId] = useState('');
  const [creditorId, setCreditorId] = useState('');
  const [tried, setTried] = useState(false);
  const [del, setDel] = useState(false);

  const from = ix.accounts.get(fromId);
  const to = ix.accounts.get(toId);
  const form = from?.form ?? to?.form;

  // linked to a debt: the money moves in the debt's asset
  const debtAsset = debtMode === 'link' ? ix.debts.get(debtId)?.assetId : undefined;

  // assets both sides can hold
  const assetOptions = useMemo(() => {
    const ids = from && to ? from.assetIds.filter((x) => to.assetIds.includes(x)) : (from ?? to)?.assetIds ?? [];
    return ids.filter((x) => !debtAsset || x === debtAsset).map((x) => ix.assets.get(x)!).filter(Boolean);
  }, [from, to, ix, debtAsset]);
  const asset = assetOptions.find((a) => a.id === assetId) ?? assetOptions[0];
  const feeOptions = form === 'crypto' && from ? from.assetIds.map((x) => ix.assets.get(x)!).filter(Boolean) : asset ? [asset] : [];
  const feeAsset = feeOptions.find((a) => a.id === feeAssetId) ?? asset;

  const contactOf = (a: Account | undefined) => (a?.contactId ? a.contactId : '');
  const fromC = contactOf(from);
  const toC = contactOf(to);
  const sides = { fromId, toId, assetId: asset?.id ?? '' };

  const debtOptions = useMemo(
    () =>
      data.debts
        .filter((d) => d.id === init.debtId || debtEffect(d, sides, ix.accounts) !== 0)
        .map((d) => ({ d, effect: debtEffect(d, sides, ix.accounts) })),
    [data.debts, fromId, toId, asset?.id, ix],
  );
  const contacts = useMemo(() => [...data.contacts].sort(byName(locale)), [data.contacts, locale]);
  const newDebtor = debtorId || toC;
  const newCreditor = creditorId || fromC;

  const categories = useMemo(() => categoriesInOrder(data.categories), [data.categories]);

  const amountN = parseAmount(amount);
  const feeN = fee.trim() ? parseAmount(fee) : null;
  const linked = debtMode === 'link' ? ix.debts.get(debtId) : undefined;
  const newDebtEffect =
    debtMode === 'new' && asset
      ? debtEffect(
          { id: '', name: '', description: '', amount: 0, assetId: asset.id, debtorId: newDebtor, creditorId: newCreditor, createdAt: '', updatedAt: '' },
          sides,
          ix.accounts,
        )
      : 0;

  const errors = {
    accounts: !fromId && !toId ? t('tx.needAccount') : null,
    date: Number.isNaN(Date.parse(date)) ? t('form.required') : null,
    asset: !asset ? t('form.required') : null,
    amount: amountN === null ? t('form.badNumber') : amountN <= 0 ? t('tx.amountPositive') : null,
    fee: fee.trim() && (feeN === null || feeN < 0) ? t('form.badNumber') : null,
    debt:
      debtMode === 'link'
        ? !linked
          ? t('tx.chooseDebt')
          : debtEffect(linked, sides, ix.accounts) === 0
            ? t('tx.debtMismatch')
            : null
        : debtMode === 'new'
          ? !newDebtor || !newCreditor || newDebtor === newCreditor
            ? t('tx.debtParties')
            : newDebtEffect !== 1
              ? t('tx.debtNewMismatch')
              : null
          : null,
    debtName: debtMode === 'new' ? rules.required(debtName) : null,
    description: rules.optional(description),
  };
  const invalid = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (tried ? errors[k] : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid || !asset || amountN === null) return;
    mutate((d) => {
      let next = d;
      let linkId = debtMode === 'link' ? debtId : '';
      if (debtMode === 'new') {
        const r = saveDebt(next, {
          name: debtName.trim(),
          description: '',
          assetId: asset.id,
          debtorId: newDebtor,
          creditorId: newCreditor,
          amount: 0, // the transaction itself creates the amount
        });
        next = r.data;
        linkId = r.entity.id;
      }
      return saveTransaction(
        next,
        {
          date: new Date(date).toISOString(),
          fromId,
          toId,
          assetId: asset.id,
          amount: amountN,
          fee: fromId && feeN !== null && feeN > 0 ? feeN : null,
          feeAssetId: fromId && feeN ? (feeAsset?.id ?? asset.id) : asset.id,
          categoryId,
          debtId: linkId,
          description: description.trim(),
        },
        tx?.id,
      ).data;
    });
    showToast(tx ? t('tx.saved') : t('tx.created'));
    closeTxForm();
  };

  return (
    <Modal
      title={tx ? t('tx.edit') : t('tx.new')}
      onClose={closeTxForm}
      size="lg"
      footer={
        <>
          {tx && (
            <button type="button" className="btn btn-danger-ghost footer-left" onClick={() => setDel(true)}>
              {t('common.delete')}
            </button>
          )}
          <button type="button" className="btn" onClick={closeTxForm}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="tx-form" className="btn btn-primary">
            {tx ? t('common.save') : t('common.create')}
          </button>
        </>
      }
    >
      <form id="tx-form" className="form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <AccountSelect ix={ix} value={fromId} onChange={setFromId} other={to} onlyAsset={debtAsset} label={t('tx.from')} error={err('accounts')} />
          <AccountSelect ix={ix} value={toId} onChange={setToId} other={from} onlyAsset={debtAsset} label={t('tx.to')} error={err('accounts')} />
        </div>
        {(from || to) && <p className="field-hint">{t('tx.oneSideHint', { form: t(`form.${form!}`) })}</p>}
        <div className="form-grid form-grid-3">
          <Field label={t('tx.amount')} error={err('amount')}>
            <span className="amount-input">
              <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
              {assetOptions.length > 1 ? (
                <select className="select" value={asset?.id ?? ''} onChange={(e) => setAssetId(e.target.value)} aria-label={t('tx.asset')}>
                  {assetOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="amount-asset">{asset?.code ?? '—'}</span>
              )}
            </span>
          </Field>
          <Field label={t('tx.fee')} error={err('fee')} hint={fromId ? t('tx.feeHint') : t('tx.feeNoSender')}>
            <span className="amount-input">
              <input type="text" inputMode="decimal" value={fromId ? fee : ''} onChange={(e) => setFee(e.target.value)} placeholder={t('common.optional')} disabled={!fromId} />
              {feeOptions.length > 1 ? (
                <select className="select" value={feeAsset?.id ?? ''} onChange={(e) => setFeeAssetId(e.target.value)} disabled={!fromId} aria-label={t('tx.feeAsset')}>
                  {feeOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="amount-asset">{feeAsset?.code ?? '—'}</span>
              )}
            </span>
          </Field>
          <Field label={t('tx.date')} error={err('date')}>
            <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t('tx.category')}>
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('tx.noCategory')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? `    ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('tx.debt')} group error={err('debt')}>
          <Segmented<DebtMode>
            value={debtMode}
            onChange={setDebtMode}
            options={[
              { value: 'none', label: t('tx.debtNone') },
              { value: 'link', label: t('tx.debtLink') },
              { value: 'new', label: t('tx.debtNew') },
            ]}
          />
        </Field>
        {debtMode === 'link' && (
          <Field label={t('tx.debtPick')} hint={debtOptions.length ? t('tx.debtPickHint') : t('tx.debtNoOptions')}>
            <select className="select" value={debtId} onChange={(e) => setDebtId(e.target.value)}>
              <option value="">—</option>
              {debtOptions.map(({ d, effect }) => {
                const s = ix.debt.get(d.id)!;
                return (
                  <option key={d.id} value={d.id}>
                    {d.name} · {ix.contacts.get(d.debtorId)?.name} → {ix.contacts.get(d.creditorId)?.name} ·{' '}
                    {money(i18n, s.remaining, ix.assets.get(d.assetId))}
                    {effect ? ` · ${effect < 0 ? t('tx.debtRepay') : t('tx.debtIncrease')}` : ''}
                  </option>
                );
              })}
            </select>
          </Field>
        )}
        {debtMode === 'new' && (
          <div className="subform">
            <p className="field-hint">{t('tx.debtNewHint')}</p>
            <Field label={t('tx.debtName')} error={err('debtName')} counter={[debtName.trim().length, LIMITS.name]}>
              <input type="text" value={debtName} onChange={(e) => setDebtName(e.target.value)} />
            </Field>
            <div className="form-grid">
              <Field label={t('debts.debtor')}>
                <select className="select" value={newDebtor} onChange={(e) => setDebtorId(e.target.value)}>
                  <option value="">—</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('debts.creditor')}>
                <select className="select" value={newCreditor} onChange={(e) => setCreditorId(e.target.value)}>
                  <option value="">—</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        )}

        <Field label={t('common.description')} error={err('description')} counter={[description.length, LIMITS.description]}>
          <AutoTextarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t('common.optional')} />
        </Field>
        {tx && (
          <p className="field-hint">
            {t('common.createdAt', { d: i18n.dateTime(tx.createdAt) })} · {t('common.updatedAt', { d: i18n.dateTime(tx.updatedAt) })}
          </p>
        )}
      </form>
      {del && tx && <DeleteTx tx={tx} onClose={() => setDel(false)} onDeleted={closeTxForm} />}
    </Modal>
  );
}
