import { useState, type FormEvent } from 'react';
import { Segmented } from '../components/bits';
import { KeyInput, NewKeyFields, useNewKey } from '../components/KeyFields';
import { PageHead } from '../components/Layout';
import { ConfirmDialog, Modal } from '../components/Modal';
import { BrandIcon, Icon } from '../icons/ui';
import { LANGUAGES, useI18n, type Lang } from '../i18n';
import { toAppError, type AppError } from '../lib/errors';
import { SCHEMA_VERSION, SHEETS } from '../lib/schema';
import { settings } from '../lib/storage';
import { ACCENTS, getAccent, getThemePref, setAccent, setThemePref, type Accent, type ThemePref } from '../lib/theme';
import { ENTITY_KINDS, type Data } from '../lib/types';
import { APP_VERSION } from '../lib/version';
import { disconnect, getBackend, logout, reload, replaceAllData, setEncryption, useStore, verifyKey } from '../store/store';
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
    <div className="accent-picker">
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
      <span className="muted">{t(`accent.${accent}`)}</span>
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

// Development-only test data generator. It lives in the git-ignored dev-local/ folder,
// so it is absent from the repository and from production builds.
const devSeed = import.meta.env.DEV ? import.meta.glob<{ generate: (d: Data) => Data }>('/dev-local/seed.ts') : {};

export function SettingsPage() {
  const { t, tn, dateTime } = useI18n();
  const title = useStore((s) => s.title);
  const refreshing = useStore((s) => s.refreshing);
  const encrypted = useStore((s) => s.encrypted);
  const data = useStore((s) => s.data);
  const sheet = settings.getSheet();
  const structure = getBackend()?.structure();
  const [confirm, setConfirm] = useState<'change' | 'signOut' | 'seed' | 'encryption' | null>(null);
  const seedLoader = devSeed['/dev-local/seed.ts'] as (typeof devSeed)[string] | undefined;

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
          <h3 className="settings-sub">{t('settings.accent')}</h3>
          <AccentPicker />
        </section>


        <section className="panel">
          <h2>{t('settings.spreadsheet')}</h2>
          {sheet && (
            <p className="sheet-name">
              <Icon name="table" size={18} />
              <a href={`https://docs.google.com/spreadsheets/d/${sheet.id}/edit`} target="_blank" rel="noreferrer">
                {title || sheet.id}
              </a>
              <Icon name="external" size={14} />
            </p>
          )}
          <div className="button-row">
            <button type="button" className="btn" onClick={() => void reload()} disabled={refreshing}>
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
          <p className="field-hint">{t('settings.signOutHint')}</p>
        </section>

        <section className="panel">
          <h2>{t('settings.structure')}</h2>
          <div className={encrypted ? 'enc-status on' : 'enc-status'}>
            <Icon name={encrypted ? 'lock' : 'unlock'} size={18} />
            <div>
              <strong>{encrypted ? t('enc.on') : t('enc.off')}</strong>
              <p className="muted">{encrypted ? t('settings.encOnText') : t('settings.encOffText')}</p>
            </div>
          </div>
          <div className="button-row">
            <button type="button" className={encrypted ? 'btn btn-danger-ghost' : 'btn btn-primary'} onClick={() => setConfirm('encryption')}>
              <Icon name={encrypted ? 'unlock' : 'shield'} size={18} />
              {t(encrypted ? 'enc.disable' : 'enc.enable')}
            </button>
          </div>
          <dl className="kv">
            <dt>{t('settings.schema')}</dt>
            <dd>
              {structure?.schema ?? SCHEMA_VERSION}
              <span className="muted"> · {t('settings.appVersion', { v: APP_VERSION })}</span>
            </dd>
            {structure?.createdAt && (
              <>
                <dt>{t('settings.created')}</dt>
                <dd>{dateTime(structure.createdAt)}</dd>
              </>
            )}
          </dl>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>{t('settings.sheet')}</th>
                <th>{t('settings.content')}</th>
                <th className="num">{t('settings.records')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>{SHEETS.meta}</code>
                </td>
                <td className="muted">{t('settings.sheetMeta')}</td>
                <td className="num">—</td>
              </tr>
              {ENTITY_KINDS.map((k) => (
                <tr key={k}>
                  <td>
                    <code>{SHEETS[k]}</code>
                  </td>
                  <td className="muted">{t(`nav.${k}`)}</td>
                  <td className="num">{data[k].length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="info-box">
            <Icon name="alert" />
            <p>{t('setup.dontTouch')}</p>
          </div>
        </section>

        <section className="panel">
          <h2>{t('settings.about')}</h2>
          <p className="muted">{t('settings.aboutText')}</p>
          <p className="muted">
            Cashbook · {t('settings.version', { v: APP_VERSION })}
          </p>
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

        {import.meta.env.DEV && (
          <section className="panel panel-dev">
            <h2>{t('dev.title')}</h2>
            <p className="muted">{t('dev.text')}</p>
            <div className="button-row">
              {seedLoader && (
                <button type="button" className="btn" onClick={() => setConfirm('seed')}>
                  <Icon name="star" size={18} />
                  {t('dev.seed')}
                </button>
              )}
            </div>
            <p className="field-hint">{tn('dev.counts', data.transactions.length)}</p>
          </section>
        )}
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
      {confirm === 'seed' && seedLoader && (
        <ConfirmDialog
          title={t('dev.seed')}
          text={t('dev.seedConfirm')}
          confirmLabel={t('dev.seed')}
          onClose={() => setConfirm(null)}
          onConfirm={() => void seedLoader().then((m) => replaceAllData(m.generate(data)))}
        />
      )}
    </>
  );
}
