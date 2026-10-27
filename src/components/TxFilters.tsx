import { useMemo, useState } from 'react';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { NONE, activeFilters, emptyFilter, type TxFilter } from '../lib/analytics';
import { categoryTree, servicesInOrder } from '../lib/ops';
import { byName } from '../lib/search';
import { sortAccountsForPicker, type Index } from '../lib/stats';
import { FORMS } from '../lib/types';
import { useStore } from '../store/store';
import { AssetIcon, Avatar, Field, MultiSelect, SearchField, type Option } from './bits';
import { PeriodPicker } from './PeriodPicker';

/** Option lists for the filter dropdowns, shared by the transactions page and analytics. */
export function useFilterOptions(ix: Index) {
  const { t, locale } = useI18n();
  const data = useStore((s) => s.data);
  return useMemo(() => {
    const contactName = (id: string) => (id ? (ix.contacts.get(id)?.name ?? '') : t('tx.noContact'));
    const accounts: Option[] = sortAccountsForPicker(ix, data.accounts, locale).map((a) => ({
      value: a.id,
      label: a.name,
      hint: a.assetIds.map((x) => ix.assets.get(x)?.code).join(', '),
      group: a.contactId === ix.self?.id ? t('tx.myAccounts') : contactName(a.contactId),
    }));
    const contacts: Option[] = [...data.contacts]
      .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || byName<typeof a>(locale)(a, b))
      .map((c) => ({ value: c.id, label: c.name, icon: <Avatar image={c.image} name={c.name} size={18} /> }));
    const categories: Option[] = [
      ...categoryTree(data.categories).flatMap(({ root, children }) => [
        { value: root.id, label: root.name },
        ...children.map((c) => ({ value: c.id, label: c.name, depth: 1 })),
      ]),
      { value: NONE, label: t('tx.noCategory') },
    ];
    return {
      accounts,
      accountsWithNone: [...accounts, { value: NONE, label: t('tx.external') }],
      contacts,
      contactsWithNone: [...contacts, { value: NONE, label: t('tx.unknownParty') }],
      categories,
      assets: data.assets.map((a) => ({ value: a.id, label: a.code, hint: a.name, icon: <AssetIcon asset={a} size={18} /> })),
      services: servicesInOrder(data.services).map((s) => ({ value: s.id, label: s.name, icon: <Avatar image={s.image} name={s.name} size={18} /> })),
      forms: FORMS.map((f) => ({ value: f, label: t(`form.${f}`) })),
      debts: [...data.debts.map((d) => ({ value: d.id, label: d.name })), { value: NONE, label: t('tx.debtNone') }],
    };
  }, [ix, data, locale, t]);
}

export function TxFilters({ ix, value, onChange, showPeriod = true }: { ix: Index; value: TxFilter; onChange: (f: TxFilter) => void; showPeriod?: boolean }) {
  const { t } = useI18n();
  const o = useFilterOptions(ix);
  const n = activeFilters(value);
  const [more, setMore] = useState(n > 0);
  const set = <K extends keyof TxFilter>(k: K) => (v: TxFilter[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="filters">
      <div className="toolbar">
        <SearchField value={value.q} onChange={set('q')} placeholder={t('tx.search')} />
        {showPeriod && <PeriodPicker value={value.period} onChange={set('period')} />}
        <button type="button" className={`btn ${more ? 'btn-active' : ''}`} onClick={() => setMore(!more)} aria-expanded={more}>
          <Icon name="filter" size={18} />
          {t('filter.more')}
          {n > 0 && <span className="badge badge-accent">{n}</span>}
        </button>
        {n > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => onChange({ ...emptyFilter(), q: value.q, period: value.period })}>
            {t('filter.reset')}
          </button>
        )}
      </div>
      {more && (
        <div className="filter-panel">
          <MultiSelect label={t('filter.fromContact')} options={o.contactsWithNone} value={value.fromContacts} onChange={set('fromContacts')} />
          <MultiSelect label={t('filter.toContact')} options={o.contactsWithNone} value={value.toContacts} onChange={set('toContacts')} />
          <MultiSelect label={t('filter.anyContact')} options={o.contacts} value={value.contacts} onChange={set('contacts')} />
          <MultiSelect label={t('filter.fromAccount')} options={o.accountsWithNone} value={value.fromAccounts} onChange={set('fromAccounts')} />
          <MultiSelect label={t('filter.toAccount')} options={o.accountsWithNone} value={value.toAccounts} onChange={set('toAccounts')} />
          <MultiSelect label={t('filter.anyAccount')} options={o.accounts} value={value.accounts} onChange={set('accounts')} />
          <MultiSelect label={t('filter.form')} options={o.forms} value={value.forms} onChange={set('forms')} />
          <MultiSelect label={t('filter.asset')} options={o.assets} value={value.assets} onChange={set('assets')} />
          <MultiSelect label={t('filter.category')} options={o.categories} value={value.categories} onChange={set('categories')} />
          <MultiSelect label={t('filter.service')} options={o.services} value={value.services} onChange={set('services')} />
          <MultiSelect label={t('filter.debt')} options={o.debts} value={value.debts} onChange={set('debts')} />
          <Field label={t('filter.direction')}>
            <select className="select" value={value.direction} onChange={(e) => set('direction')(e.target.value as TxFilter['direction'])}>
              <option value="all">{t('dir.all')}</option>
              <option value="in">{t('dir.inMine')}</option>
              <option value="out">{t('dir.outMine')}</option>
              <option value="internal">{t('dir.internalMine')}</option>
              <option value="foreign">{t('dir.foreign')}</option>
            </select>
          </Field>
          <Field label={t('filter.amount')} group>
            <span className="range-input">
              <input type="text" inputMode="decimal" value={value.minAmount} onChange={(e) => set('minAmount')(e.target.value)} placeholder={t('filter.min')} />
              <span>–</span>
              <input type="text" inputMode="decimal" value={value.maxAmount} onChange={(e) => set('maxAmount')(e.target.value)} placeholder={t('filter.max')} />
            </span>
          </Field>
          <label className="check filter-check">
            <input type="checkbox" checked={value.withFee} onChange={(e) => set('withFee')(e.target.checked)} />
            <span>{t('filter.withFee')}</span>
          </label>
        </div>
      )}
    </div>
  );
}
