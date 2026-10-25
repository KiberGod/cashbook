import type { Account, Asset, Category, Contact, Data, Debt, Service, Transaction } from './types';

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

export type ServiceFields = Fields<Service>;

export function saveService(d: Data, f: ServiceFields, id?: string) {
  const { list, entity } = upsert(d.services, f, id);
  // an account keeps its service only while the service supports the account's form
  const accounts = d.accounts.map((a) =>
    a.serviceId === entity.id && !entity.forms.includes(a.form) ? { ...a, serviceId: '', updatedAt: now() } : a,
  );
  return { data: { ...d, services: list, accounts }, entity };
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

export type ContactFields = Omit<Fields<Contact>, 'isSelf'>;

export function saveContact(d: Data, f: ContactFields, id?: string) {
  const isSelf = id ? (d.contacts.find((c) => c.id === id)?.isSelf ?? false) : false;
  const { list, entity } = upsert(d.contacts, { ...f, isSelf }, id);
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

export type AccountFields = Fields<Account>;

/**
 * On update the form never changes and assets can only be added (crypto). A newly added
 * asset may get its starting balance; existing starting balances stay as they were.
 */
export function saveAccount(d: Data, f: AccountFields, id?: string) {
  let fields = f;
  if (id) {
    const old = d.accounts.find((a) => a.id === id)!;
    const added = f.assetIds.filter((x) => !old.assetIds.includes(x));
    const assetIds = old.form === 'crypto' ? [...old.assetIds, ...added] : old.assetIds;
    const initialBalances = { ...old.initialBalances };
    if (old.form === 'crypto') for (const x of added) initialBalances[x] = f.initialBalances[x] ?? 0;
    fields = { ...f, form: old.form, assetIds, initialBalances };
  }
  if (fields.form === 'cash') fields = { ...fields, serviceId: '', requisite: '' };
  const { list, entity } = upsert(d.accounts, fields, id);
  return { data: { ...d, accounts: list }, entity };
}

/** Deletes the account together with every transaction it takes part in. */
export function deleteAccount(d: Data, id: string): Data {
  return {
    ...d,
    accounts: d.accounts.filter((a) => a.id !== id),
    transactions: d.transactions.filter((t) => t.fromId !== id && t.toId !== id),
  };
}

// ---- categories ----

export type CategoryFields = Fields<Category>;

export function saveCategory(d: Data, f: CategoryFields, id?: string) {
  const { list, entity } = upsert(d.categories, f, id);
  return { data: { ...d, categories: list }, entity };
}

/** Deletes the category with its sub-categories; their transactions stay, without a category. */
export function deleteCategory(d: Data, id: string): Data {
  const gone = new Set([id, ...d.categories.filter((c) => c.parentId === id).map((c) => c.id)]);
  const t = now();
  return {
    ...d,
    categories: d.categories.filter((c) => !gone.has(c.id)),
    transactions: d.transactions.map((x) => (gone.has(x.categoryId) ? { ...x, categoryId: '', updatedAt: t } : x)),
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

/** The debt's transactions stay, just no longer linked to it. */
export function deleteDebt(d: Data, id: string): Data {
  const t = now();
  return {
    ...d,
    debts: d.debts.filter((x) => x.id !== id),
    transactions: d.transactions.map((x) => (x.debtId === id ? { ...x, debtId: '', updatedAt: t } : x)),
  };
}
