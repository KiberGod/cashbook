import { DndContext, DragOverlay, MeasuringStrategy, closestCenter, pointerWithin, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Avatar, CardMenu, EmptyState, Field, Highlight, LinkList, SearchField } from '../components/bits';
import { DescriptionField, FormFooter, ImageField, NameField, useTextRules } from '../components/forms';
import { PageHead } from '../components/Layout';
import { dragHandle, swallowNextClick, useDragSensors } from '../components/dnd';
import { ConfirmDialog, Modal } from '../components/Modal';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { categoryTree, deleteCategory, moveCategory, saveCategory } from '../lib/ops';
import { matchesAny } from '../lib/search';
import { categoryTxTotal, getIndex } from '../lib/stats';
import type { Category } from '../lib/types';
import { href } from '../router';
import { mutate, useStore } from '../store/store';
import { NotFound } from './common';

/** Where every category sits while dragging: root ids, and the sub-category ids of each root. */
interface Layout {
  roots: string[];
  children: Record<string, string[]>;
}

type DragKind = 'root' | 'child';
const kindOf = (x: { data: { current?: Record<string, unknown> } } | null | undefined) => x?.data.current?.kind as DragKind | undefined;

/**
 * A root drags only among roots (with its sub-categories); a sub-category goes to the
 * sub-category under the pointer, else to the root block under it (that root's end, also
 * when it has none yet), else to the nearest sub-category.
 */
const collide: CollisionDetection = (args) => {
  const of = (k: DragKind) => args.droppableContainers.filter((c) => kindOf(c) === k);
  if (kindOf(args.active) === 'root') return closestCenter({ ...args, droppableContainers: of('root') });
  const children = of('child');
  const under = pointerWithin({ ...args, droppableContainers: children });
  if (under.length) return under;
  const root = pointerWithin({ ...args, droppableContainers: of('root') });
  if (root.length) return root;
  return closestCenter({ ...args, droppableContainers: children.length ? children : of('root') });
};

export function CategoriesPage() {
  const { t, tn } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ category: Category | null; parentId?: string } | null>(null);
  const [del, setDel] = useState<Category | null>(null);
  const [drag, setDrag] = useState<Layout | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const sensors = useDragSensors();
  // the order is only changed on the full tree, never on search results
  const sortable = !q.trim();

  const full = useMemo(() => categoryTree(data.categories), [data.categories]);
  const tree = useMemo(() => {
    if (drag) {
      return drag.roots.map((id) => ({ root: ix.categories.get(id)!, rootHit: true, children: drag.children[id].map((c) => ix.categories.get(c)!) }));
    }
    return full
      .map(({ root, children }) => {
        const rootHit = matchesAny(q, root.name);
        const hits = children.filter((c) => matchesAny(q, c.name));
        return { root, rootHit, children: q && !rootHit ? hits : children, visible: rootHit || hits.length > 0 };
      })
      .filter((x) => x.visible);
  }, [full, drag, ix, q]);

  const parentIn = (l: Layout, id: string) => l.roots.find((r) => l.children[r].includes(id));

  const onDragStart = ({ active: a }: DragStartEvent) => {
    setActive(String(a.id));
    setDrag({ roots: full.map((n) => n.root.id), children: Object.fromEntries(full.map((n) => [n.root.id, n.children.map((c) => c.id)])) });
  };

  // a sub-category moves into another root as soon as it is dragged over it
  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over || kindOf(a) !== 'child') return;
    setDrag((l) => {
      if (!l) return l;
      const id = String(a.id);
      const overId = String(over.id);
      const onRoot = kindOf(over) === 'root';
      const from = parentIn(l, id);
      const to = onRoot ? overId : parentIn(l, overId);
      if (!from || !to || from === to) return l;
      const into = l.children[to].slice();
      into.splice(onRoot ? into.length : into.indexOf(overId), 0, id);
      return { ...l, children: { ...l.children, [from]: l.children[from].filter((x) => x !== id), [to]: into } };
    });
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    swallowNextClick();
    const l = drag;
    setDrag(null);
    setActive(null);
    if (!l || !over) return;
    const id = String(a.id);
    const overId = String(over.id);
    if (kindOf(a) === 'root') {
      if (overId !== id) mutate((d) => moveCategory(d, id, '', l.roots.indexOf(overId)));
      return;
    }
    const parent = parentIn(l, id);
    if (!parent) return;
    const list = l.children[parent];
    const index = kindOf(over) === 'child' && overId !== id && list.includes(overId) ? list.indexOf(overId) : list.indexOf(id);
    mutate((d) => moveCategory(d, id, parent, index));
  };

  const onDragCancel = () => {
    setDrag(null);
    setActive(null);
  };

  const menu = (c: Category) => [
    ...(!c.parentId ? [{ label: t('categories.addChild'), icon: 'plus' as const, onSelect: () => setEdit({ category: null, parentId: c.id }) }] : []),
    { label: t('common.edit'), icon: 'edit' as const, onSelect: () => setEdit({ category: c }) },
    { label: t('common.delete'), icon: 'trash' as const, danger: true, onSelect: () => setDel(c) },
  ];
  const dragged = active ? ix.categories.get(active) : undefined;

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
      <div className="toolbar toolbar-wide">
        <SearchField value={q} onChange={setQ} placeholder={t('categories.search')} />
      </div>
      {tree.length === 0 ? (
        <EmptyState icon="tag" text={q ? t('common.nothingFound') : t('categories.empty')} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collide}
          // root blocks change height while sub-categories move between them
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <SortableContext items={tree.map((n) => n.root.id)} strategy={verticalListSortingStrategy} disabled={!sortable}>
            <div className="tree">
              {tree.map(({ root, rootHit, children }) => (
                <RootNode
                  key={root.id}
                  root={root}
                  dim={!!q && !rootHit}
                  query={q}
                  sortable={sortable}
                  txs={tn('counts.transactions', categoryTxTotal(ix, root.id))}
                  menu={menu(root)}
                >
                  <SortableContext items={children.map((c) => c.id)} strategy={verticalListSortingStrategy} disabled={!sortable}>
                    {children.length > 0 && (
                      <div className="tree-children">
                        {children.map((c) => (
                          <ChildRow key={c.id} category={c} query={q} sortable={sortable} txs={tn('counts.transactions', ix.categoryTx.get(c.id) ?? 0)} menu={menu(c)} />
                        ))}
                      </div>
                    )}
                  </SortableContext>
                </RootNode>
              ))}
            </div>
          </SortableContext>
          {/* the card under the pointer moves freely; its place in the list shows where it will land */}
          <DragOverlay>
            {dragged &&
              (dragged.parentId ? (
                <RowView category={dragged} txs={tn('counts.transactions', ix.categoryTx.get(dragged.id) ?? 0)} child lifted />
              ) : (
                <div className="tree-node">
                  <RowView category={dragged} txs={tn('counts.transactions', categoryTxTotal(ix, dragged.id))} lifted />
                  {(drag?.children[dragged.id].length ?? 0) > 0 && (
                    <div className="tree-children">
                      {drag!.children[dragged.id].map((c) => (
                        <RowView key={c} category={ix.categories.get(c)!} txs={tn('counts.transactions', ix.categoryTx.get(c) ?? 0)} child />
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </DragOverlay>
        </DndContext>
      )}
      {edit && <CategoryEditor category={edit.category} parentId={edit.parentId} onClose={() => setEdit(null)} />}
      {del && <DeleteCategory category={del} onClose={() => setDel(null)} />}
    </>
  );
}

type MenuActions = Parameters<typeof CardMenu>[0]['actions'];

/** A root category with its sub-categories; dragging its row moves the whole block. */
function RootNode({
  root,
  dim,
  query,
  sortable,
  txs,
  menu,
  children,
}: {
  root: Category;
  dim: boolean;
  query: string;
  sortable: boolean;
  txs: string;
  menu: MenuActions;
  children: ReactNode;
}) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: root.id, data: { kind: 'root' } });
  return (
    <div
      ref={setNodeRef}
      className={`tree-node ${isDragging ? 'tree-node-placeholder' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <a className={`row ${dim ? 'dim' : ''}`} href={href.detail('categories', root.id)} {...dragHandle(sortable, attributes, listeners)}>
        <Avatar image={root.image} name={root.name} fallback="tag" />
        <div className="row-main">
          <div className="row-title">
            <Highlight text={root.name} query={query} />
          </div>
        </div>
        <div className="row-side muted">{txs}</div>
        <CardMenu actions={menu} />
      </a>
      {children}
    </div>
  );
}

/** A static copy of a row, for the card that follows the pointer. */
function RowView({ category: c, txs, child = false, lifted = false }: { category: Category; txs: string; child?: boolean; lifted?: boolean }) {
  return (
    <div className={`row ${child ? 'row-child' : ''} ${lifted ? 'row-dragging' : ''}`}>
      <Avatar image={c.image} name={c.name} size={child ? 30 : 36} fallback="tag" />
      <div className="row-main">
        <div className="row-title">{c.name}</div>
      </div>
      <div className="row-side muted">{txs}</div>
      <span className="menu" aria-hidden="true">
        <span className="icon-btn menu-trigger">
          <Icon name="more" size={18} />
        </span>
      </span>
    </div>
  );
}

function ChildRow({ category: c, query, sortable, txs, menu }: { category: Category; query: string; sortable: boolean; txs: string; menu: MenuActions }) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: c.id, data: { kind: 'child' } });
  return (
    <a
      ref={setNodeRef}
      className={`row row-child ${isDragging ? 'row-placeholder' : ''}`}
      href={href.detail('categories', c.id)}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...dragHandle(sortable, attributes, listeners)}
    >
      <Avatar image={c.image} name={c.name} size={30} fallback="tag" />
      <div className="row-main">
        <div className="row-title">
          <Highlight text={c.name} query={query} />
        </div>
      </div>
      <div className="row-side muted">{txs}</div>
      <CardMenu actions={menu} />
    </a>
  );
}

export function CategoryDetail({ id }: { id: string }) {
  const { t, tn } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const category = ix.categories.get(id);
  const [edit, setEdit] = useState<{ category: Category | null; parentId?: string } | null>(null);
  const [del, setDel] = useState(false);

  if (!category) return <NotFound />;
  const parent = category.parentId ? ix.categories.get(category.parentId) : undefined;
  const children = (ix.categoryChildren.get(id) ?? []).slice().sort((a, b) => a.order - b.order);

  return (
    <>
      <PageHead
        crumbs={[
          { label: t('nav.categories'), href: href.list('categories') },
          ...(parent ? [{ label: parent.name, href: href.detail('categories', parent.id) }] : []),
        ]}
        title={category.name}
        icon={<Avatar image={category.image} name={category.name} size={34} fallback="tag" />}
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
      <div className="detail-grid">
        <section className="panel">
          <h2>{t('common.details')}</h2>
          <dl className="kv">
            <dt>{t('common.description')}</dt>
            <dd className="pre">{category.description || <span className="muted">—</span>}</dd>
          </dl>
        </section>
        <section className="panel">
          <h2>{t('categories.related')}</h2>
          {/* this category opens its transactions (a root's include its sub-categories), the others open their pages */}
          <LinkList
            empty="—"
            items={[
              ...(parent ? [{ href: href.detail('categories', parent.id), label: parent.name, icon: <Avatar image={parent.image} name={parent.name} size={24} fallback="tag" />, meta: tn('counts.transactions', categoryTxTotal(ix, parent.id)) }] : []),
              {
                href: href.transactions({ category: id }),
                label: category.name,
                icon: <Avatar image={category.image} name={category.name} size={24} fallback="tag" />,
                meta: tn('counts.transactions', parent ? (ix.categoryTx.get(id) ?? 0) : categoryTxTotal(ix, id)),
              },
              ...children.map((c) => ({
                href: href.detail('categories', c.id),
                label: c.name,
                icon: <Avatar image={c.image} name={c.name} size={24} fallback="tag" />,
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
  const { t } = useI18n();
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
  const roots = categoryTree(data.categories).map((n) => n.root).filter((c) => c.id !== category?.id);

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
        <Field label={t('categories.parent')} hint={hasChildren ? t('categories.parentLocked') : undefined}>
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
