import { useSyncExternalStore } from 'react';
import type { Transaction } from '../lib/types';

/** App-wide dialogs that can be opened from any page (e.g. the "+ transaction" button). */
export interface UiState {
  /** transaction editor: id = edit, otherwise create with optional prefilled fields */
  txForm: { id?: string; prefill?: Partial<Transaction> } | null;
  toast: { text: string; at: number } | null;
}

let state: UiState = { txForm: null, toast: null };
const listeners = new Set<() => void>();

function set(patch: Partial<UiState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

export const openTxForm = (opts: { id?: string; prefill?: Partial<Transaction> } = {}) => set({ txForm: opts });
export const closeTxForm = () => set({ txForm: null });

export function showToast(text: string) {
  set({ toast: { text, at: Date.now() } });
}
