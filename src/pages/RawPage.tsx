import { useState } from 'react';
import { Segmented } from '../components/bits';
import { PageHead } from '../components/Layout';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { getBackend } from '../store/store';
import { NotFound } from './common';

const MAX_ROWS = 200;

/** Dev only: the raw cells of the local demo spreadsheet - to see what is actually stored (encrypted or not). */
export function RawPage() {
  const { t } = useI18n();
  const local = getBackend()?.local;
  const book = local?.raw();
  const [sheet, setSheet] = useState(book?.sheets.find((s) => s.title === 'Transactions')?.title ?? book?.sheets[0]?.title ?? '');
  if (!import.meta.env.DEV || !book) return <NotFound />;
  const current = book.sheets.find((s) => s.title === sheet);
  const rows = current?.values ?? [];
  const width = Math.max(1, ...rows.map((r) => r.length));

  return (
    <>
      <PageHead title={t('dev.raw')} icon={<Icon name="table" />} subtitle={t('dev.rawText')} />
      <div className="toolbar">
        <Segmented value={sheet} onChange={setSheet} options={book.sheets.map((s) => ({ value: s.title, label: s.title }))} />
      </div>
      <div className="table-wrap raw-wrap">
        <table className="table table-compact raw-table">
          <thead>
            <tr>
              <th>#</th>
              {Array.from({ length: width }, (_, i) => (
                <th key={i}>{String.fromCharCode(65 + (i % 26))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((r, i) => (
              <tr key={i}>
                <td className="muted">{i + 1}</td>
                {Array.from({ length: width }, (_, j) => (
                  <td key={j}>{r[j] === undefined || r[j] === null ? '' : String(r[j])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > MAX_ROWS && <p className="field-hint">{t('dev.rawMore', { n: rows.length - MAX_ROWS })}</p>}
    </>
  );
}
