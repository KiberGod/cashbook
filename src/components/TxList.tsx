import { useState } from 'react';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { deleteTransaction } from '../lib/ops';
import { getIndex, type Index } from '../lib/stats';
import type { Account, Transaction } from '../lib/types';
import { href } from '../router';
import { mutate, useStore } from '../store/store';
import { openTxForm } from '../store/ui';
import { AssetIcon, CardMenu, EmptyState, Highlight, Money, Pagination, usePaged } from './bits';
import { ConfirmDialog } from './Modal';

export type Direction = 'in' | 'out' | 'internal' | 'other';

/** Direction of a transaction seen from a set of accounts (e.g. one account, or all accounts of a contact). */
export function directionOf(t: Transaction, side: Set<string> | null): Direction {
  if (!side) return 'other';
  const f = side.has(t.fromId);
  const to = side.has(t.toId);
  if (f && to) return 'internal';
  if (to) return 'in';
  if (f) return 'out';
  return 'other';
}

function AccountRef({ ix, account, q }: { ix: Index; account: Account | undefined; q: string }) {
  const { t } = useI18n();
  if (!account) return <span className="muted">{t('tx.external')}</span>;
  const contact = account.contactId ? ix.contacts.get(account.contactId) : undefined;
  return (
    <span className="acc-ref">
      <a href={href.detail('accounts', account.id)} onClick={(e) => e.stopPropagation()}>
        <Highlight text={account.name} query={q} />
      </a>
      {contact && (
        <a className="muted acc-contact" href={href.detail('contacts', contact.id)} onClick={(e) => e.stopPropagation()}>
          <Highlight text={contact.name} query={q} />
        </a>
      )}
    </span>
  );
}

export function TxRow({ t: tx, side, q = '' }: { t: Transaction; side: Set<string> | null; q?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [del, setDel] = useState(false);
  const asset = ix.assets.get(tx.assetId);
  const feeAsset = ix.assets.get(tx.feeAssetId);
  const category = tx.categoryId ? ix.categories.get(tx.categoryId) : undefined;
  const parent = category?.parentId ? ix.categories.get(category.parentId) : undefined;
  const debt = tx.debtId ? ix.debts.get(tx.debtId) : undefined;
  const dir = directionOf(tx, side);
  const value = dir === 'out' ? -tx.amount : dir === 'in' ? tx.amount : tx.amount;

  return (
    <div className={`tx-row tx-${dir}`} onClick={() => openTxForm({ id: tx.id })} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTxForm({ id: tx.id })}>
      <span className={`tx-dir dir-${dir}`} title={t(`dir.${dir}`)}>
        <Icon name={dir === 'in' ? 'arrowIn' : dir === 'out' ? 'arrowOut' : 'swap'} size={16} />
      </span>
      <div className="tx-main">
        <div className="tx-parties">
          <AccountRef ix={ix} account={ix.accounts.get(tx.fromId)} q={q} />
          <Icon name="chevronRight" size={14} />
          <AccountRef ix={ix} account={ix.accounts.get(tx.toId)} q={q} />
        </div>
        <div className="tx-meta">
          <span className="muted">{i18n.dateTime(tx.date)}</span>
          {category && (
            <a className="chip" href={href.detail('categories', category.id)} onClick={(e) => e.stopPropagation()}>
              <Icon name="tag" size={12} />
              {parent ? `${parent.name} / ` : ''}
              <Highlight text={category.name} query={q} />
            </a>
          )}
          {debt && (
            <a className="chip chip-debt" href={href.detail('debts', debt.id)} onClick={(e) => e.stopPropagation()}>
              <Icon name="handshake" size={12} />
              {debt.name}
            </a>
          )}
          {tx.description && (
            <span className="tx-desc">
              <Highlight text={tx.description} query={q} />
            </span>
          )}
        </div>
      </div>
      <div className="tx-amount">
        <span className="tx-value">
          <AssetIcon asset={asset} size={16} />
          <Money value={value} asset={asset} sign={dir === 'in'} colored={dir === 'in' || dir === 'out'} />
        </span>
        {tx.fee ? (
          <span className="tx-fee muted">
            {t('tx.feeShort')} <Money value={tx.fee} asset={feeAsset} />
          </span>
        ) : null}
      </div>
      <CardMenu
        actions={[
          { label: t('common.edit'), icon: 'edit', onSelect: () => openTxForm({ id: tx.id }) },
          {
            label: t('tx.duplicate'),
            icon: 'plus',
            onSelect: () => {
              const { id: _id, createdAt: _c, updatedAt: _u, date: _d, ...rest } = tx;
              openTxForm({ prefill: rest });
            },
          },
          { label: t('common.delete'), icon: 'trash', danger: true, onSelect: () => setDel(true) },
        ]}
      />
      {del && <DeleteTx tx={tx} onClose={() => setDel(false)} />}
    </div>
  );
}

export function DeleteTx({ tx, onClose, onDeleted }: { tx: Transaction; onClose: () => void; onDeleted?: () => void }) {
  const i18n = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const asset = ix.assets.get(tx.assetId);
  return (
    <ConfirmDialog
      title={i18n.t('tx.deleteTitle')}
      text={i18n.t('tx.deleteText', { date: i18n.dateTime(tx.date), amount: `${i18n.num(tx.amount, asset?.decimals ?? 2)} ${asset?.code ?? ''}` })}
      onClose={onClose}
      onConfirm={() => {
        mutate((d) => deleteTransaction(d, tx.id));
        onDeleted?.();
      }}
    />
  );
}

/** Paged chronological list (newest first). `side` = accounts the list is seen from. */
export function TxList({
  txs,
  side = null,
  q = '',
  prefKey,
  resetKey,
  empty,
}: {
  txs: Transaction[];
  side?: Set<string> | null;
  q?: string;
  prefKey: string;
  resetKey?: unknown;
  empty?: string;
}) {
  const { t, month } = useI18n();
  const paged = usePaged(txs, prefKey, resetKey ?? txs.length);
  if (!txs.length) return <EmptyState icon="swap" text={empty ?? t('tx.empty')} />;
  let lastMonth = '';
  return (
    <>
      <div className="tx-list">
        {paged.items.map((tx) => {
          const d = new Date(tx.date);
          const m = `${d.getFullYear()}-${d.getMonth()}`;
          const head = m !== lastMonth ? month(tx.date) : null;
          lastMonth = m;
          return (
            <div key={tx.id}>
              {head && <div className="tx-month">{head}</div>}
              <TxRow t={tx} side={side} q={q} />
            </div>
          );
        })}
      </div>
      <Pagination p={paged} />
    </>
  );
}
