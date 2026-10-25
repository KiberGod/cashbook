import { useState, type FormEvent, type ReactNode } from 'react';
import { AgreeCheck, DontTouchNote, KeyInput, NewKeyFields, useNewKey } from '../components/KeyFields';
import { Logo } from '../components/Layout';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import type { DictKey } from '../i18n/en';
import type { AppError } from '../lib/errors';
import { settings } from '../lib/storage';
import { APP_VERSION } from '../lib/version';
import { connect, disconnect, reload, setupSpreadsheet, signIn, unlock, useStore } from '../store/store';
import { LanguageSwitch } from './SettingsPage';

const MAX_ISSUES = 10;

function GateShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="gate">
      <div className="gate-top">
        <LanguageSwitch />
      </div>
      <div className={`gate-card ${wide ? 'gate-card-wide' : ''}`}>
        <div className="gate-brand">
          <Logo />
          <span>Cashbook</span>
        </div>
        {children}
      </div>
      <p className="gate-version">Cashbook v{APP_VERSION}</p>
    </div>
  );
}

/** Screen heading with the connected spreadsheet's name beside it. */
function GateTitle({ title, sheet, icon }: { title: string; sheet?: string; icon?: ReactNode }) {
  return (
    <div className="gate-title">
      <div className="gate-title-main">
        {icon && <span className="gate-icon">{icon}</span>}
        <h1>{title}</h1>
      </div>
      {sheet && (
        <span className="sheet-chip" title={sheet}>
          <Icon name="table" size={15} />
          <span>{sheet}</span>
        </span>
      )}
    </div>
  );
}

export function ErrorDetails({ error }: { error: AppError }) {
  const { t } = useI18n();
  const issues = error.issues;
  return (
    <div className="error-box" role="alert">
      <Icon name="alert" />
      <div>
        <p>{t(`error.${error.code}` as DictKey, { message: error.message })}</p>
        {issues.length > 0 && (
          <ul>
            {issues.slice(0, MAX_ISSUES).map((i, n) => (
              <li key={n}>{t(`issue.${i.code}` as DictKey, { sheet: i.sheet, row: i.row ?? '', value: i.value ?? '' })}</li>
            ))}
            {issues.length > MAX_ISSUES && <li>{t('issue.more', { n: issues.length - MAX_ISSUES })}</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ConnectScreen() {
  const { t } = useI18n();
  const error = useStore((s) => s.error);
  const busy = useStore((s) => s.refreshing);
  const [link, setLink] = useState('');
  const [recent, setRecent] = useState(settings.getRecent);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void connect(link); // runs inside the click/submit gesture, so the Google popup is allowed
  };

  return (
    <GateShell>
      <h1>{t('connect.title')}</h1>
      <p className="muted">{t('connect.subtitle')}</p>
      <ol className="steps">
        <li>{t('connect.step1')}</li>
        <li>{t('connect.step2')}</li>
        <li>{t('connect.step3')}</li>
      </ol>
      <form onSubmit={submit} className="form" noValidate>
        <label className="field">
          <span className="field-label">{t('connect.label')}</span>
          <input
            type="text"
            inputMode="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={t('connect.placeholder')}
            autoComplete="off"
            required
          />
        </label>
        {error && <ErrorDetails error={error} />}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !link.trim()}>
          {busy ? <span className="spinner" /> : <GoogleMark />}
          {busy ? t('connect.connecting') : t('connect.button')}
        </button>
      </form>
      {recent.length > 0 && (
        <div className="recent">
          <p className="field-label">{t('connect.recent')}</p>
          <ul>
            {recent.map((r) => (
              <li key={r.id}>
                <button type="button" className="recent-item" disabled={busy} onClick={() => void connect(r.url)}>
                  <Icon name="table" size={18} />
                  <span>{r.title || r.id}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('connect.forget')}
                  title={t('connect.forget')}
                  onClick={() => {
                    settings.forgetRecent(r.id);
                    setRecent(settings.getRecent());
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GateShell>
  );
}

export function AuthScreen() {
  const { t } = useI18n();
  const title = useStore((s) => s.title);
  const error = useStore((s) => s.error);
  const [busy, setBusy] = useState(false);
  const go = () => {
    setBusy(true);
    void signIn().finally(() => setBusy(false));
  };
  return (
    <GateShell wide>
      <GateTitle title={t('auth.title')} sheet={title} />
      <p className="muted">{t('auth.text')}</p>
      {error && <ErrorDetails error={error} />}
      <div className="form">
        <button type="button" className="btn btn-primary btn-block" onClick={go} disabled={busy}>
          {busy ? <span className="spinner" /> : <GoogleMark />}
          {t('auth.button')}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => void disconnect()}>
          {t('auth.other')}
        </button>
      </div>
    </GateShell>
  );
}

export function UnlockScreen() {
  const { t } = useI18n();
  const title = useStore((s) => s.title);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key) return;
    setBusy(true);
    setWrong(false);
    const ok = await unlock(key);
    setBusy(false);
    if (!ok) setWrong(true);
  };

  return (
    <GateShell wide>
      <GateTitle title={t('unlock.title')} sheet={title} icon={<Icon name="lock" size={22} />} />
      <p className="muted">{t('unlock.text')}</p>
      <form className="form" onSubmit={submit} noValidate>
        <KeyInput value={key} onChange={(v) => (setKey(v), setWrong(false))} label={t('unlock.label')} autoFocus error={wrong ? t('unlock.wrong') : null} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !key}>
          {busy ? <span className="spinner" /> : <Icon name="unlock" size={18} />}
          {busy ? t('unlock.checking') : t('unlock.button')}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => void disconnect()}>
          {t('auth.other')}
        </button>
      </form>
    </GateShell>
  );
}

export function SetupScreen() {
  const { t, lang } = useI18n();
  const title = useStore((s) => s.title);
  const busy = useStore((s) => s.refreshing);
  const error = useStore((s) => s.error);
  const [mode, setMode] = useState<'choose' | 'encrypt' | 'plain'>('choose');
  const newKey = useNewKey();
  const canCreate = mode === 'plain' ? newKey.agree : newKey.valid;

  const create = (e: FormEvent) => {
    e.preventDefault();
    newKey.setTouched(true);
    if (!canCreate) return;
    void setupSpreadsheet(mode === 'encrypt' ? newKey.key : null, lang);
  };

  return (
    <GateShell wide>
      <GateTitle title={t('setup.title')} sheet={title} />
      <p className="muted">{t('setup.text')}</p>

      {mode === 'choose' && (
        <div className="choice-list">
          <button type="button" className="choice choice-recommended" onClick={() => setMode('encrypt')}>
            <span className="choice-icon">
              <Icon name="shield" size={22} />
            </span>
            <span>
              <strong>
                {t('setup.encrypt')} <span className="badge badge-accent">{t('setup.recommended')}</span>
              </strong>
              <span className="muted">{t('setup.encryptText')}</span>
            </span>
          </button>
          <button type="button" className="choice" onClick={() => setMode('plain')}>
            <span className="choice-icon">
              <Icon name="unlock" size={22} />
            </span>
            <span>
              <strong>{t('setup.plain')}</strong>
              <span className="muted">{t('setup.plainText')}</span>
            </span>
          </button>
        </div>
      )}

      {mode !== 'choose' && (
        <form className="form" onSubmit={create} noValidate>
          {mode === 'encrypt' ? (
            <NewKeyFields state={newKey} />
          ) : (
            <>
              <div className="info-box">
                <Icon name="info" />
                <p>{t('setup.plainWarn')}</p>
              </div>
              <DontTouchNote />
              <AgreeCheck checked={newKey.agree} onChange={newKey.setAgree} />
            </>
          )}
          {error && <ErrorDetails error={error} />}
          <div className="button-row">
            <button type="button" className="btn" onClick={() => setMode('choose')} disabled={busy}>
              <Icon name="back" size={18} />
              {t('common.back')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !canCreate}>
              {busy ? <span className="spinner" /> : <Icon name="check" size={18} />}
              {busy ? t('setup.creating') : t('setup.create')}
            </button>
          </div>
        </form>
      )}

      <button type="button" className="btn btn-ghost btn-block" onClick={() => void disconnect()} disabled={busy}>
        {t('auth.other')}
      </button>
    </GateShell>
  );
}

export function ErrorScreen({ error }: { error: AppError }) {
  const { t } = useI18n();
  return (
    <GateShell wide>
      <h1>{t('error.title')}</h1>
      <ErrorDetails error={error} />
      <div className="form">
        <button type="button" className="btn btn-primary btn-block" onClick={() => void reload({ initial: true })}>
          <Icon name="refresh" size={18} />
          {t('common.retry')}
        </button>
        <button type="button" className="btn btn-block" onClick={() => void disconnect()}>
          <Icon name="link" size={18} />
          {t('error.reconnect')}
        </button>
      </div>
    </GateShell>
  );
}

export function LoadingScreen() {
  const { t } = useI18n();
  return (
    <div className="loading-screen" role="status">
      <span className="spinner spinner-lg" />
      <p className="muted">{t('loading')}</p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
