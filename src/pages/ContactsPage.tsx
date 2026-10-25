import { useMemo, useState, type FormEvent } from 'react';
import { ActivityCalendar } from '../components/ActivityCalendar';
import { AssetAmounts, Avatar, CardMenu, EmptyState, Highlight, LinkList, Pagination, SearchField, Stat, usePaged } from '../components/bits';
import { DescriptionField, FormFooter, ImageField, NameField, useTextRules } from '../components/forms';
import { PageHead } from '../components/Layout';
import { ConfirmDialog, Modal } from '../components/Modal';
import { TxList } from '../components/TxList';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { deleteContact, saveContact } from '../lib/ops';
import { byName, matchesAny } from '../lib/search';
import { getIndex } from '../lib/stats';
import type { Contact } from '../lib/types';
import { href } from '../router';
import { mutate, useStore } from '../store/store';
import { AccountEditor } from './AccountsPage';
import { DebtEditor, DebtRow } from './DebtsPage';
import { NotFound } from './common';

export function ContactsPage() {
  const { t, tn, locale } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Contact | 'new' | null>(null);
  const [del, setDel] = useState<Contact | null>(null);

  const list = useMemo(
    () =>
      data.contacts
        .filter((c) => matchesAny(q, c.name))
        .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || byName<Contact>(locale)(a, b)),
    [data.contacts, q, locale],
  );
  const paged = usePaged(list, 'contacts', q);

  return (
    <>
      <PageHead
        title={t('nav.contacts')}
        icon={<Icon name="users" />}
        subtitle={t('contacts.subtitle')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={18} />
            {t('contacts.add')}
          </button>
        }
      />
      <div className="toolbar">
        <SearchField value={q} onChange={setQ} placeholder={t('contacts.search')} />
      </div>
      {list.length === 0 ? (
        <EmptyState icon="users" text={q ? t('common.nothingFound') : t('contacts.empty')} />
      ) : (
        <div className="rows">
          {paged.items.map((c) => {
            const s = ix.contact.get(c.id)!;
            return (
              <a key={c.id} className={`row ${c.isSelf ? 'row-self' : ''}`} href={href.detail('contacts', c.id)}>
                <Avatar image={c.image} name={c.name} size={40} />
                <div className="row-main">
                  <div className="row-title">
                    <Highlight text={c.name} query={q} />
                    {c.isSelf && <span className="badge badge-accent">{t('contacts.me')}</span>}
                  </div>
                  <div className="row-meta muted">
                    {tn('counts.accounts', s.accounts.length)} · {tn('counts.transactions', s.flow.tx)}
                    {s.debts.length > 0 && <> · {tn('counts.debts', s.debts.length)}</>}
                  </div>
                </div>
                <div className="row-side">
                  <AssetAmounts map={s.balances} assets={data.assets} />
                </div>
                <CardMenu
                  actions={[
                    { label: t('common.edit'), icon: 'edit', onSelect: () => setEdit(c) },
                    ...(c.isSelf ? [] : [{ label: t('common.delete'), icon: 'trash' as const, danger: true, onSelect: () => setDel(c) }]),
                  ]}
                />
              </a>
            );
          })}
        </div>
      )}
      <Pagination p={paged} />
      {edit && <ContactEditor contact={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {del && <DeleteContact contact={del} onClose={() => setDel(null)} />}
    </>
  );
}

export function ContactDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t, num, locale } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const contact = ix.contacts.get(id);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [addAccount, setAddAccount] = useState(false);
  const [addDebt, setAddDebt] = useState(false);
  const [q, setQ] = useState('');
  const s = ix.contact.get(id);
  const side = useMemo(() => new Set(s?.accounts.map((a) => a.id) ?? []), [s]);

  const txs = useMemo(() => {
    if (!s || !q) return s?.txs ?? [];
    return s.txs.filter((x) => {
      const f = ix.accounts.get(x.fromId);
      const to = ix.accounts.get(x.toId);
      return matchesAny(
        q,
        x.description,
        f?.name,
        to?.name,
        ix.contacts.get(f?.contactId ?? '')?.name,
        ix.contacts.get(to?.contactId ?? '')?.name,
        ix.categories.get(x.categoryId)?.name,
      );
    });
  }, [s, q, ix]);

  if (!contact || !s) return <NotFound />;
  const accounts = [...s.accounts].sort(byName(locale));

  return (
    <>
      <PageHead
        crumbs={[{ label: t('nav.contacts'), href: href.list('contacts') }]}
        title={contact.name}
        icon={<Avatar image={contact.image} name={contact.name} size={38} />}
        subtitle={contact.isSelf ? <span className="badge badge-accent">{t('contacts.meLong')}</span> : undefined}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setAddAccount(true)}>
              <Icon name="plus" size={18} />
              {t('accounts.add')}
            </button>
            <button type="button" className="btn" onClick={() => setAddDebt(true)}>
              <Icon name="handshake" size={18} />
              {t('debts.add')}
            </button>
            <button type="button" className="btn" onClick={() => setEdit(true)}>
              <Icon name="edit" size={18} />
              {t('common.edit')}
            </button>
            {!contact.isSelf && (
              <button type="button" className="btn btn-danger-ghost" onClick={() => setDel(true)}>
                <Icon name="trash" size={18} />
                {t('common.delete')}
              </button>
            )}
          </>
        }
      />
      {contact.description && <p className="muted pre detail-desc">{contact.description}</p>}

      <div className="stats-row">
        <Stat label={t('nav.accounts')} icon="wallet">
          {num(accounts.length)}
        </Stat>
        <Stat
          label={t('stats.transactions')}
          icon="swap"
          hint={t('stats.inOutInternal', { in: num(s.flow.txIn), out: num(s.flow.txOut), internal: num(s.flow.txInternal) })}
        >
          {num(s.flow.tx)}
        </Stat>
        <Stat label={t('stats.balance')} icon="coins">
          <AssetAmounts map={s.balances} assets={data.assets} />
        </Stat>
        <Stat label={t('stats.balanceWithDebts')} icon="handshake">
          <AssetAmounts map={s.balancesWithDebts} assets={data.assets} />
        </Stat>
      </div>
      <div className="stats-row">
        <Stat label={t('stats.received')} icon="arrowIn" hint={t('stats.receivedHint')}>
          <AssetAmounts map={s.flow.in} assets={data.assets} />
        </Stat>
        <Stat label={t('stats.sent')} icon="arrowOut" hint={t('stats.sentHint')}>
          <AssetAmounts map={s.flow.out} assets={data.assets} />
        </Stat>
        <Stat label={t('stats.internal')} icon="swap">
          <AssetAmounts map={s.flow.internal} assets={data.assets} />
        </Stat>
        <Stat label={t('stats.fees')} icon="fee">
          <AssetAmounts map={s.flow.fees} assets={data.assets} />
        </Stat>
      </div>
      <div className="stats-row">
        <Stat label={contact.isSelf ? t('debts.owedToMeShort') : t('debts.owedToMe', { name: contact.name })} icon="arrowIn">
          <AssetAmounts map={s.owedToMe} assets={data.assets} />
        </Stat>
        <Stat label={contact.isSelf ? t('debts.iOweShort') : t('debts.iOwe', { name: contact.name })} icon="arrowOut">
          <AssetAmounts map={s.iOwe} assets={data.assets} />
        </Stat>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>
            {t('nav.accounts')} <span className="count">{accounts.length}</span>
          </h2>
        </div>
        {accounts.length === 0 ? (
          <EmptyState icon="wallet" text={t('contacts.noAccounts')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('accounts.one')}</th>
                  <th>{t('accounts.balance')}</th>
                  <th className="num">{t('stats.txInOut')}</th>
                  <th>{t('stats.received')}</th>
                  <th>{t('stats.sent')}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const as = ix.account.get(a.id)!;
                  return (
                    <tr key={a.id}>
                      <td>
                        <a href={href.detail('accounts', a.id)}>{a.name}</a>
                        <div className="muted small">{t(`form.${a.form}`)}</div>
                      </td>
                      <td>
                        <AssetAmounts map={as.balances} assets={data.assets} keepZero />
                      </td>
                      <td className="num">
                        {num(as.flow.tx)}
                        <div className="muted small">
                          ↓{num(as.flow.txIn)} ↑{num(as.flow.txOut)}
                        </div>
                      </td>
                      <td>
                        <AssetAmounts map={as.flow.in} assets={data.assets} />
                      </td>
                      <td>
                        <AssetAmounts map={as.flow.out} assets={data.assets} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="detail-grid">
        <section className="panel panel-wide">
          <h2>{t('stats.activity')}</h2>
          <ActivityCalendar txs={s.txs} />
        </section>
        <section className="panel">
          <h2>
            {t('nav.debts')} <span className="count">{s.debts.length}</span>
          </h2>
          {s.debts.length === 0 ? (
            <p className="muted">{t('debts.none')}</p>
          ) : (
            <div className="rows rows-compact">
              {s.debts.map((d) => (
                <DebtRow key={d.id} d={d} />
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>
            {t('nav.transactions')} <span className="count">{s.txs.length}</span>
          </h2>
          <a className="btn btn-sm" href={href.transactions({ contact: id })}>
            {t('common.openAll')}
          </a>
        </div>
        <div className="toolbar">
          <SearchField value={q} onChange={setQ} placeholder={t('tx.search')} />
        </div>
        <TxList txs={txs} side={side} q={q} prefKey="contactTx" resetKey={`${id}|${q}`} />
      </section>

      {edit && <ContactEditor contact={contact} onClose={() => setEdit(false)} />}
      {del && <DeleteContact contact={contact} onClose={() => setDel(false)} onDeleted={() => (location.hash = href.list('contacts'))} />}
      {addAccount && <AccountEditor account={null} contactId={id} onClose={() => setAddAccount(false)} />}
      {addDebt && <DebtEditor debt={null} contactId={id} onClose={() => setAddDebt(false)} />}
    </>
  );
}

function DeleteContact({ contact, onClose, onDeleted }: { contact: Contact; onClose: () => void; onDeleted?: () => void }) {
  const { t, tn } = useI18n();
  const data = useStore((s) => s.data);
  const s = getIndex(data).contact.get(contact.id)!;
  if (s.debts.length) {
    return (
      <Modal
        title={t('contacts.cantDelete', { name: contact.name })}
        onClose={onClose}
        size="sm"
        footer={
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t('common.ok')}
          </button>
        }
      >
        <p className="muted">{t('contacts.hasDebts', { debts: tn('counts.debts', s.debts.length) })}</p>
        <LinkList empty="" items={s.debts.map((d) => ({ href: href.detail('debts', d.id), label: d.name }))} />
      </Modal>
    );
  }
  return (
    <ConfirmDialog
      title={t('contacts.deleteTitle', { name: contact.name })}
      text={s.accounts.length ? t('contacts.deleteDetach', { accounts: tn('counts.accounts', s.accounts.length) }) : t('common.cannotUndo')}
      onClose={onClose}
      onConfirm={() => {
        mutate((d) => deleteContact(d, contact.id));
        onDeleted?.();
      }}
    >
      {s.accounts.length > 0 && <LinkList empty="" items={s.accounts.map((a) => ({ href: href.detail('accounts', a.id), label: a.name }))} />}
    </ConfirmDialog>
  );
}

export function ContactEditor({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const { t } = useI18n();
  const rules = useTextRules();
  const [name, setName] = useState(contact?.name ?? '');
  const [image, setImage] = useState(contact?.image ?? '');
  const [description, setDescription] = useState(contact?.description ?? '');
  const [tried, setTried] = useState(false);
  const errors = { name: rules.required(name), image: rules.url(image), description: rules.optional(description) };
  const invalid = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (tried ? errors[k] : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    mutate((d) => saveContact(d, { name: name.trim(), image: image.trim(), description: description.trim() }, contact?.id).data);
    onClose();
  };

  return (
    <Modal title={contact ? t('contacts.edit') : t('contacts.new')} onClose={onClose} footer={<FormFooter onCancel={onClose} />}>
      <form id="entity-form" className="form" onSubmit={submit} noValidate>
        {contact?.isSelf && <p className="field-hint">{t('contacts.selfHint')}</p>}
        <NameField value={name} onChange={setName} error={err('name')} />
        <ImageField value={image} onChange={setImage} error={err('image')} name={name} />
        <DescriptionField value={description} onChange={setDescription} error={err('description')} />
      </form>
    </Modal>
  );
}
