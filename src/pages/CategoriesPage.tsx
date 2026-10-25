import { useMemo, useState, type FormEvent } from 'react';
import { AssetAmounts, Avatar, CardMenu, EmptyState, Field, Highlight, LinkList, SearchField, Stat } from '../components/bits';
import { DescriptionField, FormFooter, ImageField, NameField, useTextRules } from '../components/forms';
import { PageHead } from '../components/Layout';
import { ConfirmDialog, Modal } from '../components/Modal';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { deleteCategory, saveCategory } from '../lib/ops';
import { byName, matchesAny } from '../lib/search';
import { add, categoryTxTotal, getIndex, withChildren, type AssetMap } from '../lib/stats';
import type { Category } from '../lib/types';
import { href } from '../router';
import { mutate, useStore } from '../store/store';
import { NotFound } from './common';

export function CategoriesPage() {
  const { t, tn, locale } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ category: Category | null; parentId?: string } | null>(null);
  const [del, setDel] = useState<Category | null>(null);

  const tree = useMemo(() => {
    const sort = byName<Category>(locale);
    return data.categories
      .filter((c) => !c.parentId)
      .sort(sort)
      .map((root) => {
        const children = (ix.categoryChildren.get(root.id) ?? []).slice().sort(sort);
        const rootHit = matchesAny(q, root.name);
        const hits = children.filter((c) => matchesAny(q, c.name));
        return { root, rootHit, children: q && !rootHit ? hits : children, visible: rootHit || hits.length > 0 };
      })
      .filter((x) => x.visible);
  }, [data.categories, ix, q, locale]);

  const menu = (c: Category) => [
    ...(!c.parentId ? [{ label: t('categories.addChild'), icon: 'plus' as const, onSelect: () => setEdit({ category: null, parentId: c.id }) }] : []),
    { label: t('common.edit'), icon: 'edit' as const, onSelect: () => setEdit({ category: c }) },
    { label: t('common.delete'), icon: 'trash' as const, danger: true, onSelect: () => setDel(c) },
  ];

  return (
    <>
      <PageHead
        title={t('nav.categories')}
        icon={<Icon name="tag" />}
        subtitle={t('categories.subtitle')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEdit({ category: null })}>
            <Icon name="plus" size={18} />
            {t('categories.add')}
          </button>
        }
      />
      <div className="toolbar">
        <SearchField value={q} onChange={setQ} placeholder={t('categories.search')} />
      </div>
      {tree.length === 0 ? (
        <EmptyState icon="tag" text={q ? t('common.nothingFound') : t('categories.empty')} />
      ) : (
        <div className="tree">
          {tree.map(({ root, rootHit, children }) => (
            <div key={root.id} className="tree-node">
              <a className={`row ${q && !rootHit ? 'dim' : ''}`} href={href.detail('categories', root.id)}>
                <Avatar image={root.image} name={root.name} />
                <div className="row-main">
                  <div className="row-title">
                    <Highlight text={root.name} query={q} />
                  </div>
                  <div className="row-meta muted">{tn('counts.subcategories', ix.categoryChildren.get(root.id)?.length ?? 0)}</div>
                </div>
                <div className="row-side muted">{tn('counts.transactions', categoryTxTotal(ix, root.id))}</div>
                <CardMenu actions={menu(root)} />
              </a>
              {children.length > 0 && (
                <div className="tree-children">
                  {children.map((c) => (
                    <a key={c.id} className="row row-child" href={href.detail('categories', c.id)}>
                      <Avatar image={c.image} name={c.name} size={30} />
                      <div className="row-main">
                        <div className="row-title">
                          <Highlight text={c.name} query={q} />
                        </div>
                      </div>
                      <div className="row-side muted">{tn('counts.transactions', ix.categoryTx.get(c.id) ?? 0)}</div>
                      <CardMenu actions={menu(c)} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {edit && <CategoryEditor category={edit.category} parentId={edit.parentId} onClose={() => setEdit(null)} />}
      {del && <DeleteCategory category={del} onClose={() => setDel(null)} />}
    </>
  );
}

export function CategoryDetail({ id }: { id: string }) {
  const { t, tn, locale } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const category = ix.categories.get(id);
  const [edit, setEdit] = useState<{ category: Category | null; parentId?: string } | null>(null);
  const [del, setDel] = useState(false);

  const totals = useMemo(() => {
    const ids = withChildren(ix, [id]);
    const own = new Set(data.accounts.filter((a) => a.contactId && a.contactId === ix.self?.id).map((a) => a.id));
    const spent: AssetMap = new Map();
    const received: AssetMap = new Map();
    const all: AssetMap = new Map();
    for (const tx of data.transactions) {
      if (!ids.has(tx.categoryId)) continue;
      add(all, tx.assetId, tx.amount);
      const fromOwn = own.has(tx.fromId);
      const toOwn = own.has(tx.toId);
      if (fromOwn && !toOwn) add(spent, tx.assetId, tx.amount);
      if (toOwn && !fromOwn) add(received, tx.assetId, tx.amount);
    }
    return { spent, received, all };
  }, [data, ix, id]);

  if (!category) return <NotFound />;
  const parent = category.parentId ? ix.categories.get(category.parentId) : undefined;
  const children = (ix.categoryChildren.get(id) ?? []).slice().sort(byName(locale));

  return (
    <>
      <PageHead
        crumbs={[
          { label: t('nav.categories'), href: href.list('categories') },
          ...(parent ? [{ label: parent.name, href: href.detail('categories', parent.id) }] : []),
        ]}
        title={category.name}
        icon={<Avatar image={category.image} name={category.name} size={34} />}
        actions={
          <>
            {!parent && (
              <button type="button" className="btn" onClick={() => setEdit({ category: null, parentId: id })}>
                <Icon name="plus" size={18} />
                {t('categories.addChild')}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setEdit({ category })}>
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
        <Stat label={t('nav.transactions')} hint={!parent && children.length ? t('categories.inclChildren') : undefined}>
          {categoryTxTotal(ix, id)}
        </Stat>
        <Stat label={t('categories.spent')}>
          <AssetAmounts map={totals.spent} assets={data.assets} />
        </Stat>
        <Stat label={t('categories.received')}>
          <AssetAmounts map={totals.received} assets={data.assets} />
        </Stat>
        <Stat label={t('categories.turnover')}>
          <AssetAmounts map={totals.all} assets={data.assets} />
        </Stat>
      </div>
      <div className="detail-grid">
        <section className="panel">
          <h2>{t('common.details')}</h2>
          <dl className="kv">
            <dt>{t('categories.level')}</dt>
            <dd>{parent ? t('categories.level2') : t('categories.level1')}</dd>
            {parent && (
              <>
                <dt>{t('categories.parent')}</dt>
                <dd>
                  <a href={href.detail('categories', parent.id)}>{parent.name}</a>
                </dd>
              </>
            )}
            <dt>{t('common.description')}</dt>
            <dd className="pre">{category.description || <span className="muted">—</span>}</dd>
          </dl>
        </section>
        <section className="panel">
          <h2>{t('common.related')}</h2>
          <LinkList
            empty="—"
            items={[
              { href: href.transactions({ category: id }), label: t('nav.transactions'), meta: tn('counts.transactions', categoryTxTotal(ix, id)) },
              ...children.map((c) => ({
                href: href.detail('categories', c.id),
                label: c.name,
                icon: <Avatar image={c.image} name={c.name} size={24} />,
                meta: tn('counts.transactions', ix.categoryTx.get(c.id) ?? 0),
              })),
            ]}
          />
        </section>
      </div>
      {edit && <CategoryEditor category={edit.category} parentId={edit.parentId} onClose={() => setEdit(null)} />}
      {del && <DeleteCategory category={category} onClose={() => setDel(false)} onDeleted={() => (location.hash = href.list('categories'))} />}
    </>
  );
}

function DeleteCategory({ category, onClose, onDeleted }: { category: Category; onClose: () => void; onDeleted?: () => void }) {
  const { t, tn } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const children = ix.categoryChildren.get(category.id) ?? [];
  const txs = categoryTxTotal(ix, category.id);
  return (
    <ConfirmDialog
      title={t('categories.deleteTitle', { name: category.name })}
      onClose={onClose}
      onConfirm={() => {
        mutate((d) => deleteCategory(d, category.id));
        onDeleted?.();
      }}
    >
      <ul className="usage-list">
        {children.length > 0 && <li>{t('categories.deleteChildren', { list: tn('counts.subcategories', children.length) })}</li>}
        {txs > 0 && <li>{t('categories.deleteTx', { tx: tn('counts.transactions', txs) })}</li>}
        <li>{t('common.cannotUndo')}</li>
      </ul>
    </ConfirmDialog>
  );
}

export function CategoryEditor({ category, parentId, onClose }: { category: Category | null; parentId?: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const rules = useTextRules();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [name, setName] = useState(category?.name ?? '');
  const [parent, setParent] = useState(category?.parentId ?? parentId ?? '');
  const [image, setImage] = useState(category?.image ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [tried, setTried] = useState(false);

  // only root categories can be parents; a category with children stays a root
  const hasChildren = !!category && (ix.categoryChildren.get(category.id)?.length ?? 0) > 0;
  const roots = data.categories.filter((c) => !c.parentId && c.id !== category?.id).sort(byName(locale));

  const errors = { name: rules.required(name), image: rules.url(image), description: rules.optional(description) };
  const invalid = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (tried ? errors[k] : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    mutate(
      (d) =>
        saveCategory(d, { name: name.trim(), parentId: hasChildren ? '' : parent, image: image.trim(), description: description.trim() }, category?.id)
          .data,
    );
    onClose();
  };

  return (
    <Modal title={category ? t('categories.edit') : t('categories.new')} onClose={onClose} footer={<FormFooter onCancel={onClose} />}>
      <form id="entity-form" className="form" onSubmit={submit} noValidate>
        <NameField value={name} onChange={setName} error={err('name')} />
        <Field label={t('categories.parent')} hint={hasChildren ? t('categories.parentLocked') : t('categories.parentHint')}>
          <select className="select" value={parent} onChange={(e) => setParent(e.target.value)} disabled={hasChildren}>
            <option value="">{t('categories.noParent')}</option>
            {roots.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <ImageField value={image} onChange={setImage} error={err('image')} name={name} />
        <DescriptionField value={description} onChange={setDescription} error={err('description')} />
      </form>
    </Modal>
  );
}
