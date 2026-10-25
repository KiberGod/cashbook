import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ title, onClose, children, footer, size = 'md' }: ModalProps) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      // only the top-most modal reacts
      const all = document.querySelectorAll('.modal');
      if (e.key === 'Escape' && all[all.length - 1] === panel.current) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    // focus the first field, or the panel itself
    const first = panel.current?.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=radio]), textarea, select');
    (first ?? panel.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      if (document.querySelectorAll('.modal').length <= 1) document.body.classList.remove('no-scroll');
      prevFocus?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
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
