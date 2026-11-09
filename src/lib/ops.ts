import type { Account, Asset, Category, Contact, Data, Debt, Service, Template, Transaction } from './types';

/**
 * Pure data operations: every function returns a new Data and never mutates.
 * The store diffs the result by object identity to know which rows to write,
 * and all statistics are recomputed from the new Data (lib/stats.ts), so no
 * derived value can get out of sync.
 */

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

const now = () => new Date().toISOString();

type Fields<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;

/** Creates (no id) or updates (id) an entity in a list, maintaining timestamps. */
function upsert<T extends { id: string; createdAt: string; updatedAt: string }>(
  list: T[],
  fields: Fields<T>,
  id?: string,
): { list: T[]; entity: T } {
  const t = now();
  if (!id) {
    const entity = { ...fields, id: newId(), createdAt: t, updatedAt: t } as T;
    return { list: [...list, entity], entity };
  }
  let entity = list.find((x) => x.id === id)!;
  entity = { ...entity, ...fields, id, updatedAt: t };
  return { list: list.map((x) => (x.id === id ? entity : x)), entity };
}

// ---- assets ----

export type AssetFields = Fields<Asset>;

export function saveAsset(d: Data, f: AssetFields, id?: string) {
  const { list, entity } = upsert(d.assets, f, id);
  return { data: { ...d, assets: list }, entity };
}

/** Only for unused assets - the UI checks usage first. */
export const deleteAsset = (d: Data, id: string): Data => ({ ...d, assets: d.assets.filter((a) => a.id !== id) });

// ---- services ----

export type ServiceFields = Omit<Fields<Service>, 'order'>;

/** A new service goes to the end of the list; an edited one keeps its position. */
export function saveService(d: Data, f: ServiceFields, id?: string) {
  const order = id ? d.services.find((s) => s.id === id)!.order : Math.max(-1, ...d.services.map((s) => s.order)) + 1;
  const { list, entity } = upsert(d.services, { ...f, order }, id);
  // an account keeps its service only while the service supports the account's form
  const accounts = d.accounts.map((a) =>
    a.serviceId === entity.id && !entity.forms.includes(a.form) ? { ...a, serviceId: '', updatedAt: now() } : a,
  );
  return { data: { ...d, services: list, accounts }, entity };
}

/** Services in the user's order. */
export const servicesInOrder = (list: Service[]) => [...list].sort((a, b) => a.order - b.order);

/** Moves a service to the place of another one; positions are renumbered, only changed rows are rewritten. */
export function moveService(d: Data, id: string, overId: string): Data {
  const list = servicesInOrder(d.services);
  const from = list.findIndex((s) => s.id === id);
  const to = list.findIndex((s) => s.id === overId);
  if (from < 0 || to < 0 || from === to) return d;
  list.splice(to, 0, ...list.splice(from, 1));
  const t = now();
  const moved = new Map(list.map((s, i) => [s.id, s.order === i ? s : { ...s, order: i, updatedAt: t }]));
  return { ...d, services: d.services.map((s) => moved.get(s.id)!) };
}

/** Accounts using the service just lose the link. */
export function deleteService(d: Data, id: string): Data {
  const t = now();
  return {
    ...d,
    services: d.services.filter((s) => s.id !== id),
    accounts: d.accounts.map((a) => (a.serviceId === id ? { ...a, serviceId: '', updatedAt: t } : a)),
  };
}

// ---- contacts ----

/** what the editor sets; "it's you" and the accounts' order on its page are kept as they are */
export type ContactFields = Omit<Fields<Contact>, 'isSelf' | 'accountOrder'>;

export function saveContact(d: Data, f: ContactFields, id?: string) {
  const old = id ? d.contacts.find((c) => c.id === id) : undefined;
  const { list, entity } = upsert(d.contacts, { ...f, isSelf: old?.isSelf ?? false, accountOrder: old?.accountOrder ?? [] }, id);
  return { data: { ...d, contacts: list }, entity };
}

/** Accounts are detached from the contact. Not allowed for the own contact or with debts (UI checks). */
export function deleteContact(d: Data, id: string): Data {
  const t = now();
  return {
    ...d,
    contacts: d.contacts.filter((c) => c.id !== id),
    accounts: d.accounts.map((a) => (a.contactId === id ? { ...a, contactId: '', updatedAt: t } : a)),
  };
}

// ---- accounts ----

/** what the editor sets; the order comes from the list, the corrections from adjustBalances */
export type AccountFields = Omit<Fields<Account>, 'order' | 'adjustments'>;

/**
 * On update the form never changes and assets can only be added (crypto). A newly added
 * asset may get its starting balance; existing starting balances stay as they were.
 */
export function saveAccount(d: Data, f: AccountFields, id?: string) {
  // a new account goes to the end of the list, an edited one keeps its place
  const old = id ? d.accounts.find((a) => a.id === id) : undefined;
  let fields: Fields<Account> = {
    ...f,
    order: old ? old.order : Math.max(-1, ...d.accounts.map((a) => a.order)) + 1,
    adjustments: old ? old.adjustments : [],
  };
  if (old) {
    const added = f.assetIds.filter((x) => !old.assetIds.includes(x));
    const assetIds = old.form === 'crypto' ? [...old.assetIds, ...added] : old.assetIds;
    const initialBalances = { ...old.initialBalances };
    if (old.form === 'crypto') for (const x of added) initialBalances[x] = f.initialBalances[x] ?? 0;
    fields = { ...fields, form: old.form, assetIds, initialBalances };
  }
  if (fields.form === 'cash') fields = { ...fields, serviceId: '', requisite: '' };
  const { list, entity } = upsert(d.accounts, fields, id);
  return { data: { ...d, accounts: list }, entity };
}

/**
 * Balance correction: each asset's balance moves by its difference from now on (a dated step in
 * the account's history); the starting balances and the transactions stay as they are.
 */
export function adjustBalances(d: Data, id: string, deltas: Record<string, number>): Data {
  const t = now();
  return {
    ...d,
    accounts: d.accounts.map((a) => {
      if (a.id !== id) return a;
      const added = a.assetIds.filter((x) => deltas[x]).map((x) => ({ date: t, assetId: x, delta: deltas[x] }));
      return added.length ? { ...a, adjustments: [...a.adjustments, ...added], updatedAt: t } : a;
    }),
  };
}

export const accountsInOrder = (list: Account[]) => [...list].sort((a, b) => a.order - b.order);

/** A contact's accounts in its own order: the ones it has placed first, the rest in the list's order. */
export function contactAccountsInOrder(contact: Contact, accounts: Account[]): Account[] {
  const mine = accountsInOrder(accounts.filter((a) => a.contactId === contact.id));
  const at = new Map(contact.accountOrder.map((id, i) => [id, i]));
  return mine.sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity));
}

/** Drag and drop on a contact's page: its accounts' own order changes, the accounts list's does not. */
export function moveContactAccount(d: Data, contactId: string, id: string, overId: string): Data {
  const contact = d.contacts.find((c) => c.id === contactId);
  if (!contact) return d;
  const ids = contactAccountsInOrder(contact, d.accounts).map((a) => a.id);
  const from = ids.indexOf(id);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return d;
  ids.splice(to, 0, ...ids.splice(from, 1));
  const t = now();
  return { ...d, contacts: d.contacts.map((c) => (c.id === contactId ? { ...c, accountOrder: ids, updatedAt: t } : c)) };
}

/** Moves an account to where another one is and renumbers; only accounts whose place changed are rewritten. */
export function moveAccount(d: Data, id: string, overId: string): Data {
  const list = accountsInOrder(d.accounts);
  const from = list.findIndex((a) => a.id === id);
  const to = list.findIndex((a) => a.id === overId);
  if (from < 0 || to < 0 || from === to) return d;
  list.splice(to, 0, ...list.splice(from, 1));
  const t = now();
  const moved = new Map(list.map((a, i) => [a.id, a.order === i ? a : { ...a, order: i, updatedAt: t }]));
  return { ...d, accounts: d.accounts.map((a) => moved.get(a.id)!) };
}

/**
 * Deletes the account together with every transaction it takes part in. Templates stay, with
 * that side left empty (and without a fee when it was the sender).
 */
export function deleteAccount(d: Data, id: string): Data {
  const t = now();
  return {
    ...d,
    accounts: d.accounts.filter((a) => a.id !== id),
    // out of its contact's own order too
    contacts: d.contacts.map((c) => (c.accountOrder.includes(id) ? { ...c, accountOrder: c.accountOrder.filter((x) => x !== id), updatedAt: t } : c)),
    transactions: d.transactions.filter((x) => x.fromId !== id && x.toId !== id),
    templates: d.templates.map((x) =>
      x.fromId === id
        ? { ...x, fromId: '', fee: null, feeAssetId: x.assetId, updatedAt: t }
        : x.toId === id
          ? { ...x, toId: '', updatedAt: t }
          : x,
    ),
  };
}

// ---- categories ----

export type CategoryFields = Omit<Fields<Category>, 'order'>;

const byOrder = (a: Category, b: Category) => a.order - b.order;
const siblings = (list: Category[], parentId: string) => list.filter((c) => c.parentId === parentId).sort(byOrder);

/** A new category, or one moved under another parent, goes to the end of its siblings; otherwise it keeps its place. */
export function saveCategory(d: Data, f: CategoryFields, id?: string) {
  const old = id ? d.categories.find((c) => c.id === id) : undefined;
  const order = old && old.parentId === f.parentId ? old.order : Math.max(-1, ...siblings(d.categories, f.parentId).map((c) => c.order)) + 1;
  const { list, entity } = upsert(d.categories, { ...f, order }, id);
  return { data: { ...d, categories: list }, entity };
}

/** Root categories in their order, each with its sub-categories in theirs. */
export function categoryTree(list: Category[]): { root: Category; children: Category[] }[] {
  return siblings(list, '').map((root) => ({ root, children: siblings(list, root.id) }));
}

/** The tree flattened: every root followed by its sub-categories. */
export const categoriesInOrder = (list: Category[]) => categoryTree(list).flatMap((n) => [n.root, ...n.children]);

/**
 * Puts a category at `index` among the children of `parentId` ('' = the roots) and renumbers
 * the lists it left and entered. The level never changes: roots stay roots, sub-categories
 * only move between roots.
 */
export function moveCategory(d: Data, id: string, parentId: string, index: number): Data {
  const cat = d.categories.find((c) => c.id === id);
  if (!cat || !cat.parentId !== !parentId) return d;
  if (parentId && !d.categories.some((c) => c.id === parentId && !c.parentId)) return d;
  const target = siblings(d.categories, parentId).filter((c) => c.id !== id);
  target.splice(Math.max(0, Math.min(index, target.length)), 0, cat);
  const source = cat.parentId === parentId ? [] : siblings(d.categories, cat.parentId).filter((c) => c.id !== id);
  const t = now();
  const changed = new Map<string, Category>();
  const place = (list: Category[], parent: string) =>
    list.forEach((c, i) => {
      if (c.order !== i || c.parentId !== parent) changed.set(c.id, { ...c, order: i, parentId: parent, updatedAt: t });
    });
  place(target, parentId);
  place(source, cat.parentId);
  return changed.size ? { ...d, categories: d.categories.map((c) => changed.get(c.id) ?? c) } : d;
}

/** Deletes the category with its sub-categories; their transactions and templates stay, without a category. */
export function deleteCategory(d: Data, id: string): Data {
  const gone = new Set([id, ...d.categories.filter((c) => c.parentId === id).map((c) => c.id)]);
  const t = now();
  return {
    ...d,
    categories: d.categories.filter((c) => !gone.has(c.id)),
    transactions: d.transactions.map((x) => (gone.has(x.categoryId) ? { ...x, categoryId: '', updatedAt: t } : x)),
    templates: d.templates.map((x) => (gone.has(x.categoryId) ? { ...x, categoryId: '', updatedAt: t } : x)),
  };
}

// ---- transactions ----

export type TransactionFields = Fields<Transaction>;

export function saveTransaction(d: Data, f: TransactionFields, id?: string) {
  const { list, entity } = upsert(d.transactions, f, id);
  return { data: { ...d, transactions: list }, entity };
}

export const deleteTransaction = (d: Data, id: string): Data => ({
  ...d,
  transactions: d.transactions.filter((t) => t.id !== id),
});

// ---- debts ----

export type DebtFields = Fields<Debt>;

export function saveDebt(d: Data, f: DebtFields, id?: string) {
  const { list, entity } = upsert(d.debts, f, id);
  return { data: { ...d, debts: list }, entity };
}

/** The debt's transactions and templates stay, just no longer linked to it. */
export function deleteDebt(d: Data, id: string): Data {
  const t = now();
  return {
    ...d,
    debts: d.debts.filter((x) => x.id !== id),
    transactions: d.transactions.map((x) => (x.debtId === id ? { ...x, debtId: '', updatedAt: t } : x)),
    templates: d.templates.map((x) => (x.debtId === id ? { ...x, debtId: '', updatedAt: t } : x)),
  };
}

// ---- templates ----

export type TemplateFields = Omit<Fields<Template>, 'order'>;

/** A new template goes to the end of the list, an edited one keeps its place. */
export function saveTemplate(d: Data, f: TemplateFields, id?: string) {
  const order = id ? d.templates.find((x) => x.id === id)!.order : Math.max(-1, ...d.templates.map((x) => x.order)) + 1;
  const { list, entity } = upsert(d.templates, { ...f, order }, id);
  return { data: { ...d, templates: list }, entity };
}

export const templatesInOrder = (list: Template[]) => [...list].sort((a, b) => a.order - b.order);

/** Moves a template to where another one is and renumbers; only templates whose place changed are rewritten. */
export function moveTemplate(d: Data, id: string, overId: string): Data {
  const list = templatesInOrder(d.templates);
  const from = list.findIndex((x) => x.id === id);
  const to = list.findIndex((x) => x.id === overId);
  if (from < 0 || to < 0 || from === to) return d;
  list.splice(to, 0, ...list.splice(from, 1));
  const t = now();
  const moved = new Map(list.map((x, i) => [x.id, x.order === i ? x : { ...x, order: i, updatedAt: t }]));
  return { ...d, templates: d.templates.map((x) => moved.get(x.id)!) };
}

export const deleteTemplate = (d: Data, id: string): Data => ({ ...d, templates: d.templates.filter((x) => x.id !== id) });

/** What a new transaction made from the template starts with (the date is now). */
export function templatePrefill(x: Template): Partial<Transaction> {
  return {
    fromId: x.fromId,
    toId: x.toId,
    assetId: x.assetId,
    ...(x.amount !== null ? { amount: x.amount } : {}),
    fee: x.fee,
    feeAssetId: x.feeAssetId,
    categoryId: x.categoryId,
    debtId: x.debtId,
    description: x.description,
  };
}
