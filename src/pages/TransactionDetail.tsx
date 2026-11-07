import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountIcon, AssetIcon, Avatar, ContactChip, Money } from '../components/bits';
import { PageHead } from '../components/Layout';
import { DeleteTx, directionOf } from '../components/TxList';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { ownAccountIds } from '../lib/analytics';
import { debtEffect, getIndex, type Index } from '../lib/stats';
import type { Account } from '../lib/types';
import { goBack, href } from '../router';
import { useStore } from '../store/store';
import { openTxForm } from '../store/ui';
import { NotFound } from './common';

/** One side's account: picture, name, form and service, linking to its page; or "not set". */
function AccountCard({ ix, account }: { ix: Index; account: Account | undefined }) {
  const { t } = useI18n();
  if (!account) return <span className="txd-account txd-account-none muted">{t('tx.external')}</span>;
  const service = account.serviceId ? ix.services.get(account.serviceId) : undefined;
  return (
    <a className="txd-account" href={href.detail('accounts', account.id)}>
      <AccountIcon account={account} service={service} size={36} />
      <span className="txd-account-main">
        <span className="txd-account-name">{account.name}</span>
        <span className="muted txd-account-note">
          {t(`form.${account.form}`)}
          {service ? ` · ${service.name}` : ''}
        </span>
      </span>
    </a>
  );
}

/** One side's contact (the account's owner), or why there is none. */
function PartyContact({ ix, account }: { ix: Index; account: Account | undefined }) {
  const { t } = useI18n();
  const contact = account?.contactId ? ix.contacts.get(account.contactId) : undefined;
  if (contact) return <ContactChip contact={contact} href={href.detail('contacts', contact.id)} />;
  return <span className="muted">{account ? t('tx.noContact') : t('tx.unknownParty')}</span>;
}

/** A transaction's own page: what moved where and why, with edit and delete. */
export function TransactionDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const tx = ix.transactions.get(id);
  const [del, setDel] = useState(false);
  const own = useMemo(() => ownAccountIds(ix), [ix]);

  // deleted while open (e.g. from its editor): leave the page instead of showing "not found"
  const seen = useRef(!!tx);
  useEffect(() => {
    if (tx) seen.current = true;
    else if (seen.current) goBack(href.transactions());
  }, [tx]);
  if (!tx) return <NotFound />;

  const asset = ix.assets.get(tx.assetId);
  const feeAsset = ix.assets.get(tx.feeAssetId);
  const from = ix.accounts.get(tx.fromId);
  const to = ix.accounts.get(tx.toId);
  const category = tx.categoryId ? ix.categories.get(tx.categoryId) : undefined;
  const parent = category?.parentId ? ix.categories.get(category.parentId) : undefined;
  const debt = tx.debtId ? ix.debts.get(tx.debtId) : undefined;
  const effect = debt ? debtEffect(debt, tx, ix.accounts) : 0;
  const dir = directionOf(tx, own);
  const value = dir === 'out' ? -tx.amount : tx.amount;
  const dirIcon = dir === 'in' ? 'arrowIn' : dir === 'out' ? 'arrowOut' : 'swap';
  // a record written by hand into the sheet may lack its stamps
  const when = (iso: string) => (Number.isNaN(Date.parse(iso)) ? '—' : i18n.dateTime(iso));

  return (
    <>
      <PageHead
        crumbs={[{ label: t('nav.transactions'), href: href.transactions() }]}
        title={t('tx.one')}
        actions={
          <>
            <button type="button" className="btn" onClick={() => openTxForm({ id })}>
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
      {/* each panel as tall as its content */}
      <div className="debt-layout txd-layout">
        {/* how much and which way, seen from the user's own accounts */}
        <section className="panel debt-summary">
          <h2 className="panel-title">
            {t('tx.one')}
            <span className={`badge txd-dir dir-${dir}`}>
              <Icon name={dirIcon} size={12} />
              {t(`tx.kind.${dir}`)}
            </span>
          </h2>
          <div className="cell">
            <span className="cell-label">{t('tx.amount')}</span>
            <span className="txd-amount">
              <AssetIcon asset={asset} size={22} />
              <Money value={value} asset={asset} sign={dir === 'in'} colored={dir === 'in' || dir === 'out'} />
            </span>
          </div>
          {tx.fee ? (
            <div className="cell">
              <span className="cell-label">{t('tx.fee')}</span>
              <span className="amount-chip">
                <AssetIcon asset={feeAsset} size={16} />
                <Money value={tx.fee} asset={feeAsset} />
              </span>
            </div>
          ) : null}
          <div className="cell">
            <span className="cell-label">{t('tx.category')}</span>
            {category ? (
              <a className="chip" href={href.detail('categories', category.id)}>
                <Avatar image={category.image || parent?.image || ''} name={category.name} size={16} fallback="tag" />
                {parent ? `${parent.name} / ` : ''}
                {category.name}
              </a>
            ) : (
              <span className="muted">—</span>
            )}
          </div>
          <div className="cell">
            <span className="cell-label">{t('tx.date')}</span>
            <span>{i18n.dateTime(tx.date)}</span>
          </div>
        </section>
        <section className="panel debt-details">
          <h2>{t('common.details')}</h2>
          {/* who sent to whom over which accounts: one arrow for both rows */}
          <div className="txd-route">
            <div className="cell txd-from-party">
              <span className="cell-label">{t('filter.sender')}</span>
              <PartyContact ix={ix} account={from} />
            </div>
            <div className="cell txd-from-account">
              <span className="cell-label">{t('tx.from')}</span>
              <AccountCard ix={ix} account={from} />
            </div>
            <span className="txd-arrow" aria-hidden="true">
              <Icon name="chevronRight" size={18} />
            </span>
            <div className="cell txd-to-party">
              <span className="cell-label">{t('filter.recipient')}</span>
              <PartyContact ix={ix} account={to} />
            </div>
            <div className="cell txd-to-account">
              <span className="cell-label">{t('tx.to')}</span>
              <AccountCard ix={ix} account={to} />
            </div>
          </div>
          <div className="cell">
            <span className="cell-label">{t('common.description')}</span>
            <span className="pre">{tx.description || <span className="muted">—</span>}</span>
          </div>
          {/* the record itself, under a line across the whole card */}
          <hr className="panel-divider" />
          <div className="cells cells-3 txd-meta">
            {debt && (
              <div className="cell">
                <span className="cell-label">{t('tx.debtPick')}</span>
                <a className="chip chip-debt" href={href.detail('debts', debt.id)}>
                  <Icon name="handshake" size={12} />
                  {debt.name}
                </a>
                {effect !== 0 && <span className="muted txd-effect">{t(effect < 0 ? 'tx.debtRepays' : 'tx.debtAdds')}</span>}
              </div>
            )}
            <div className="cell">
              <span className="cell-label">{t('common.created')}</span>
              <span>{when(tx.createdAt)}</span>
            </div>
            <div className="cell">
              <span className="cell-label">{t('common.updated')}</span>
              <span>{when(tx.updatedAt)}</span>
            </div>
          </div>
        </section>
      </div>
      {/* once deleted, the effect above leaves the page */}
      {del && <DeleteTx tx={tx} onClose={() => setDel(false)} />}
    </>
  );
}
