import { createContext, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { useTab } from './Tabs';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** focus the first field on opening (otherwise the dialog itself, so Escape and Tab still work) */
  focusField?: boolean;
  /** a small control right after the title (e.g. the template of a new transaction) */
  headExtra?: ReactNode;
}

/**
 * Each dialog's own form id: a dialog's "save" button (in its footer) submits its form by id, and
 * dialogs of other tabs stay in the page (hidden), so a fixed id would reach another tab's form.
 */
const FormIdContext = createContext('');
export const useModalFormId = () => useContext(FormIdContext);

/** The dialog's form (its id is the dialog's own; see `ModalSubmit`). */
export function ModalForm({ onSubmit, className = 'form', children }: { onSubmit: (e: FormEvent) => void; className?: string; children: ReactNode }) {
  return (
    <form id={useModalFormId()} className={className} onSubmit={onSubmit} noValidate>
      {children}
    </form>
  );
}

/** A button in the dialog's footer that submits the dialog's own form. */
export function ModalSubmit(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'form'>) {
  return <button type="submit" form={useModalFormId()} {...props} />;
}

/** How many dialogs are shown (in the shown tab): the page under them does not scroll while any is. */
let shownDialogs = 0;
const lockScroll = (d: 1 | -1) => {
  shownDialogs = Math.max(0, shownDialogs + d);
  document.body.classList.toggle('no-scroll', shownDialogs > 0);
};

export function Modal({ title, onClose, children, footer, size = 'md', focusField = true, headExtra }: ModalProps) {
  const formId = useId();
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // a dialog of a tab that is not shown stays as it is (typed text and all), out of sight and inert
  const { active } = useTab();

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    // focus the first field, or the panel itself
    const first = focusField ? panel.current?.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=radio]), textarea, select') : null;
    (first ?? panel.current)?.focus();
    return () => prevFocus?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // only the top-most shown modal reacts
      const all = document.querySelectorAll('.modal-backdrop:not([hidden]) .modal');
      if (e.key === 'Escape' && all[all.length - 1] === panel.current) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    lockScroll(1);
    return () => {
      document.removeEventListener('keydown', onKey);
      // the page scrolls again once no shown dialog is left (closed, or its tab hidden)
      lockScroll(-1);
    };
  }, [active]);

  return createPortal(
    <FormIdContext.Provider value={formId}>
      <div className="modal-backdrop" hidden={!active} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
          <div className="modal-head">
            <h2>{title}</h2>
            {headExtra && <div className="modal-head-extra">{headExtra}</div>}
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
              <Icon name="close" />
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </FormIdContext.Provider>,
    document.body,
  );
}

interface ConfirmProps {
  title: string;
  text?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** the user must type exactly this phrase before confirming */
  phrase?: string;
  /** disables the confirm button (e.g. an unticked checkbox inside children) */
  blocked?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ title, text, children, confirmLabel, cancelLabel, danger = true, phrase, blocked, onConfirm, onClose }: ConfirmProps) {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  const ok = !blocked && (!phrase || typed.trim() === phrase);
  return (
    <Modal
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={!ok}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel ?? t('common.delete')}
          </button>
        </>
      }
    >
      <div className="confirm-body">
        {text && <p className="muted">{text}</p>}
        {children}
        {phrase && (
          <label className="field">
            <span className="field-label">{t('confirm.typePhrase')}</span>
            <code className="phrase">{phrase}</code>
            <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        )}
      </div>
    </Modal>
  );
}
