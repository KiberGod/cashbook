import { useState, type ReactNode } from 'react';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { KEY_MAX, KEY_MIN, checkKeyFormat } from '../lib/crypto';

export function KeyInput({
  value,
  onChange,
  label,
  autoFocus,
  error,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoFocus?: boolean;
  error?: string | null;
  hint?: ReactNode;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="key-input">
        <input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={autoFocus}
          maxLength={64}
        />
        <button type="button" className="icon-btn" onClick={() => setShown((s) => !s)} aria-label={shown ? t('key.hide') : t('key.show')}>
          <Icon name={shown ? 'eyeOff' : 'eye'} size={18} />
        </button>
      </span>
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** State of the "new encryption key" form: responsibility checkbox + key entered twice. */
export function useNewKey() {
  const [agree, setAgree] = useState(false);
  const [key, setKey] = useState('');
  const [repeat, setRepeat] = useState('');
  const [touched, setTouched] = useState(false);
  const problem = checkKeyFormat(key);
  return { agree, setAgree, key, setKey, repeat, setRepeat, touched, setTouched, problem, valid: agree && !problem && key === repeat };
}

/** Loss warning, responsibility checkbox, the key twice and the hint to save it. */
export function NewKeyFields({ state }: { state: ReturnType<typeof useNewKey> }) {
  const { t } = useI18n();
  const { agree, setAgree, key, setKey, repeat, setRepeat, touched, setTouched, problem } = state;
  const keyError = key && problem ? t(`key.${problem}`, { min: KEY_MIN, max: KEY_MAX }) : null;
  const repeatError = touched && repeat && repeat !== key ? t('key.mismatch') : null;
  return (
    <>
      <div className="warn-box">
        <Icon name="alert" />
        <div>
          <strong>{t('setup.warnTitle')}</strong>
          <p>{t('setup.warnText')}</p>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>{t('setup.agree')}</span>
      </label>
      <fieldset className="key-fields" disabled={!agree}>
        <KeyInput value={key} onChange={setKey} label={t('setup.key')} error={keyError} hint={t('key.rules', { min: KEY_MIN, max: KEY_MAX })} />
        <KeyInput value={repeat} onChange={(v) => (setRepeat(v), setTouched(true))} label={t('setup.repeat')} error={repeatError} />
        <p className="field-hint key-save-hint">
          <Icon name="key" size={14} /> {t('setup.saveHint')}
        </p>
      </fieldset>
    </>
  );
}
