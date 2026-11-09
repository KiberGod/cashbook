import { useSyncExternalStore } from 'react';
import type { Template, Transaction } from '../lib/types';
import { getTabs } from './tabs';

/** transaction editor: id = edit, otherwise create with optional prefilled fields; templateId: the template the prefill came from */
export interface TxFormState {
  id?: string;
  prefill?: Partial<Transaction>;
  templateId?: string;
}
/** template editor: id = edit, otherwise create with optional prefilled fields */
export interface TemplateFormState {
  id?: string;
  prefill?: Partial<Template>;
}

/**
 * Dialogs that can be opened from any page (e.g. "+ transaction"). Each one belongs to the tab it
 * was opened in (keyed by the tab's id): another tab neither shows it nor loses it.
 */
export interface UiState {
  txForms: Record<string, TxFormState>;
  templateForms: Record<string, TemplateFormState>;
  toast: { text: string; at: number } | null;
}

let state: UiState = { txForms: {}, templateForms: {}, toast: null };
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

const without = <T,>(m: Record<string, T>, k: string) => Object.fromEntries(Object.entries(m).filter(([x]) => x !== k));

/** Opens the transaction editor in the active tab. */
export const openTxForm = (opts: TxFormState = {}) => set({ txForms: { ...state.txForms, [getTabs().active]: opts } });
/** Closes a tab's transaction editor (the active tab's by default). */
export const closeTxForm = (tab = getTabs().active) => set({ txForms: without(state.txForms, tab) });
/** Opens the template editor in the active tab. */
export const openTemplateForm = (opts: TemplateFormState = {}) => set({ templateForms: { ...state.templateForms, [getTabs().active]: opts } });
/** Closes a tab's template editor (the active tab's by default). */
export const closeTemplateForm = (tab = getTabs().active) => set({ templateForms: without(state.templateForms, tab) });

export function showToast(text: string) {
  set({ toast: { text, at: Date.now() } });
}
