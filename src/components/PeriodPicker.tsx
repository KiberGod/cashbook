import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { periodRange, shiftPeriod, type Period, type PeriodMode } from '../lib/analytics';
import { toDateInput } from '../lib/format';

const MODES: PeriodMode[] = ['all', 'day', 'week', 'month', 'year', 'custom'];

/** Time frame selector: all time, a day / week / month / year with arrows, or a custom range. */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const range = periodRange(value);

  const label = (() => {
    if (!range || value.mode === 'custom') return '';
    const s = new Date(range[0]);
    if (value.mode === 'day') return i18n.date(range[0]);
    if (value.mode === 'week') return `${i18n.date(range[0])} – ${i18n.date(range[1] - 1)}`;
    if (value.mode === 'month') return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(s);
    return String(s.getFullYear());
  })();

  const setMode = (mode: PeriodMode) => {
    if (mode === 'custom' && !value.from) {
      const now = new Date();
      onChange({ ...value, mode, from: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)), to: toDateInput(now) });
    } else onChange({ ...value, mode, anchor: value.mode === 'all' || value.mode === 'custom' ? Date.now() : value.anchor });
  };

  return (
    <div className="period">
      <select className="select" value={value.mode} onChange={(e) => setMode(e.target.value as PeriodMode)} aria-label={t('period.label')}>
        {MODES.map((m) => (
          <option key={m} value={m}>
            {t(`period.${m}`)}
          </option>
        ))}
      </select>
      {value.mode !== 'all' && value.mode !== 'custom' && (
        <div className="period-nav">
          <button type="button" className="icon-btn" onClick={() => onChange(shiftPeriod(value, -1))} aria-label={t('page.prev')}>
            <Icon name="chevronLeft" size={18} />
          </button>
          <button type="button" className="period-label" onClick={() => onChange({ ...value, anchor: Date.now() })} title={t('period.today')}>
            {label}
          </button>
          <button type="button" className="icon-btn" onClick={() => onChange(shiftPeriod(value, 1))} aria-label={t('page.next')}>
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
      )}
      {value.mode === 'custom' && (
        <div className="period-custom">
          <input type="date" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label={t('period.from')} />
          <span>–</span>
          <input type="date" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label={t('period.to')} />
        </div>
      )}
    </div>
  );
}
