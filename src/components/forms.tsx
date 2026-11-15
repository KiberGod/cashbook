import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BUILTIN_PREFIX } from '../icons/builtin';
import { CATEGORY_ICON_GROUPS, CATEGORY_ICONS, COLOR_KEYS, ICON_COLORS, categoryIconRef, parseCategoryIcon, type ColorKey } from '../icons/categoryIcons';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { LIMITS, type FormId } from '../lib/types';
import { AutoTextarea, Avatar, Field, Segmented } from './bits';

/** Error message for a required, length-limited text (null = fine). */
export function useTextRules() {
  const { t } = useI18n();
  return {
    required: (v: string, max: number = LIMITS.name) =>
      !v.trim() ? t('form.required') : v.trim().length > max ? t('form.tooLong', { n: max }) : null,
    optional: (v: string, max: number = LIMITS.description) => (v.length > max ? t('form.tooLong', { n: max }) : null),
    url: (v: string) => (v.trim() && !/^(https?:\/\/|builtin:)\S+$/i.test(v.trim()) ? t('form.badUrl') : null),
  };
}

export function NameField({
  value,
  onChange,
  error,
  label,
  max = LIMITS.name,
  autoFocus = true,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  label?: string;
  max?: number;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const { t } = useI18n();
  return (
    <Field label={label ?? t('common.name')} error={error} counter={[value.trim().length, max]}>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} placeholder={placeholder} />
    </Field>
  );
}

export function DescriptionField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error: string | null }) {
  const { t } = useI18n();
  return (
    <Field label={t('common.description')} error={error} counter={[value.length, LIMITS.description]}>
      <AutoTextarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={t('common.optional')} />
    </Field>
  );
}

export function ImageField({
  value,
  onChange,
  error,
  name,
  label,
  icons = false,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  name: string;
  label?: string;
  /** offer the built-in category icons (with a colour) as well as a link */
  icons?: boolean;
}) {
  const { t } = useI18n();
  if (!icons) {
    return (
      <Field label={label ?? t('common.imageUrl')} error={error}>
        <span className="image-input">
          <Avatar image={value.trim()} name={name || '?'} size={40} />
          <input type="text" inputMode="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" />
        </span>
      </Field>
    );
  }
  return <ImageOrIconField value={value} onChange={onChange} error={error} name={name} label={label} />;
}

/**
 * A picture given by a link or as a built-in icon in a chosen colour: a switch on top picks which;
 * what the field holds is always what the shown mode makes (switching does not keep the other).
 */
function ImageOrIconField({ value, onChange, error, name, label }: { value: string; onChange: (v: string) => void; error: string | null; name: string; label?: string }) {
  const { t, lang } = useI18n();
  const parsed = value.trim().startsWith(BUILTIN_PREFIX) ? parseCategoryIcon(value.trim().slice(BUILTIN_PREFIX.length)) : null;
  // a new picture starts as an icon; one given before shows how it was given
  const [mode, setMode] = useState<'icon' | 'url'>(() => (parsed || !value.trim() ? 'icon' : 'url'));
  // what each mode holds, so switching back and forth loses nothing typed or chosen
  const [url, setUrl] = useState(() => (parsed ? '' : value));
  const [iconId, setIconId] = useState(parsed?.icon.id ?? '');
  // the colour, once there is an icon: always a set one (an icon given without one wears its group's),
  // so every icon in the grid and the one chosen show in it; none yet: the grid shows each group's
  const [color, setColor] = useState<ColorKey | null>(parsed ? (parsed.color ?? parsed.icon.color) : null);
  const iconOf = (id: string) => CATEGORY_ICONS.find((i) => i.id === id);
  // the icon chosen before is in sight when the grid shows up (the grid scrolls in its box only)
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    const chosen = el?.querySelector<HTMLElement>('.icon-cell.chosen');
    if (el && chosen) el.scrollTop = chosen.offsetTop - el.offsetTop - el.clientHeight / 2 + chosen.offsetHeight / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  const shownColor = color;

  const apply = (m: 'icon' | 'url', u: string, id: string, c: ColorKey | null) => onChange(m === 'url' ? u : id ? categoryIconRef(id, c) : '');
  const switchTo = (m: 'icon' | 'url') => (setMode(m), apply(m, url, iconId, color));
  // the first icon brings its group's colour; after that, the colour stays whatever icon is picked
  const pickIcon = (id: string) => {
    const c = color ?? iconOf(id)?.color ?? null;
    setIconId(id);
    setColor(c);
    apply('icon', url, id, c);
  };
  const pickColor = (c: ColorKey) => (setColor(c), apply('icon', url, iconId, c));

  return (
    <Field label={label ?? t('common.image')} error={error} group>
      <div className="image-field">
        <Segmented<'icon' | 'url'>
          value={mode}
          onChange={switchTo}
          label={t('common.image')}
          options={[
            { value: 'icon', label: t('image.icon') },
            { value: 'url', label: t('image.link') },
          ]}
        />
        {mode === 'url' ? (
          <span className="image-input">
            <Avatar image={value.trim()} name={name || '?'} size={40} />
            <input
              type="text"
              inputMode="url"
              value={url}
              onChange={(e) => (setUrl(e.target.value), apply('url', e.target.value, iconId, color))}
              placeholder="https://…"
              aria-label={t('common.imageUrl')}
            />
          </span>
        ) : (
          <>
            <div className="image-icon-head">
              <Avatar image={value.trim()} name={name || '?'} size={40} fallback="tag" />
              {/* the colour of the circle: any icon in any of them */}
              <div className="icon-colors" role="radiogroup" aria-label={t('image.color')}>
                {COLOR_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={shownColor === k}
                    aria-label={k}
                    className={`icon-color ${shownColor === k ? 'chosen' : ''}`}
                    style={{ background: ICON_COLORS[k] }}
                    onClick={() => pickColor(k)}
                    disabled={!iconId}
                  >
                    {shownColor === k && <Icon name="check" size={14} />}
                  </button>
                ))}
              </div>
            </div>
            {/* in the dialog's own flow (not floating): it scrolls with the dialog, never off screen */}
            <div className="icon-box" ref={box}>
              {CATEGORY_ICON_GROUPS.map((g) => (
                <section key={g.label.en} className="icon-group">
                  <h3>{g.label[lang]}</h3>
                  <div className="icon-grid">
                    {g.icons.map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        className={`icon-cell ${iconId === i.id ? 'chosen' : ''}`}
                        onClick={() => pickIcon(i.id)}
                        title={i.label[lang]}
                        aria-label={i.label[lang]}
                        aria-pressed={iconId === i.id}
                      >
                        <Avatar image={categoryIconRef(i.id, color)} name={i.label[lang]} size={30} />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </Field>
  );
}

export function FormChecks({
  forms,
  value,
  onChange,
  label,
  error,
  hint,
}: {
  forms: FormId[];
  value: FormId[];
  onChange: (v: FormId[]) => void;
  label: string;
  error?: string | null;
  hint?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Field label={label} group error={error} hint={hint}>
      <div className="check-row">
        {forms.map((f) => (
          <label key={f} className={`check-chip ${value.includes(f) ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={value.includes(f)}
              onChange={(e) => onChange(e.target.checked ? [...value, f] : value.filter((x) => x !== f))}
            />
            {t(`form.${f}`)}
          </label>
        ))}
      </div>
    </Field>
  );
}

/** Modal footer with cancel / save. */
export function FormFooter({ onCancel, saveLabel, disabled }: { onCancel: () => void; saveLabel?: string; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <button type="button" className="btn" onClick={onCancel}>
        {t('common.cancel')}
      </button>
      <button type="submit" form="entity-form" className="btn btn-primary" disabled={disabled}>
        {saveLabel ?? t('common.save')}
      </button>
    </>
  );
}
