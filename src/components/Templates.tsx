import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n';
import { Icon } from '../icons/ui';
import { templatePrefill } from '../lib/ops';
import { getIndex, templatesUsing, type Index, type TemplateLink } from '../lib/stats';
import type { Account, Template } from '../lib/types';
import { href } from '../router';
import { useStore } from '../store/store';
import { openTemplateForm, openTxForm } from '../store/ui';
import { AccountIcon, AssetIcon, Avatar, CardMenu, Highlight, LinkList, Money } from './bits';
import { dragHandle } from './dnd';
import { DeleteTemplate } from './TxForm';

/** Opens a new transaction filled from the template (dated now). */
export const applyTemplate = (x: Template) => openTxForm({ prefill: templatePrefill(x), templateId: x.id });

/** One side of a template: the account's picture and name with its contact, or a muted dash. */
function Side({ ix, account, q }: { ix: Index; account: Account | undefined; q: string }) {
  const { t } = useI18n();
  if (!account) return <span className="muted">{t('tx.external')}</span>;
  const contact = account.contactId ? ix.contacts.get(account.contactId) : undefined;
  return (
    <span className="tpl-side">
      <AccountIcon account={account} service={account.serviceId ? ix.services.get(account.serviceId) : undefined} size={18} />
      <span className="ellipsis">
        <Highlight text={account.name} query={q} />
        {contact && (
          <span className="muted">
            {' · '}
            <Highlight text={contact.name} query={q} />
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * A template card: what it fills in, and the button that makes a transaction of it. A click on
 * the card edits the template; in the list it can be dragged to another place.
 */
export function TemplateCard({ x, q = '', sortable = false }: { x: Template; q?: string; sortable?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [del, setDel] = useState(false);
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: x.id, disabled: !sortable });

  const asset = ix.assets.get(x.assetId);
  const feeAsset = ix.assets.get(x.feeAssetId);
  const category = x.categoryId ? ix.categories.get(x.categoryId) : undefined;
  const parent = category?.parentId ? ix.categories.get(category.parentId) : undefined;
  const debt = x.debtId ? ix.debts.get(x.debtId) : undefined;
  const picture = category?.image || parent?.image || '';
  const edit = () => openTemplateForm({ id: x.id });
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  // the drag listeners and the card's own Enter share onKeyDown
  const handle = dragHandle(sortable, attributes, listeners) as ReturnType<typeof dragHandle> & { onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void };

  return (
    <div
      ref={setNodeRef}
      className={`row tpl-card ${isDragging ? 'row-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      role="button"
      tabIndex={0}
      onClick={edit}
      {...handle}
      onKeyDown={(e) => {
        handle.onKeyDown?.(e);
        if (e.key === 'Enter' && e.target === e.currentTarget) edit();
      }}
    >
      <div className="tpl-head">
        {picture ? (
          <Avatar image={picture} name={category?.name ?? ''} size={40} />
        ) : (
          <span className="tpl-icon">
            <Icon name="template" size={20} />
          </span>
        )}
        <div className="tpl-title">
          <span className="row-title">
            <Highlight text={x.name} query={q} />
          </span>
          {(category || debt) && (
            <span className="tpl-chips">
              {category && (
                <a className="chip" href={href.detail('categories', category.id)} onClick={stop}>
                  <Icon name="tag" size={12} />
                  {parent && (
                    <>
                      <Highlight text={parent.name} query={q} />
                      {' / '}
                    </>
                  )}
                  <Highlight text={category.name} query={q} />
                </a>
              )}
              {debt && (
                <a className="chip chip-debt" href={href.detail('debts', debt.id)} onClick={stop}>
                  <Icon name="handshake" size={12} />
                  <Highlight text={debt.name} query={q} />
                </a>
              )}
            </span>
          )}
        </div>
        <span onClick={stop}>
          <CardMenu
            actions={[
              { label: t('templates.use'), icon: 'plus', onSelect: () => applyTemplate(x) },
              { label: t('common.edit'), icon: 'edit', onSelect: edit },
              {
                label: t('tx.duplicate'),
                icon: 'template',
                onSelect: () => {
                  const { id: _id, createdAt: _c, updatedAt: _u, order: _o, ...rest } = x;
                  openTemplateForm({ prefill: rest });
                },
              },
              { label: t('common.delete'), icon: 'trash', danger: true, onSelect: () => setDel(true) },
            ]}
          />
        </span>
      </div>
      {/* one line per side, labelled like in the editor: long names and contacts stay readable */}
      <div className="tpl-parties">
        <span className="tpl-side-label">{t('tx.from')}</span>
        <Side ix={ix} account={ix.accounts.get(x.fromId)} q={q} />
        <span className="tpl-side-label">{t('tx.to')}</span>
        <Side ix={ix} account={ix.accounts.get(x.toId)} q={q} />
      </div>
      {x.description && (
        <span className="row-note muted ellipsis">
          <Highlight text={x.description} query={q} />
        </span>
      )}
      <div className="tpl-foot">
        <span className="tpl-amount">
          {x.amount !== null ? (
            <span className="tpl-value">
              <AssetIcon asset={asset} size={16} />
              <Money value={x.amount} asset={asset} />
            </span>
          ) : (
            <span className="muted ellipsis">{t('templates.anyAmount')}</span>
          )}
          {x.fee ? (
            <span className="tx-fee muted ellipsis">
              {t('tx.feeShort')} <Money value={x.fee} asset={feeAsset} />
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={(e) => {
            e.stopPropagation();
            applyTemplate(x);
          }}
          onPointerDown={stop}
        >
          <Icon name="plus" size={16} />
          {t('templates.use')}
        </button>
      </div>
      {del && (
        <span onClick={stop}>
          <DeleteTemplate template={x} onClose={() => setDel(false)} />
        </span>
      )}
    </div>
  );
}

/**
 * "Related templates" on an entity's page: just their names, each leading to the templates list
 * searched by that name (templates have no page of their own).
 */
export function RelatedTemplates({ kind, id, className = '' }: { kind: TemplateLink; id: string; className?: string }) {
  const { t } = useI18n();
  const data = useStore((s) => s.data);
  const list = templatesUsing(getIndex(data), kind, id);
  return (
    <section className={`panel ${className}`}>
      <h2>
        {t('templates.related')} <span className="count">{list.length}</span>
      </h2>
      <LinkList empty={t('templates.noRelated')} items={list.map((x) => ({ key: x.id, href: href.templates(x.name), label: x.name }))} />
    </section>
  );
}

/** The names of the templates a deletion touches, under its warning. */
export function TemplateNames({ list }: { list: Template[] }) {
  if (!list.length) return null;
  return (
    <ul className="usage-list tpl-names">
      {list.map((x) => (
        <li key={x.id}>
          <Icon name="template" size={14} />
          {x.name}
        </li>
      ))}
    </ul>
  );
}
