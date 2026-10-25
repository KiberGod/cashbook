import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { LIMITS, type FormId } from '../lib/types';
import { AutoTextarea, Avatar, Field } from './bits';

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
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  name: string;
  label?: string;
}) {
  const { t } = useI18n();
  return (
    <Field label={label ?? t('common.image')} error={error} hint={t('common.imageHint')}>
      <span className="image-input">
        <Avatar image={value.trim()} name={name || '?'} size={40} />
        <input type="text" inputMode="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" />
      </span>
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
