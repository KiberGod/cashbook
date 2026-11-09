import { useEffect, useState, type ComponentType, type FormEvent } from 'react';
import { Segmented } from '../components/bits';
import { KeyInput, NewKeyFields, useNewKey } from '../components/KeyFields';
import { PageHead, SheetsMark } from '../components/Layout';
import { ConfirmDialog, Modal } from '../components/Modal';
import { BrandIcon, Icon } from '../icons/ui';
import { LANGUAGES, useI18n, type Lang } from '../i18n';
import { toAppError, type AppError } from '../lib/errors';
import { settings } from '../lib/storage';
import { ACCENTS, getAccent, getThemePref, setAccent, setThemePref, type Accent, type ThemePref } from '../lib/theme';
import { APP_VERSION } from '../lib/version';
import { disconnect, logout, reload, setEncryption, useStore, verifyKey } from '../store/store';
import { showToast } from '../store/ui';
import { ErrorDetails } from './GateScreens';

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <Segmented<Lang>
      label={t('settings.language')}
      value={lang}
      onChange={setLang}
      options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
    />
  );
}

function ThemeSwitch() {
  const { t } = useI18n();
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  return (
    <Segmented<ThemePref>
      label={t('settings.theme')}
      value={pref}
      onChange={(o) => {
        setThemePref(o);
        setPref(o);
      }}
      options={(['system', 'light', 'dark'] as const).map((o) => ({ value: o, label: t(`theme.${o}`) }))}
    />
  );
}

function AccentPicker() {
  const { t } = useI18n();
  const [accent, setValue] = useState<Accent>(getAccent);
  return (
    <div className="swatches" role="radiogroup" aria-label={t('settings.accent')}>
      {ACCENTS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={a === accent}
          aria-label={t(`accent.${a}`)}
          title={t(`accent.${a}`)}
          className={`swatch swatch-${a}`}
          onClick={() => {
            setAccent(a);
            setValue(a);
          }}
        >
          {a === accent && <Icon name="check" size={16} />}
        </button>
      ))}
    </div>
  );
}

/** Turns encryption on (new key, entered twice) or off (current key as confirmation). */
function EncryptionDialog({ encrypted, onClose }: { encrypted: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const newKey = useNewKey();
  const [current, setCurrent] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const canSubmit = !busy && (encrypted ? !!current : newKey.valid);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    newKey.setTouched(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (encrypted && !(await verifyKey(current))) {
        setWrong(true);
        return;
      }
      await setEncryption(encrypted ? null : newKey.key);
      showToast(t(encrypted ? 'enc.disabled' : 'enc.enabled'));
      onClose();
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t(encrypted ? 'enc.disable' : 'enc.enable')}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="enc-form" className={encrypted ? 'btn btn-danger' : 'btn btn-primary'} disabled={!canSubmit}>
            {busy ? <span className="spinner" /> : <Icon name={encrypted ? 'unlock' : 'lock'} size={18} />}
            {busy ? t('enc.working') : t(encrypted ? 'enc.disableButton' : 'enc.enableButton')}
          </button>
        </>
      }
    >
      <form id="enc-form" className="form" onSubmit={submit} noValidate>
        {encrypted ? (
          <>
            <div className="warn-box">
              <Icon name="alert" />
              <p>{t('enc.disableText')}</p>
            </div>
            <KeyInput
              value={current}
              onChange={(v) => (setCurrent(v), setWrong(false))}
              label={t('enc.currentKey')}
              autoFocus
              error={wrong ? t('unlock.wrong') : null}
              hint={t('enc.currentKeyHint')}
            />
          </>
        ) : (
          <>
            <p className="muted">{t('enc.enableText')}</p>
            <NewKeyFields state={newKey} />
          </>
        )}
        {busy && <p className="field-hint">{t('enc.keepOpen')}</p>}
        {error && <ErrorDetails error={error} />}
      </form>
    </Modal>
  );
}

/**
 * Development-only tools (the test data generator) live in the git-ignored dev-local/ folder, absent
 * from the repository. Under `npm run dev` this slot loads them; a production build has none of it.
 */
const DevSlot = import.meta.env.DEV
  ? function DevSlot() {
      const [Tools, setTools] = useState<ComponentType | null>(null);
      useEffect(() => {
        const load = import.meta.glob<{ DevTools: ComponentType }>('/dev-local/devtools.tsx')['/dev-local/devtools.tsx'];
        if (load) void load().then((m) => setTools(() => m.DevTools));
      }, []);
      return Tools ? <Tools /> : null;
    }
  : null;

export function SettingsPage() {
  const { t } = useI18n();
  const title = useStore((s) => s.title);
  const refreshing = useStore((s) => s.refreshing);
  const encrypted = useStore((s) => s.encrypted);
  const sheet = settings.getSheet();
  const [confirm, setConfirm] = useState<'change' | 'signOut' | 'encryption' | null>(null);

  return (
    <>
      <PageHead title={t('settings.title')} />
      <div className="settings">
        <section className="panel">
          <h2>{t('settings.language')}</h2>
          <LanguageSwitch />
        </section>

        <section className="panel">
          <h2>{t('settings.theme')}</h2>
          <ThemeSwitch />
        </section>

        <section className="panel">
          <h2>{t('settings.accent')}</h2>
          <AccentPicker />
        </section>

        <section className="panel">
          <h2>{t('settings.spreadsheet')}</h2>
          {sheet && (
            <p className="sheet-name">
              <SheetsMark />
              <a href={`https://docs.google.com/spreadsheets/d/${sheet.id}/edit`} target="_blank" rel="noreferrer">
                {title || sheet.id}
              </a>
              <Icon name="external" size={14} />
            </p>
          )}
          <div className="button-row">
            <button type="button" className={`btn ${refreshing ? 'spin' : ''}`} onClick={() => void reload()} disabled={refreshing}>
              <Icon name="refresh" size={18} />
              {t('settings.reload')}
            </button>
            <button type="button" className="btn" onClick={() => setConfirm('change')}>
              <Icon name="link" size={18} />
              {t('settings.change')}
            </button>
            <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirm('signOut')}>
              <Icon name="logout" size={18} />
              {t('settings.signOut')}
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>{t('settings.security')}</h2>
          <div className={encrypted ? 'enc-status on' : 'enc-status'}>
            <Icon name={encrypted ? 'lock' : 'unlock'} size={18} />
            <div>
              <strong>{encrypted ? t('settings.encOnTitle') : t('enc.off')}</strong>
              <p className="muted">{encrypted ? t('settings.encOnText') : t('settings.encOffText')}</p>
            </div>
          </div>
          <div className="button-row">
            <button type="button" className={encrypted ? 'btn btn-danger-ghost' : 'btn btn-primary'} onClick={() => setConfirm('encryption')}>
              <Icon name={encrypted ? 'unlock' : 'shield'} size={18} />
              {t(encrypted ? 'enc.disable' : 'enc.enable')}
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>{t('settings.about')}</h2>
          <p className="muted">{t('settings.aboutText')}</p>
          <p className="muted">{t('settings.version', { v: APP_VERSION })}</p>
          <p className="muted">
            {t('settings.developer')}: <strong className="developer">kiber_god</strong>
          </p>
          <div className="button-row">
            <a className="btn" href="https://github.com/KiberGod" target="_blank" rel="noreferrer">
              <BrandIcon name="github" size={18} />
              GitHub
            </a>
            <a className="btn" href="https://t.me/kiber_god" target="_blank" rel="noreferrer">
              <BrandIcon name="telegram" size={18} />
              Telegram
            </a>
          </div>
        </section>

        {DevSlot && <DevSlot />}
      </div>

      {confirm === 'change' && (
        <ConfirmDialog
          title={t('settings.changeConfirmTitle')}
          text={t('settings.changeConfirmText')}
          confirmLabel={t('settings.change')}
          danger={false}
          onClose={() => setConfirm(null)}
          onConfirm={disconnect}
        />
      )}
      {confirm === 'signOut' && (
        <ConfirmDialog
          title={t('settings.signOutConfirmTitle')}
          text={t('settings.signOutHint')}
          confirmLabel={t('settings.signOut')}
          onClose={() => setConfirm(null)}
          onConfirm={logout}
        />
      )}
      {confirm === 'encryption' && <EncryptionDialog encrypted={encrypted} onClose={() => setConfirm(null)} />}
    </>
  );
}
