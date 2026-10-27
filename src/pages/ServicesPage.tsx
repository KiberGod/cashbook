import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState, type FormEvent } from 'react';
import { AssetAmounts, AssetIcon, Avatar, CardMenu, EmptyState, FormBadge, Highlight, LinkList, Money, MultiSelect, Pagination, SearchField, usePaged } from '../components/bits';
import { DescriptionField, FormChecks, FormFooter, ImageField, NameField, useTextRules } from '../components/forms';
import { PageHead } from '../components/Layout';
import { ConfirmDialog, Modal } from '../components/Modal';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { deleteService, moveService, saveService, servicesInOrder } from '../lib/ops';
import { matchesAny } from '../lib/search';
import { add, getIndex, type AssetMap } from '../lib/stats';
import { SERVICE_FORMS, type Asset, type FormId, type Service } from '../lib/types';
import { href } from '../router';
import { mutate, useStore } from '../store/store';
import { NotFound } from './common';

export function ServicesPage() {
  const { t, tn } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [q, setQ] = useState('');
  const [forms, setForms] = useState<string[]>([]);
  const [edit, setEdit] = useState<Service | 'new' | null>(null);
  const [del, setDel] = useState<Service | null>(null);

  const list = useMemo(
    () =>
      servicesInOrder(data.services)
        .filter((s) => matchesAny(q, s.name))
        .filter((s) => !forms.length || s.forms.some((f) => forms.includes(f))),
    [data.services, q, forms],
  );
  const paged = usePaged(list, 'services', `${q}|${forms}`);
  // the order is only changed on the full list, never on search or filter results
  const filtered = !!q.trim() || forms.length > 0;

  // drag starts after a small move (mouse) or a long press (touch), so clicks and scrolling still work
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    // the click that follows a drop must not open the card (dnd-kit only stops its propagation)
    const cancel = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('click', cancel, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', cancel, { capture: true }), 300);
    if (over && active.id !== over.id) mutate((d) => moveService(d, String(active.id), String(over.id)));
  };

  return (
    <>
      <PageHead
        title={t('nav.services')}
        icon={<Icon name="bank" />}
        subtitle={t('services.subtitle')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={18} />
            {t('services.add')}
          </button>
        }
      />
      <div className="toolbar">
        <SearchField value={q} onChange={setQ} placeholder={t('services.search')} />
        <MultiSelect
          label={t('filter.form')}
          options={SERVICE_FORMS.map((f) => ({ value: f, label: t(`form.${f}`) }))}
          value={forms}
          onChange={setForms}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState icon="bank" text={filtered ? t('common.nothingFound') : t('services.empty')} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={paged.items.map((s) => s.id)} strategy={rectSortingStrategy} disabled={filtered}>
            <div className="rows rows-grid">
              {paged.items.map((s) => (
                <ServiceCard
                  key={s.id}
                  service={s}
                  query={q}
                  accounts={tn('counts.accounts', ix.serviceAccounts.get(s.id)?.length ?? 0)}
                  onEdit={() => setEdit(s)}
                  onDelete={() => setDel(s)}
                  sortable={!filtered}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <Pagination p={paged} />
      {edit && <ServiceEditor service={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {del && <DeleteService service={del} onClose={() => setDel(null)} />}
    </>
  );
}

/** A service card in the grid; drag it onto another card to change the order. */
function ServiceCard({
  service: s,
  query,
  accounts,
  onEdit,
  onDelete,
  sortable,
}: {
  service: Service;
  query: string;
  accounts: string;
  onEdit: () => void;
  onDelete: () => void;
  sortable: boolean;
}) {
  const { t } = useI18n();
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: s.id });
  return (
    <a
      ref={setNodeRef}
      className={`row ${isDragging ? 'row-dragging' : ''}`}
      href={href.detail('services', s.id)}
      draggable={false}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // a long press starts dragging on touch screens, not the link menu
      onContextMenu={(e) => (e.nativeEvent as PointerEvent).pointerType === 'touch' && e.preventDefault()}
      aria-roledescription={sortable ? attributes['aria-roledescription'] : undefined}
      aria-describedby={sortable ? attributes['aria-describedby'] : undefined}
      {...listeners}
    >
      <Avatar image={s.image} name={s.name} size={48} />
      <div className="row-main">
        <div className="row-title">
          <Highlight text={s.name} query={query} />
          {s.forms.map((f) => (
            <FormBadge key={f} form={f} />
          ))}
        </div>
        <span className="row-note muted">{accounts}</span>
        {s.description && <span className="row-note muted ellipsis">{s.description}</span>}
      </div>
      <CardMenu
        actions={[
          { label: t('common.edit'), icon: 'edit', onSelect: onEdit },
          { label: t('common.delete'), icon: 'trash', danger: true, onSelect: onDelete },
        ]}
      />
    </a>
  );
}

export function ServiceDetail({ id }: { id: string }) {
  const { t, tn } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const service = ix.services.get(id);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  if (!service) return <NotFound />;
  const accounts = ix.serviceAccounts.get(id) ?? [];
  const isOwn = (a: { contactId: string }) => !!a.contactId && a.contactId === ix.self?.id;
  const total: AssetMap = new Map();
  const own: AssetMap = new Map();
  let txs = 0;
  for (const a of accounts) {
    const s = ix.account.get(a.id)!;
    for (const [x, v] of s.balances) {
      add(total, x, v);
      if (isOwn(a)) add(own, x, v);
    }
    txs += s.flow.tx;
  }

  return (
    <>
      <PageHead
        crumbs={[{ label: t('nav.services'), href: href.list('services') }]}
        title={service.name}
        icon={<Avatar image={service.image} name={service.name} size={34} />}
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
            <dt>{t('services.forms')}</dt>
            <dd className="badges">
              {service.forms.map((f) => (
                <FormBadge key={f} form={f} />
              ))}
            </dd>
            <dt>{t('common.description')}</dt>
            <dd className="pre">{service.description || <span className="muted">—</span>}</dd>
          </dl>
          <h2>{t('services.balance')}</h2>
          <BalanceTable total={total} own={own} assets={data.assets} />
        </section>
        <section className="panel">
          <h2>
            {t('nav.accounts')} <span className="count">{accounts.length}</span>
          </h2>
          <LinkList
            empty={t('services.noAccounts')}
            items={accounts.map((a) => ({
              href: href.detail('accounts', a.id),
              label: a.name,
              badge: isOwn(a) ? <span className="badge badge-accent">{t('accounts.yours')}</span> : undefined,
              meta: <AssetAmounts map={ix.account.get(a.id)!.balances} assets={data.assets} keepZero />,
            }))}
          />
          {accounts.length > 0 && (
            <a className="btn btn-sm" href={href.transactions({ service: id })}>
              {tn('counts.transactions', txs)}
            </a>
          )}
        </section>
      </div>
      {edit && <ServiceEditor service={service} onClose={() => setEdit(false)} />}
      {del && <DeleteService service={service} onClose={() => setDel(false)} onDeleted={() => (location.hash = href.list('services'))} />}
    </>
  );
}

/** Per-asset totals of a service: all its accounts, the user's own, and their share. */
function BalanceTable({ total, own, assets }: { total: AssetMap; own: AssetMap; assets: Asset[] }) {
  const { t } = useI18n();
  const rows = assets.filter((a) => (total.get(a.id) ?? 0) !== 0 || (own.get(a.id) ?? 0) !== 0);
  if (!rows.length) return <span className="muted">{t('services.noBalance')}</span>;
  return (
    <div className="table-wrap table-framed">
      <table className="table table-compact">
        <thead>
          <tr>
            <th>{t('accounts.asset')}</th>
            <th className="num">{t('services.colTotal')}</th>
            <th className="num">{t('services.colOwn')}</th>
            <th className="num">{t('services.colShare')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const all = total.get(a.id) ?? 0;
            const mine = own.get(a.id) ?? 0;
            // a share only makes sense of a positive total that the own part fits into
            const share = all > 0 && mine >= 0 && mine <= all ? Math.round((mine / all) * 1000) / 10 : null;
            return (
              <tr key={a.id}>
                <td>
                  <span className="cell-link">
                    <AssetIcon asset={a} size={18} />
                    {a.code}
                  </span>
                </td>
                <td className="num">
                  <Money value={all} asset={a} />
                </td>
                <td className="num">{mine ? <Money value={mine} asset={a} /> : <span className="muted">—</span>}</td>
                <td className="num">{share === null ? <span className="muted">—</span> : `${share}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DeleteService({ service, onClose, onDeleted }: { service: Service; onClose: () => void; onDeleted?: () => void }) {
  const { t, tn } = useI18n();
  const data = useStore((s) => s.data);
  const accounts = getIndex(data).serviceAccounts.get(service.id) ?? [];
  return (
    <ConfirmDialog
      title={t('services.deleteTitle', { name: service.name })}
      text={accounts.length ? t('services.deleteUsed', { accounts: tn('counts.accounts', accounts.length) }) : t('common.cannotUndo')}
      onClose={onClose}
      onConfirm={() => {
        mutate((d) => deleteService(d, service.id));
        onDeleted?.();
      }}
    >
      {accounts.length > 0 && (
        <LinkList empty="" items={accounts.map((a) => ({ href: href.detail('accounts', a.id), label: a.name }))} />
      )}
    </ConfirmDialog>
  );
}

export function ServiceEditor({ service, onClose }: { service: Service | null; onClose: () => void }) {
  const { t, tn } = useI18n();
  const rules = useTextRules();
  const data = useStore((s) => s.data);
  const [name, setName] = useState(service?.name ?? '');
  const [image, setImage] = useState(service?.image ?? '');
  const [forms, setForms] = useState<FormId[]>(service?.forms ?? ['bank']);
  const [description, setDescription] = useState(service?.description ?? '');
  const [tried, setTried] = useState(false);

  const accounts = service ? (getIndex(data).serviceAccounts.get(service.id) ?? []) : [];
  const unlinked = accounts.filter((a) => !forms.includes(a.form)).length;

  const errors = {
    name: rules.required(name),
    image: rules.url(image),
    forms: forms.length ? null : t('services.formsRequired'),
    description: rules.optional(description),
  };
  const invalid = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (tried ? errors[k] : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    mutate(
      (d) =>
        saveService(
          d,
          { name: name.trim(), image: image.trim(), forms: SERVICE_FORMS.filter((f) => forms.includes(f)), description: description.trim() },
          service?.id,
        ).data,
    );
    onClose();
  };

  return (
    <Modal title={service ? t('services.edit') : t('services.new')} onClose={onClose} footer={<FormFooter onCancel={onClose} />}>
      <form id="entity-form" className="form" onSubmit={submit} noValidate>
        <NameField value={name} onChange={setName} error={err('name')} placeholder="Monobank, Binance…" />
        <ImageField value={image} onChange={setImage} error={err('image')} name={name} />
        <FormChecks
          forms={SERVICE_FORMS}
          value={forms}
          onChange={setForms}
          label={t('services.forms')}
          error={err('forms')}
          hint={unlinked ? t('services.formUnlink', { accounts: tn('counts.accounts', unlinked) }) : undefined}
        />
        <DescriptionField value={description} onChange={setDescription} error={err('description')} />
      </form>
    </Modal>
  );
}
