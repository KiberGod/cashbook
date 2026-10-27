import { useMemo, useState, type FormEvent } from 'react';
import { AssetIcon, Avatar, CardMenu, EmptyState, Field, FormBadge, Highlight, LinkList, Money, MultiSelect, Pagination, SearchField, TotalsTable, usePaged } from '../components/bits';
import { DescriptionField, FormChecks, FormFooter, NameField, useTextRules } from '../components/forms';
import { PageHead } from '../components/Layout';
import { ConfirmDialog, Modal } from '../components/Modal';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { deleteAsset, saveAsset } from '../lib/ops';
import { byName, matchesAny } from '../lib/search';
import { getIndex, round } from '../lib/stats';
import { FORMS, LIMITS, type Asset, type FormId } from '../lib/types';
import { href } from '../router';
import { mutate, useStore } from '../store/store';
import { DebtRow } from './DebtsPage';
import { NotFound } from './common';

export function AssetsPage() {
  const { t, tn, locale } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [q, setQ] = useState('');
  const [forms, setForms] = useState<string[]>([]);
  const [edit, setEdit] = useState<Asset | 'new' | null>(null);
  const [del, setDel] = useState<Asset | null>(null);

  const list = useMemo(
    () =>
      data.assets
        .filter((a) => matchesAny(q, a.name, a.code))
        .filter((a) => !forms.length || a.forms.some((f) => forms.includes(f)))
        .sort(byName(locale)),
    [data.assets, q, forms, locale],
  );
  const paged = usePaged(list, 'assets', `${q}|${forms}`);

  return (
    <>
      <PageHead
        title={t('nav.assets')}
        icon={<Icon name="currency" />}
        subtitle={t('assets.subtitle')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={18} />
            {t('assets.add')}
          </button>
        }
      />
      <div className="toolbar toolbar-wide">
        <SearchField value={q} onChange={setQ} placeholder={t('assets.search')} />
        <MultiSelect
          label={t('filter.form')}
          options={FORMS.map((f) => ({ value: f, label: t(`form.${f}`) }))}
          value={forms}
          onChange={setForms}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState icon="currency" text={q || forms.length ? t('common.nothingFound') : t('assets.empty')} />
      ) : (
        <div className="rows">
          {paged.items.map((a) => {
            const u = ix.assetUsage.get(a.id)!;
            return (
              <a key={a.id} className="row" href={href.detail('assets', a.id)}>
                <AssetIcon asset={a} size={36} />
                <div className="row-main">
                  <div className="row-title">
                    <Highlight text={a.name} query={q} />
                  </div>
                  <div className="row-meta">
                    {a.forms.map((f) => (
                      <FormBadge key={f} form={f} />
                    ))}
                  </div>
                </div>
                <div className="row-side muted">
                  {tn('counts.accounts', u.accounts.length)} · {tn('counts.transactions', u.txs)}
                </div>
                <CardMenu
                  actions={[
                    { label: t('common.edit'), icon: 'edit', onSelect: () => setEdit(a) },
                    { label: t('common.delete'), icon: 'trash', danger: true, onSelect: () => setDel(a) },
                  ]}
                />
              </a>
            );
          })}
        </div>
      )}
      <Pagination p={paged} />
      {edit && <AssetEditor asset={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {del && <DeleteAsset asset={del} onClose={() => setDel(null)} />}
    </>
  );
}

export function AssetDetail({ id }: { id: string }) {
  const { t, tn, num } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const asset = ix.assets.get(id);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  if (!asset) return <NotFound />;
  const u = ix.assetUsage.get(id)!;
  const isOwn = (a: { contactId: string }) => !!a.contactId && a.contactId === ix.self?.id;
  const balance = (accountId: string) => ix.account.get(accountId)!.balances.get(id) ?? 0;

  // totals of this asset per form of funds: all accounts / own accounts
  const total: Record<string, number> = {};
  const own: Record<string, number> = {};
  for (const a of u.accounts) {
    total[a.form] = round((total[a.form] ?? 0) + balance(a.id));
    if (isOwn(a)) own[a.form] = round((own[a.form] ?? 0) + balance(a.id));
  }
  const sum = (m: Record<string, number>) => round(Object.values(m).reduce((x, v) => x + v, 0));

  return (
    <>
      <PageHead
        crumbs={[{ label: t('nav.assets'), href: href.list('assets') }]}
        title={asset.name}
        icon={<AssetIcon asset={asset} size={34} />}
        actions={
          <>
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
      <div className="detail-grid">
        <section className="panel">
          <h2>{t('common.details')}</h2>
          <dl className="kv">
            <dt>{t('assets.code')}</dt>
            <dd>{asset.code}</dd>
            <dt>{t('assets.forms')}</dt>
            <dd className="badges">
              {asset.forms.length ? asset.forms.map((f) => <FormBadge key={f} form={f} />) : <span className="muted">—</span>}
            </dd>
            <dt>{t('assets.decimals')}</dt>
            <dd>{num(asset.decimals)}</dd>
            <dt>{t('common.description')}</dt>
            <dd className="pre">{asset.description || <span className="muted">—</span>}</dd>
          </dl>
          <h2>{t('assets.balance')}</h2>
          <TotalsTable
            head={t('filter.form')}
            empty={t('assets.noBalance')}
            rows={FORMS.map((f) => ({ key: f, label: <FormBadge form={f} />, asset, total: total[f] ?? 0, own: own[f] ?? 0 }))}
            footer={{ key: 'sum', label: t('totals.sum'), asset, total: sum(total), own: sum(own) }}
          />
        </section>
        <div className="detail-col">
          <section className="panel">
            <h2>
              {t('nav.accounts')} <span className="count">{u.accounts.length}</span>
            </h2>
            <LinkList
              empty={t('assets.noAccounts')}
              items={u.accounts.map((a) => ({
                href: href.detail('accounts', a.id),
                label: a.name,
                badge: isOwn(a) ? <span className="badge badge-accent">{t('accounts.yours')}</span> : undefined,
                meta: <Money value={balance(a.id)} asset={asset} />,
              }))}
            />
            {u.accounts.length > 0 && (
              <a className="btn btn-sm" href={href.transactions({ asset: id })}>
                {tn('counts.transactions', u.txs)}
              </a>
            )}
          </section>
          <section className="panel">
            <h2>
              {t('nav.debts')} <span className="count">{u.debts.length}</span>
            </h2>
            {u.debts.length === 0 ? (
              <p className="muted">{t('assets.noDebts')}</p>
            ) : (
              <div className="rows rows-compact">
                {u.debts.map((d) => (
                  <DebtRow key={d.id} d={d} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      {edit && <AssetEditor asset={asset} onClose={() => setEdit(false)} />}
      {del && <DeleteAsset asset={asset} onClose={() => setDel(false)} onDeleted={() => (location.hash = href.list('assets'))} />}
    </>
  );
}

function DeleteAsset({ asset, onClose, onDeleted }: { asset: Asset; onClose: () => void; onDeleted?: () => void }) {
  const { t, tn } = useI18n();
  const data = useStore((s) => s.data);
  const u = getIndex(data).assetUsage.get(asset.id)!;
  const used = u.accounts.length + u.txs + u.debts.length > 0;
  if (used) {
    return (
      <Modal
        title={t('assets.cantDelete', { name: asset.name })}
        onClose={onClose}
        size="sm"
        footer={
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t('common.ok')}
          </button>
        }
      >
        <p className="muted">{t('assets.usedText')}</p>
        <ul className="usage-list">
          {u.accounts.length > 0 && <li>{tn('counts.accounts', u.accounts.length)}</li>}
          {u.txs > 0 && <li>{tn('counts.transactions', u.txs)}</li>}
          {u.debts.length > 0 && <li>{tn('counts.debts', u.debts.length)}</li>}
        </ul>
        <LinkList
          empty=""
          items={[
            ...u.accounts.map((a) => ({ href: href.detail('accounts', a.id), label: a.name })),
            ...u.debts.map((d) => ({ href: href.detail('debts', d.id), label: d.name })),
            ...(u.txs ? [{ href: href.transactions({ asset: asset.id }), label: t('nav.transactions') }] : []),
          ]}
        />
      </Modal>
    );
  }
  return (
    <ConfirmDialog
      title={t('assets.deleteTitle', { name: asset.name })}
      text={t('common.cannotUndo')}
      onClose={onClose}
      onConfirm={() => {
        mutate((d) => deleteAsset(d, asset.id));
        onDeleted?.();
      }}
    />
  );
}

export function AssetEditor({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const { t } = useI18n();
  const rules = useTextRules();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [name, setName] = useState(asset?.name ?? '');
  const [code, setCode] = useState(asset?.code ?? '');
  const [iconKind, setIconKind] = useState<'symbol' | 'image'>(asset?.image ? 'image' : 'symbol');
  const [symbol, setSymbol] = useState(asset?.symbol ?? '');
  const [image, setImage] = useState(asset?.image ?? '');
  const [decimals, setDecimals] = useState(String(asset?.decimals ?? 2));
  const [forms, setForms] = useState<FormId[]>(asset?.forms ?? []);
  const [description, setDescription] = useState(asset?.description ?? '');
  const [tried, setTried] = useState(false);

  // a form stays checked while accounts of that form hold the asset
  const lockedForms = new Set(asset ? (ix.assetUsage.get(asset.id)?.accounts ?? []).map((a) => a.form) : []);
  const missingLocked = [...lockedForms].filter((f) => !forms.includes(f));
  const dec = Number(decimals);

  const errors = {
    name: rules.required(name),
    code: rules.required(code, LIMITS.code),
    symbol: iconKind === 'symbol' && symbol.length > LIMITS.symbol ? t('form.tooLong', { n: LIMITS.symbol }) : null,
    image: iconKind === 'image' ? (image.trim() ? rules.url(image) : t('form.required')) : null,
    decimals: !Number.isInteger(dec) || dec < 0 || dec > LIMITS.maxDecimals ? t('assets.decimalsError', { n: LIMITS.maxDecimals }) : null,
    forms: missingLocked.length ? t('assets.formLocked', { forms: missingLocked.map((f) => t(`form.${f}`)).join(', ') }) : null,
    description: rules.optional(description),
  };
  const invalid = Object.values(errors).some(Boolean);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    mutate(
      (d) =>
        saveAsset(
          d,
          {
            name: name.trim(),
            code: code.trim(),
            symbol: iconKind === 'symbol' ? symbol.trim() : '',
            image: iconKind === 'image' ? image.trim() : '',
            decimals: dec,
            forms: FORMS.filter((f) => forms.includes(f)),
            description: description.trim(),
          },
          asset?.id,
        ).data,
    );
    onClose();
  };
  const err = (k: keyof typeof errors) => (tried || k === 'forms' ? errors[k] : null);

  return (
    <Modal title={asset ? t('assets.edit') : t('assets.new')} onClose={onClose} footer={<FormFooter onCancel={onClose} />}>
      <form id="entity-form" className="form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <NameField value={name} onChange={setName} error={err('name')} placeholder={t('assets.namePlaceholder')} />
          <Field label={t('assets.code')} error={err('code')} counter={[code.trim().length, LIMITS.code]}>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="UAH, USDT…" />
          </Field>
        </div>
        <Field label={t('assets.iconKind')} error={err(iconKind)} group>
          <span className="icon-input">
            <Avatar image={iconKind === 'image' ? image.trim() : ''} symbol={symbol.trim() || code.trim().slice(0, 3)} name={code || name || '?'} size={30} />
            {iconKind === 'symbol' ? (
              <input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="₴, $, €" aria-label={t('assets.symbol')} />
            ) : (
              <input type="text" inputMode="url" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" aria-label={t('common.imageUrl')} />
            )}
            <span className="icon-input-kinds" role="radiogroup" aria-label={t('assets.iconKind')}>
              {(['symbol', 'image'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={iconKind === k}
                  className={iconKind === k ? 'active' : ''}
                  title={k === 'symbol' ? t('assets.symbol') : t('common.image')}
                  aria-label={k === 'symbol' ? t('assets.symbol') : t('common.image')}
                  onClick={() => setIconKind(k)}
                >
                  <Icon name={k === 'symbol' ? 'type' : 'image'} size={16} />
                </button>
              ))}
            </span>
          </span>
        </Field>
        <div className="form-grid">
          <Field label={t('assets.decimals')} error={err('decimals')}>
            <input type="number" min={0} max={LIMITS.maxDecimals} step={1} value={decimals} onChange={(e) => setDecimals(e.target.value)} />
          </Field>
        </div>
        <FormChecks forms={FORMS} value={forms} onChange={setForms} label={t('assets.forms')} error={err('forms')} />
        <DescriptionField value={description} onChange={setDescription} error={err('description')} />
      </form>
    </Modal>
  );
}
