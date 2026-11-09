import { useMemo } from 'react';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { NONE, emptyFilter, type TxFilter } from '../lib/analytics';
import { categoryTree, servicesInOrder } from '../lib/ops';
import { sortAccountsForPicker, type Index } from '../lib/stats';
import { FORMS } from '../lib/types';
import { useStore } from '../store/store';
import { AccountIcon, AssetIcon, Avatar, Field, MultiSelect, Picker, useContactOptions, type Option } from './bits';
import { DateTimeField } from './DateTimeField';

/** Option lists for the filter dropdowns, shared by the transactions page and analytics. */
export function useFilterOptions(ix: Index) {
  const { t, locale } = useI18n();
  const data = useStore((s) => s.data);
  const contacts = useContactOptions(data.contacts);
  return useMemo(() => {
    const contactName = (id: string) => (id ? (ix.contacts.get(id)?.name ?? '') : t('tx.noContact'));
    const accounts: Option[] = sortAccountsForPicker(ix, data.accounts, locale).map((a) => ({
      value: a.id,
      label: a.name,
      icon: <AccountIcon account={a} service={a.serviceId ? ix.services.get(a.serviceId) : undefined} size={18} />,
      hint: a.assetIds.map((x) => ix.assets.get(x)?.code).join(', '),
      group: a.contactId === ix.self?.id ? t('tx.myAccounts') : contactName(a.contactId),
    }));
    const categories: Option[] = [
      ...categoryTree(data.categories).flatMap(({ root, children }) => [
        { value: root.id, label: root.name, icon: <Avatar image={root.image} name={root.name} size={18} fallback="tag" /> },
        ...children.map((c) => ({ value: c.id, label: c.name, depth: 1, icon: <Avatar image={c.image} name={c.name} size={18} fallback="tag" /> })),
      ]),
      { value: NONE, label: t('tx.noCategory') },
    ];
    return {
      accounts,
      accountsWithNone: [...accounts, { value: NONE, label: t('tx.external') }],
      contacts,
      contactsWithNone: [...contacts, { value: NONE, label: t('tx.unknownParty') }],
      categories,
      assets: data.assets.map((a) => ({ value: a.id, label: a.code, icon: <AssetIcon asset={a} size={18} /> })),
      services: servicesInOrder(data.services).map((s) => ({ value: s.id, label: s.name, icon: <Avatar image={s.image} name={s.name} size={18} /> })),
      forms: FORMS.map((f) => ({ value: f, label: t(`form.${f}`) })),
      debts: [...data.debts.map((d) => ({ value: d.id, label: d.name })), { value: NONE, label: t('tx.debtNone') }],
    };
  }, [ix, data, contacts, locale, t]);
}

/**
 * The grouped filter panel of the transactions and templates pages: sender, recipient,
 * parameters, funds, amount and (transactions only) the date-time range.
 */
export function TxFilterGroups({
  ix,
  f,
  onChange,
  dates = true,
}: {
  ix: Index;
  f: TxFilter;
  onChange: (update: (prev: TxFilter) => TxFilter) => void;
  dates?: boolean;
}) {
  const { t } = useI18n();
  const opts = useFilterOptions(ix);
  const set = <K extends keyof TxFilter>(k: K) => (v: TxFilter[K]) => onChange((prev) => ({ ...emptyFilter(), ...prev, [k]: v }));

  // the chosen contacts narrow the account choice of the same side to their accounts
  // (no contact = accounts without one, and "external")
  const fits = (accountId: string, contacts: string[]) =>
    !contacts.length || contacts.includes(accountId === NONE ? NONE : ix.accounts.get(accountId)?.contactId || NONE);
  const narrowed = (contacts: string[]) => opts.accountsWithNone.filter((o) => fits(o.value, contacts));
  const setContacts = (side: 'from' | 'to') => (contacts: string[]) =>
    onChange((prev) => {
      const p = { ...emptyFilter(), ...prev };
      if (side === 'from') return { ...p, fromContacts: contacts, fromAccounts: p.fromAccounts.filter((a) => fits(a, contacts)) };
      return { ...p, toContacts: contacts, toAccounts: p.toAccounts.filter((a) => fits(a, contacts)) };
    });

  return (
    <div className="filter-panel filter-groups">
      <div className="field" role="group">
        <span className="field-label">{t('filter.sender')}</span>
        <div className="filter-group-row">
          <MultiSelect label={t('filter.contact')} options={opts.contactsWithNone} value={f.fromContacts} onChange={setContacts('from')} />
          <MultiSelect label={t('filter.account')} options={narrowed(f.fromContacts)} value={f.fromAccounts} onChange={set('fromAccounts')} />
        </div>
      </div>
      <div className="field" role="group">
        <span className="field-label">{t('filter.recipient')}</span>
        <div className="filter-group-row">
          <MultiSelect label={t('filter.contact')} options={opts.contactsWithNone} value={f.toContacts} onChange={setContacts('to')} />
          <MultiSelect label={t('filter.account')} options={narrowed(f.toContacts)} value={f.toAccounts} onChange={set('toAccounts')} />
        </div>
      </div>
      <div className="field" role="group">
        <span className="field-label">{t('filter.params')}</span>
        <div className="filter-group-row">
          <Picker
            label={t('filter.direction')}
            value={f.direction}
            onChange={(v) => set('direction')(v as TxFilter['direction'])}
            options={[
              { value: 'all', label: t('dir.all'), icon: <Icon name="swap" size={16} className="flow-any" /> },
              { value: 'in', label: t('dir.inMine'), icon: <Icon name="arrowIn" size={16} className="flow-in" /> },
              { value: 'out', label: t('dir.outMine'), icon: <Icon name="arrowOut" size={16} className="flow-out" /> },
              { value: 'internal', label: t('dir.internalMine'), icon: <Icon name="refresh" size={16} className="flow-any" /> },
              { value: 'foreign', label: t('dir.foreign'), icon: <Icon name="users" size={16} className="flow-any" /> },
            ]}
          />
          <MultiSelect label={t('filter.category')} options={opts.categories} value={f.categories} onChange={set('categories')} />
          <MultiSelect label={t('filter.service')} options={opts.services} value={f.services} onChange={set('services')} />
          <MultiSelect label={t('filter.debt')} options={opts.debts} value={f.debts} onChange={set('debts')} />
        </div>
      </div>
      <div className="field" role="group">
        <span className="field-label">{t('filter.funds')}</span>
        <div className="filter-group-row">
          <MultiSelect label={t('filter.asset')} options={opts.assets} value={f.assets} onChange={set('assets')} />
          <MultiSelect label={t('filter.form')} options={opts.forms} value={f.forms} onChange={set('forms')} />
        </div>
      </div>
      <Field label={t('filter.amount')} group>
        <span className="range-input">
          <input type="text" inputMode="decimal" value={f.minAmount} onChange={(e) => set('minAmount')(e.target.value)} placeholder={t('filter.min')} aria-label={`${t('filter.amount')}, ${t('filter.min')}`} />
          <span>–</span>
          <input type="text" inputMode="decimal" value={f.maxAmount} onChange={(e) => set('maxAmount')(e.target.value)} placeholder={t('filter.max')} aria-label={`${t('filter.amount')}, ${t('filter.max')}`} />
        </span>
      </Field>
      {dates && (
        <Field label={t('filter.dateTime')} group>
          <span className="range-input range-input-dates">
            <DateTimeField value={f.from} onChange={set('from')} placeholder={t('filter.min')} defaultTime="00:00" ariaLabel={`${t('filter.dateTime')}, ${t('filter.min')}`} />
            <span>–</span>
            <DateTimeField value={f.to} onChange={set('to')} placeholder={t('filter.max')} defaultTime="23:59" ariaLabel={`${t('filter.dateTime')}, ${t('filter.max')}`} />
          </span>
        </Field>
      )}
    </div>
  );
}
