import { useMemo, useState, type FormEvent } from 'react';
import { ActivityCalendar } from '../components/ActivityCalendar';
import { AssetAmounts, AssetIcon, Avatar, CardMenu, EmptyState, Field, FormBadge, Highlight, MultiSelect, Pagination, SearchField, Segmented, Stat, usePaged } from '../components/bits';
import { DescriptionField, FormFooter, NameField, useTextRules } from '../components/forms';
import { PageHead } from '../components/Layout';
import { ConfirmDialog, Modal } from '../components/Modal';
import { TxList } from '../components/TxList';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { parseAmount } from '../lib/format';
import { deleteAccount, saveAccount } from '../lib/ops';
import { byName, matchesAny } from '../lib/search';
import { getIndex, sortAccountsForPicker } from '../lib/stats';
import { FORMS, LIMITS, type Account, type FormId } from '../lib/types';
import { href } from '../router';
import { mutate, useStore } from '../store/store';
import { openTxForm } from '../store/ui';
import { NotFound } from './common';

const NO_CONTACT = '__none__';

export function AccountsPage({ query }: { query?: URLSearchParams }) {
  const { t, tn, locale } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<string[]>(query?.get('contact') ? [query.get('contact')!] : []);
  const [assets, setAssets] = useState<string[]>([]);
  const [forms, setForms] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const [del, setDel] = useState<Account | null>(null);

  const list = useMemo(
    () =>
      sortAccountsForPicker(
        ix,
        data.accounts.filter(
          (a) =>
            matchesAny(q, a.name, a.requisite) &&
            (!contacts.length || contacts.includes(a.contactId || NO_CONTACT)) &&
            (!assets.length || a.assetIds.some((x) => assets.includes(x))) &&
            (!forms.length || forms.includes(a.form)) &&
            (!services.length || services.includes(a.serviceId)),
        ),
        locale,
      ),
    [data.accounts, ix, q, contacts, assets, forms, services, locale],
  );
  const paged = usePaged(list, 'accounts', `${q}|${contacts}|${assets}|${forms}|${services}`);
  const filtered = !!(q || contacts.length || assets.length || forms.length || services.length);

  return (
    <>
      <PageHead
        title={t('nav.accounts')}
        icon={<Icon name="wallet" />}
        subtitle={t('accounts.subtitle')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={18} />
            {t('accounts.add')}
          </button>
        }
      />
      <div className="toolbar">
        <SearchField value={q} onChange={setQ} placeholder={t('accounts.search')} />
        <MultiSelect
          label={t('filter.contact')}
          options={[
            ...[...data.contacts]
              .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || byName<typeof a>(locale)(a, b))
              .map((c) => ({ value: c.id, label: c.name })),
            { value: NO_CONTACT, label: t('tx.noContact') },
          ]}
          value={contacts}
          onChange={setContacts}
        />
        <MultiSelect
          label={t('filter.asset')}
          options={data.assets.map((a) => ({ value: a.id, label: a.code, hint: a.name, icon: <AssetIcon asset={a} size={18} /> }))}
          value={assets}
          onChange={setAssets}
        />
        <MultiSelect label={t('filter.form')} options={FORMS.map((f) => ({ value: f, label: t(`form.${f}`) }))} value={forms} onChange={setForms} />
        <MultiSelect
          label={t('filter.service')}
          options={[...data.services].sort(byName(locale)).map((s) => ({ value: s.id, label: s.name, icon: <Avatar image={s.image} name={s.name} size={18} /> }))}
          value={services}
          onChange={setServices}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState icon="wallet" text={filtered ? t('common.nothingFound') : t('accounts.empty')} />
      ) : (
        <div className="rows">
          {paged.items.map((a) => (
            <AccountRow key={a.id} a={a} q={q} onEdit={() => setEdit(a)} onDelete={() => setDel(a)} />
          ))}
        </div>
      )}
      <Pagination p={paged} />
      <p className="list-total muted">{tn('counts.accounts', list.length)}</p>
      {edit && <AccountEditor account={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {del && <DeleteAccount account={del} onClose={() => setDel(null)} />}
    </>
  );
}

export function AccountRow({ a, q = '', onEdit, onDelete }: { a: Account; q?: string; onEdit?: () => void; onDelete?: () => void }) {
  const { t, tn } = useI18n();
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
          {contact && (
            <span className={contact.isSelf ? 'own-tag' : ''}>
              <Icon name="user" size={13} /> {contact.name}
            </span>
          )}
          {service && <span className="muted">{service.name}</span>}
          {a.requisite && (
            <span className="requisite">
              <Highlight text={a.requisite} query={q} />
            </span>
          )}
          <span className="muted">{tn('counts.transactions', s.flow.tx)}</span>
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
  const [q, setQ] = useState('');
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all');
  const side = useMemo(() => new Set([id]), [id]);
  const s = ix.account.get(id);

  const txs = useMemo(() => {
    if (!s) return [];
    return s.txs.filter((x) => {
      if (dir === 'in' && x.toId !== id) return false;
      if (dir === 'out' && x.fromId !== id) return false;
      if (!q) return true;
      const other = ix.accounts.get(x.fromId === id ? x.toId : x.fromId);
      const cat = ix.categories.get(x.categoryId);
      return matchesAny(q, x.description, other?.name, other?.contactId ? ix.contacts.get(other.contactId)?.name : '', cat?.name);
    });
  }, [s, dir, q, ix, id]);

  if (!account || !s) return <NotFound />;
  const contact = account.contactId ? ix.contacts.get(account.contactId) : undefined;
  const service = account.serviceId ? ix.services.get(account.serviceId) : undefined;
  const assets = account.assetIds.map((x) => ix.assets.get(x)!).filter(Boolean);

  return (
    <>
      <PageHead
        crumbs={[{ label: t('nav.accounts'), href: href.list('accounts') }]}
        title={account.name}
        icon={service ? <Avatar image={service.image} name={service.name} size={34} /> : <Avatar name={account.name} size={34} />}
        subtitle={
          <span className="badges">
            <FormBadge form={account.form} />
            {contact && (
              <a href={href.detail('contacts', contact.id)} className={contact.isSelf ? 'own-tag' : ''}>
                <Icon name="user" size={14} /> {contact.name}
              </a>
            )}
            {service && <a href={href.detail('services', service.id)}>{service.name}</a>}
            {account.requisite && <span className="requisite">{account.requisite}</span>}
          </span>
        }
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
      <div className="stats-row">
        <Stat label={t('accounts.balance')} icon="wallet">
          <AssetAmounts map={s.balances} assets={assets} keepZero />
        </Stat>
        <Stat label={t('stats.transactions')} hint={t('stats.inOutCount', { in: num(s.flow.txIn), out: num(s.flow.txOut) })}>
          {num(s.flow.tx)}
        </Stat>
        <Stat label={t('stats.received')} icon="arrowIn">
          <AssetAmounts map={s.flow.in} assets={assets} />
        </Stat>
        <Stat label={t('stats.sent')} icon="arrowOut">
          <AssetAmounts map={s.flow.out} assets={assets} />
        </Stat>
        <Stat label={t('stats.fees')} icon="fee">
          <AssetAmounts map={s.flow.fees} assets={data.assets} />
        </Stat>
      </div>
      <div className="detail-grid">
        <section className="panel">
          <h2>{t('common.details')}</h2>
          <dl className="kv">
            <dt>{t('accounts.assets')}</dt>
            <dd className="badges">
              {assets.map((a) => (
                <a key={a.id} href={href.detail('assets', a.id)} className="chip">
                  <AssetIcon asset={a} size={14} /> {a.code}
                </a>
              ))}
            </dd>
            <dt>{t('accounts.initial')}</dt>
            <dd>
              <AssetAmounts map={new Map(Object.entries(account.initialBalances))} assets={assets} keepZero />
            </dd>
            <dt>{t('common.description')}</dt>
            <dd className="pre">{account.description || <span className="muted">—</span>}</dd>
            <dt>{t('common.created')}</dt>
            <dd>{i18n.dateTime(account.createdAt)}</dd>
            <dt>{t('common.updated')}</dt>
            <dd>{i18n.dateTime(account.updatedAt)}</dd>
          </dl>
        </section>
        <section className="panel panel-wide">
          <h2>{t('stats.activity')}</h2>
          <ActivityCalendar txs={s.txs} />
        </section>
      </div>
      <section className="section">
        <div className="section-head">
          <h2>
            {t('nav.transactions')} <span className="count">{s.txs.length}</span>
          </h2>
          <a className="btn btn-sm" href={href.transactions({ account: id })}>
            {t('common.openAll')}
          </a>
        </div>
        <div className="toolbar">
          <SearchField value={q} onChange={setQ} placeholder={t('tx.search')} />
          <Segmented
            value={dir}
            onChange={setDir}
            options={[
              { value: 'all', label: t('dir.all') },
              { value: 'in', label: t('dir.in') },
              { value: 'out', label: t('dir.out') },
            ]}
          />
        </div>
        <TxList txs={txs} side={side} q={q} prefKey="accountTx" resetKey={`${id}|${q}|${dir}`} />
      </section>
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
  const fixedAssets = new Set(account?.assetIds ?? []);
  const formAssets = data.assets.filter((a) => a.forms.includes(form) || fixedAssets.has(a.id)).sort(byName(locale));
  const services = data.services.filter((s) => s.forms.includes(form)).sort(byName(locale));
  // assets whose starting balance can still be set: all on creation, newly added ones for crypto
  const editableBalance = assetIds.filter((x) => !fixedAssets.has(x));

  const changeForm = (f: FormId) => {
    setForm(f);
    setAssetIds([]);
    setServiceId('');
  };
  const toggleAsset = (id: string) => {
    if (fixedAssets.has(id)) return;
    if (form !== 'crypto') setAssetIds([id]);
    else setAssetIds(assetIds.includes(id) ? assetIds.filter((x) => x !== id) : [...assetIds, id]);
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
          <Field label={t('accounts.contact')} hint={t('accounts.contactHint')}>
            <select className="select" value={contact} onChange={(e) => setContact(e.target.value)}>
              <option value="">{t('tx.noContact')}</option>
              {[...data.contacts]
                .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || byName<typeof a>(locale)(a, b))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isSelf ? ` (${t('contacts.me')})` : ''}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label={t('accounts.form')} group hint={isNew ? t('accounts.formHint') : t('accounts.formLocked')}>
          {isNew ? (
            <Segmented<FormId> value={form} onChange={changeForm} options={FORMS.map((f) => ({ value: f, label: t(`form.${f}`) }))} />
          ) : (
            <span>
              <FormBadge form={form} />
            </span>
          )}
        </Field>
        <Field
          label={form === 'crypto' ? t('accounts.assets') : t('accounts.asset')}
          group
          error={err('assets')}
          hint={isNew ? (form === 'crypto' ? t('accounts.assetsHintCrypto') : t('accounts.assetHint')) : form === 'crypto' ? t('accounts.assetsAddHint') : t('accounts.assetLocked')}
        >
          {formAssets.length === 0 ? (
            <p className="muted">{t('accounts.noFormAssets')}</p>
          ) : (
            <div className="check-row">
              {formAssets.map((a) => {
                const locked = fixedAssets.has(a.id) || (!isNew && form !== 'crypto');
                return (
                  <label key={a.id} className={`check-chip ${assetIds.includes(a.id) ? 'on' : ''} ${locked ? 'locked' : ''}`}>
                    <input
                      type={form === 'crypto' ? 'checkbox' : 'radio'}
                      name="asset"
                      checked={assetIds.includes(a.id)}
                      disabled={locked}
                      onChange={() => toggleAsset(a.id)}
                    />
                    <AssetIcon asset={a} size={16} />
                    {a.code}
                  </label>
                );
              })}
            </div>
          )}
        </Field>
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
            <Field label={t('accounts.requisite')} error={err('requisite')} hint={form === 'crypto' ? t('accounts.requisiteHintCrypto') : t('accounts.requisiteHint')}>
              <input type="text" value={requisite} onChange={(e) => setRequisite(e.target.value)} placeholder={form === 'crypto' ? 'T…' : '4149 …'} />
            </Field>
            <Field label={t('accounts.service')}>
              <select className="select" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">{t('accounts.noService')}</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <DescriptionField value={description} onChange={setDescription} error={err('description')} />
      </form>
    </Modal>
  );
}
