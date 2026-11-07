import { useMemo, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { amountInput, money, parseAmount, toLocalInput } from '../lib/format';
import { categoryTree, deleteTemplate, saveTemplate, saveTransaction } from '../lib/ops';
import { debtEffect, getIndex, sortAccountsForPicker, type Index } from '../lib/stats';
import { LIMITS, type Account, type Asset, type Category, type Debt, type Template, type Transaction } from '../lib/types';
import { mutate, useStore } from '../store/store';
import { closeTemplateForm, closeTxForm, showToast, useUi } from '../store/ui';
import { AccountIcon, AssetIcon, AutoTextarea, Avatar, ContactChip, Field, InfoTip, Money, Picker, type Option } from './bits';
import { DateTimeField } from './DateTimeField';
import { NameField, useTextRules } from './forms';
import { Icon } from '../icons/ui';
import { ConfirmDialog, Modal } from './Modal';
import { DeleteTx } from './TxList';

/**
 * The asset at the end of an amount field: a small picker with the assets' pictures when there is
 * a choice (crypto accounts), otherwise just the one asset's picture and code.
 */
function AssetChoice({ assets, value, onChange, label, disabled = false }: { assets: Asset[]; value: Asset | undefined; onChange: (id: string) => void; label: string; disabled?: boolean }) {
  if (assets.length < 2) {
    return (
      <span className="amount-asset" aria-label={label}>
        {value ? (
          <>
            <AssetIcon asset={value} size={18} />
            {value.code}
          </>
        ) : (
          '—'
        )}
      </span>
    );
  }
  return (
    <span className="amount-asset-pick">
      <Picker
        value={value?.id ?? ''}
        onChange={onChange}
        options={assets.map((a) => ({ value: a.id, label: a.code, icon: <AssetIcon asset={a} size={18} /> }))}
        ariaLabel={label}
        disabled={disabled}
        searchable={false}
        popWidth={150}
      />
    </span>
  );
}

/** Renders the global transaction editor when it is open. */
export function TxFormHost() {
  const form = useUi((s) => s.txForm);
  const data = useStore((s) => s.data);
  if (!form) return null;
  const tx = form.id ? getIndex(data).transactions.get(form.id) : undefined;
  if (form.id && !tx) return null;
  return <TxForm key={form.id ?? 'new'} tx={tx} prefill={form.prefill} templateId={form.templateId} />;
}

/** Renders the global template editor when it is open. */
export function TemplateFormHost() {
  const form = useUi((s) => s.templateForm);
  const data = useStore((s) => s.data);
  if (!form) return null;
  const template = form.id ? getIndex(data).templates.get(form.id) : undefined;
  if (form.id && !template) return null;
  return <TxForm key={form.id ?? 'new'} template={template} prefill={form.prefill} asTemplate />;
}

/** The fields of a transaction or a template the editor starts from (a template's amount may be unset). */
type Draft = Partial<Omit<Transaction, 'amount'> & Omit<Template, 'amount'>> & { amount?: number | null };

const compatible = (a: Account, b: Account) => a.form === b.form && a.assetIds.some((x) => b.assetIds.includes(x));

/**
 * One side of the transaction: the accounts grouped by their contact (the contact's picture in
 * the group's heading), each with its own picture; the chosen one shows its contact too.
 */
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
  const options = useMemo(() => {
    // the other side narrows the choice to accounts of the same form sharing an asset
    const list = sortAccountsForPicker(
      ix,
      all.filter((a) => a.id !== other?.id && (!other || compatible(a, other)) && (!onlyAsset || a.assetIds.includes(onlyAsset))),
      locale,
    );
    const out: Option[] = [{ value: '', label: t('common.absent') }];
    for (const a of list) {
      const contact = a.contactId ? ix.contacts.get(a.contactId) : undefined;
      const icon = <AccountIcon account={a} service={a.serviceId ? ix.services.get(a.serviceId) : undefined} size={20} />;
      out.push({
        value: a.id,
        label: a.name,
        icon,
        hint: a.assetIds.map((x) => ix.assets.get(x)?.code).join(', '),
        // under its contact's heading, like sub-categories under their parent
        depth: 1,
        group: a.contactId === ix.self?.id ? t('tx.myAccounts') : (contact?.name ?? t('tx.noContact')),
        groupIcon: contact && <Avatar image={contact.image} name={contact.name} size={18} />,
        chosen: (
          <>
            {icon}
            <span className="ellipsis">{a.name}</span>
            {contact && (
              <span className="picker-contact">
                <Avatar image={contact.image} name={contact.name} size={16} />
                <span className="ellipsis">{contact.name}</span>
              </span>
            )}
          </>
        ),
      });
    }
    return out;
  }, [ix, all, other, onlyAsset, locale, t]);

  return (
    <Field label={label} error={error} group>
      <Picker value={value} onChange={onChange} options={options} placeholder={t('common.absent')} ariaLabel={label} searchable />
    </Field>
  );
}

/**
 * The transaction editor, also used for templates: a template is a transaction without a date,
 * with a name, where everything may be left empty and is filled in when a transaction is made of it.
 */
function TxForm({
  tx,
  template,
  prefill,
  templateId: fromTemplate,
  asTemplate = false,
}: {
  tx?: Transaction;
  template?: Template;
  prefill?: Draft;
  /** the template the prefill came from */
  templateId?: string;
  asTemplate?: boolean;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const rules = useTextRules();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const init: Draft = { ...prefill, ...tx, ...template };
  const editing = asTemplate ? template : tx;
  const close = asTemplate ? closeTemplateForm : closeTxForm;

  const [name, setName] = useState(init.name ?? '');
  const [date, setDate] = useState(toLocalInput(init.date ?? new Date()));
  const [fromId, setFromId] = useState(init.fromId ?? '');
  const [toId, setToId] = useState(init.toId ?? '');
  const [assetId, setAssetId] = useState(init.assetId ?? '');
  const [amount, setAmount] = useState(amountInput(init.amount));
  const [fee, setFee] = useState(amountInput(init.fee));
  const [feeAssetId, setFeeAssetId] = useState(init.feeAssetId ?? '');
  const [categoryId, setCategoryId] = useState(init.categoryId ?? '');
  const [description, setDescription] = useState(init.description ?? '');
  // a payment of an existing debt (off by default; new debts are made on the debts page)
  const [payDebt, setPayDebt] = useState(!!init.debtId);
  const [debtId, setDebtId] = useState(init.debtId ?? '');
  const [tried, setTried] = useState(false);
  const [del, setDel] = useState(false);

  const from = ix.accounts.get(fromId);
  const to = ix.accounts.get(toId);
  const form = from?.form ?? to?.form;

  // linked to a debt: the money moves in the debt's asset
  const debtAsset = payDebt ? ix.debts.get(debtId)?.assetId : undefined;

  // assets both sides can hold
  const assetOptions = useMemo(() => {
    const ids = from && to ? from.assetIds.filter((x) => to.assetIds.includes(x)) : (from ?? to)?.assetIds ?? [];
    return ids.filter((x) => !debtAsset || x === debtAsset).map((x) => ix.assets.get(x)!).filter(Boolean);
  }, [from, to, ix, debtAsset]);
  const asset = assetOptions.find((a) => a.id === assetId) ?? assetOptions[0];
  const feeOptions = form === 'crypto' && from ? from.assetIds.map((x) => ix.assets.get(x)!).filter(Boolean) : asset ? [asset] : [];
  // its own choice: a transfer of USDT may well pay its fee in TRX, so it never follows the amount's asset
  const feeAsset = feeOptions.find((a) => a.id === feeAssetId) ?? feeOptions[0];

  const contactOf = (a: Account | undefined) => (a?.contactId ? a.contactId : '');
  const fromC = contactOf(from);
  const toC = contactOf(to);
  const sides = { fromId, toId, assetId: asset?.id ?? '' };

  // only the debts between exactly the two contacts behind the chosen accounts, either way round,
  // in an asset both accounts hold: with a side left empty (or without a contact) none fits
  const amountN = parseAmount(amount);
  const debtOptions = useMemo((): Option[] => {
    const between = (d: Debt) => {
      const sides = [d.debtorId, d.creditorId];
      return !!fromC && !!toC && fromC !== toC && sides.includes(fromC) && sides.includes(toC);
    };
    const holds = (x: string) => (!from || from.assetIds.includes(x)) && (!to || to.assetIds.includes(x));
    return data.debts
      .filter((d) => d.id === init.debtId || (between(d) && holds(d.assetId)))
      .map((d) => {
        const debtAssetOf = ix.assets.get(d.assetId);
        const debtor = ix.contacts.get(d.debtorId);
        const creditor = ix.contacts.get(d.creditorId);
        // like a debt card: who owes whom how much, and what this transaction would add to it or take off
        const effect = debtEffect(d, { fromId, toId, assetId: d.assetId }, ix.accounts);
        const parts = (
          <span className="debt-parties">
            <ContactChip contact={debtor} />
            <span>{t('debts.owesTo')}</span>
            <span className="amount-chip">
              <AssetIcon asset={debtAssetOf} size={16} />
              <Money value={ix.debt.get(d.id)?.remaining ?? 0} asset={debtAssetOf} />
              {effect !== 0 && amountN !== null && amountN > 0 && (
                <span className="debt-delta">({money(i18n, effect * amountN, debtAssetOf, { sign: true })})</span>
              )}
            </span>
            <ContactChip contact={creditor} />
          </span>
        );
        return {
          value: d.id,
          label: d.name,
          hint: `${debtor?.name ?? ''} ${creditor?.name ?? ''}`,
          render: (
            <span className="debt-option">
              <span className="debt-option-name">{d.name}</span>
              {parts}
            </span>
          ),
          chosen: (
            <span className="debt-option debt-option-chosen">
              <span className="debt-option-name">{d.name}</span>
              {parts}
            </span>
          ),
        };
      });
  }, [data.debts, fromC, toC, from, to, fromId, toId, ix, i18n, t, init.debtId, amountN]);

  // the tree, sub-categories indented; the chosen one shows its parent too
  const categoryOptions = useMemo((): Option[] => {
    const option = (c: Category, parent?: Category): Option => {
      const icon = <Avatar image={c.image || parent?.image || ''} name={c.name} size={20} fallback="tag" />;
      return {
        value: c.id,
        label: c.name,
        icon,
        depth: parent ? 1 : 0,
        chosen: (
          <>
            {icon}
            <span className="ellipsis">{parent ? `${parent.name} / ${c.name}` : c.name}</span>
          </>
        ),
      };
    };
    return [
      { value: '', label: t('common.absent') },
      ...categoryTree(data.categories).flatMap(({ root, children }) => [option(root), ...children.map((c) => option(c, root))]),
    ];
  }, [data.categories, t]);

  const feeN = fee.trim() ? parseAmount(fee) : null;
  const linked = payDebt ? ix.debts.get(debtId) : undefined;

  // a template may leave the accounts and the amount for later
  const amountEmpty = asTemplate && !amount.trim();
  const errors = {
    name: asTemplate ? rules.required(name) : null,
    accounts: !asTemplate && !fromId && !toId ? t('tx.needAccount') : null,
    date: !asTemplate && Number.isNaN(Date.parse(date)) ? t('form.required') : null,
    asset: !asTemplate && !asset ? t('form.required') : null,
    amount: amountEmpty ? null : amountN === null ? t('form.badNumber') : amountN <= 0 ? t('tx.amountPositive') : null,
    fee: fee.trim() && (feeN === null || feeN < 0) ? t('form.badNumber') : null,
    debt: !payDebt ? null : !linked ? t('tx.chooseDebt') : debtEffect(linked, sides, ix.accounts) === 0 ? t('tx.debtMismatch') : null,
    description: rules.optional(description),
  };
  const invalid = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (tried ? errors[k] : null);

  // a new transaction can start from a template: everything but the date is taken from it
  const [templateId, setTemplateId] = useState(fromTemplate ?? '');
  const pickTemplate = !tx && !asTemplate && ix.templateList.length > 0;
  const templateOptions = useMemo((): Option[] => {
    if (!pickTemplate) return [];
    return [
      // nothing chosen: the button just says "Template"
      { value: '', label: t('common.absent'), chosen: <></> },
      ...ix.templateList.map((x) => {
        const category = ix.categories.get(x.categoryId);
        const parent = category?.parentId ? ix.categories.get(category.parentId) : undefined;
        const picture = category?.image || parent?.image || '';
        const asset = ix.assets.get(x.assetId);
        return {
          value: x.id,
          label: x.name,
          icon: picture ? <Avatar image={picture} name={category?.name ?? ''} size={20} /> : <Icon name="template" size={18} />,
          hint: x.amount !== null && asset ? money(i18n, x.amount, asset) : undefined,
        };
      }),
    ];
  }, [pickTemplate, ix, t, i18n]);
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const x = ix.templates.get(id);
    if (!x) return;
    setFromId(x.fromId);
    setToId(x.toId);
    setAssetId(x.assetId);
    setAmount(amountInput(x.amount));
    setFee(amountInput(x.fee));
    setFeeAssetId(x.feeAssetId);
    setCategoryId(x.categoryId);
    setPayDebt(!!x.debtId);
    setDebtId(x.debtId);
    setDescription(x.description);
  };

  const swap = () => {
    setFromId(toId);
    setToId(fromId);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    if (asTemplate) {
      const fields = {
        name: name.trim(),
        fromId,
        toId,
        assetId: asset?.id ?? '',
        amount: amountEmpty ? null : amountN,
        fee: fromId && feeN !== null && feeN > 0 ? feeN : null,
        feeAssetId: fromId && feeN ? (feeAsset?.id ?? asset?.id ?? '') : (asset?.id ?? ''),
        categoryId,
        debtId: payDebt ? debtId : '',
        description: description.trim(),
      };
      mutate((d) => saveTemplate(d, fields, template?.id).data);
      showToast(template ? t('templates.saved') : t('templates.created'));
      close();
      return;
    }
    if (!asset || amountN === null) return;
    mutate((d) =>
      saveTransaction(
        d,
        {
          date: new Date(date).toISOString(),
          fromId,
          toId,
          assetId: asset.id,
          amount: amountN,
          fee: fromId && feeN !== null && feeN > 0 ? feeN : null,
          feeAssetId: fromId && feeN ? (feeAsset?.id ?? asset.id) : asset.id,
          categoryId,
          debtId: payDebt ? debtId : '',
          description: description.trim(),
        },
        tx?.id,
      ).data,
    );
    showToast(tx ? t('tx.saved') : t('tx.created'));
    closeTxForm();
  };

  return (
    <Modal
      title={asTemplate ? (template ? t('templates.edit') : t('templates.new')) : tx ? t('tx.edit') : t('tx.new')}
      onClose={close}
      size="lg"
      focusField={asTemplate && !template}
      headExtra={
        pickTemplate && (
          <Picker label={t('tx.fromTemplate')} value={templateId} onChange={applyTemplate} options={templateOptions} placeholder="—" ariaLabel={t('tx.fromTemplate')} searchable popWidth={320} />
        )
      }
      footer={
        <>
          {editing && (
            <button type="button" className="btn btn-danger-ghost footer-left" onClick={() => setDel(true)}>
              {t('common.delete')}
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="tx-form" className="btn btn-primary">
            {editing ? t('common.save') : t('common.create')}
          </button>
        </>
      }
    >
      <form id="tx-form" className="form" onSubmit={submit} noValidate>
        {asTemplate && <NameField value={name} onChange={setName} error={err('name')} placeholder={t('templates.namePlaceholder')} autoFocus={false} />}
        {/* one grid for all three rows, so the fields below sit exactly under the two accounts */}
        <div className="form-grid form-grid-swap">
          <AccountSelect ix={ix} value={fromId} onChange={setFromId} other={to} onlyAsset={debtAsset} label={t('tx.from')} error={err('accounts')} />
          {/* an empty label row keeps the button level with the controls, whatever errors show under them */}
          <div className="field swap-field">
            <span className="field-label" aria-hidden="true">
              &nbsp;
            </span>
            <button type="button" className="icon-btn swap-btn" onClick={swap} aria-label={t('debts.swap')} title={t('debts.swap')}>
              <Icon name="swap" size={18} />
            </button>
          </div>
          <AccountSelect ix={ix} value={toId} onChange={setToId} other={from} onlyAsset={debtAsset} label={t('tx.to')} error={err('accounts')} />
          <Field label={t('tx.amount')} error={err('amount')} group>
            <span className="amount-input">
              <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={asTemplate ? t('templates.amountLater') : '0'} />
              <AssetChoice assets={assetOptions} value={asset} onChange={setAssetId} label={t('tx.asset')} />
            </span>
          </Field>
          <span className="swap-spacer" />
          <Field
            label={
              <span className="field-label-tip">
                {t('tx.fee')}
                <InfoTip label={`${t('tx.feeHint')} ${t('tx.feeNoSender')}`}>
                  <p>{t('tx.feeHint')}</p>
                  <p>{t('tx.feeNoSender')}</p>
                </InfoTip>
              </span>
            }
            error={err('fee')}
            group
          >
            <span className="amount-input">
              <input type="text" inputMode="decimal" value={fromId ? fee : ''} onChange={(e) => setFee(e.target.value)} placeholder="0" disabled={!fromId} aria-label={t('tx.fee')} />
              <AssetChoice assets={feeOptions} value={feeAsset} onChange={setFeeAssetId} label={t('tx.feeAsset')} disabled={!fromId} />
            </span>
          </Field>
          {/* a template has no date: the category takes the whole row */}
          <Field label={t('tx.category')} group className={asTemplate ? 'form-grid-full' : undefined}>
            <Picker value={categoryId} onChange={setCategoryId} options={categoryOptions} placeholder={t('common.absent')} ariaLabel={t('tx.category')} searchable />
          </Field>
          {!asTemplate && (
            <>
              <span className="swap-spacer" />
              <Field label={t('tx.date')} error={err('date')} group>
                <DateTimeField value={date} onChange={setDate} placeholder={t('tx.date')} ariaLabel={t('tx.date')} clearable={false} />
              </Field>
            </>
          )}
        </div>

        <Field label={t('common.description')} error={err('description')} counter={[description.length, LIMITS.description]}>
          <AutoTextarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t('common.optional')} />
        </Field>

        {/* the debt this transaction pays: one block at the end */}
        <div className="subform">
          <label className="check">
            <input type="checkbox" checked={payDebt} onChange={(e) => setPayDebt(e.target.checked)} />
            <span>{t('tx.debtLink')}</span>
          </label>
          {payDebt && (
            <Field label={t('tx.debtPick')} group error={err('debt')} hint={debtOptions.length ? undefined : t('tx.debtNoOptions')}>
              <Picker value={debtId} onChange={setDebtId} options={debtOptions} placeholder={t('common.absent')} ariaLabel={t('tx.debtPick')} />
            </Field>
          )}
        </div>
      </form>
      {del && tx && <DeleteTx tx={tx} onClose={() => setDel(false)} onDeleted={closeTxForm} />}
      {del && template && <DeleteTemplate template={template} onClose={() => setDel(false)} onDeleted={closeTemplateForm} />}
    </Modal>
  );
}

export function DeleteTemplate({ template, onClose, onDeleted }: { template: Template; onClose: () => void; onDeleted?: () => void }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      title={t('templates.deleteTitle', { name: template.name })}
      text={t('templates.deleteText')}
      onClose={onClose}
      onConfirm={() => {
        mutate((d) => deleteTemplate(d, template.id));
        showToast(t('templates.deleted'));
        onDeleted?.();
      }}
    />
  );
}
