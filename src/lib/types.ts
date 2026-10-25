/**
 * Domain model. Every entity is linked to others by id only; derived values
 * (balances, turnover, debt remainders, statistics) are never stored - they are
 * computed from these records in lib/stats.ts.
 */

/** Forms of money. Fixed by the system, never stored in the spreadsheet. */
export type FormId = 'cash' | 'bank' | 'crypto';
export const FORMS: FormId[] = ['cash', 'bank', 'crypto'];
/** Only these forms can be attached to a financial service. */
export const SERVICE_FORMS: FormId[] = ['bank', 'crypto'];

interface Timestamps {
  /** ISO date-time, set by the app */
  createdAt: string;
  updatedAt: string;
}

export interface Asset extends Timestamps {
  id: string;
  name: string;
  description: string;
  code: string;
  /** text symbol (₴, $) - used when no image is set */
  symbol: string;
  /** picture: https://… or builtin:<slug> */
  image: string;
  /** digits after the decimal point for display and input */
  decimals: number;
  forms: FormId[];
}

export interface Service extends Timestamps {
  id: string;
  name: string;
  description: string;
  image: string;
  /** subset of SERVICE_FORMS */
  forms: FormId[];
}

export interface Contact extends Timestamps {
  id: string;
  name: string;
  description: string;
  image: string;
  /** the user's own contact - exactly one, cannot be deleted */
  isSelf: boolean;
}

export interface Account extends Timestamps {
  id: string;
  name: string;
  description: string;
  form: FormId;
  /** one asset for cash/bank; one or more for crypto (assets can be added later, never removed) */
  assetIds: string[];
  /** starting balance per asset, set once at creation */
  initialBalances: Record<string, number>;
  /** public requisite: card / IBAN / wallet address (not for cash) */
  requisite: string;
  contactId: string;
  serviceId: string;
}

export interface Category extends Timestamps {
  id: string;
  name: string;
  description: string;
  image: string;
  /** '' for a root (1st level) category */
  parentId: string;
}

export interface Transaction extends Timestamps {
  id: string;
  /** when it actually happened (ISO date-time), chosen by the user */
  date: string;
  /** sender account - '' when not tracked */
  fromId: string;
  /** receiver account - '' when not tracked (but never both empty) */
  toId: string;
  assetId: string;
  amount: number;
  /** null = no fee; only possible with a sender, paid on top of the amount */
  fee: number | null;
  /** same as assetId except for crypto, where the fee may be paid in another asset */
  feeAssetId: string;
  categoryId: string;
  /** the debt this transaction changes ('' = none) */
  debtId: string;
  description: string;
}

export interface Debt extends Timestamps {
  id: string;
  name: string;
  description: string;
  assetId: string;
  /** contact who owes */
  debtorId: string;
  /** contact who is owed */
  creditorId: string;
  /** amount at creation; later changes come only from linked transactions */
  amount: number;
}

export interface Data {
  assets: Asset[];
  services: Service[];
  contacts: Contact[];
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  debts: Debt[];
}

export type EntityKind = keyof Data;
export const ENTITY_KINDS: EntityKind[] = ['assets', 'services', 'contacts', 'accounts', 'categories', 'transactions', 'debts'];

export const EMPTY_DATA: Data = {
  assets: [],
  services: [],
  contacts: [],
  accounts: [],
  categories: [],
  transactions: [],
  debts: [],
};

export const LIMITS = {
  name: 30,
  code: 30,
  symbol: 8,
  description: 1000,
  requisite: 120,
  url: 2000,
  maxDecimals: 12,
} as const;
