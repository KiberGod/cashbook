import { EmptyState } from '../components/bits';
import { useI18n } from '../i18n';
import { href } from '../router';

export function NotFound() {
  const { t } = useI18n();
  return (
    <EmptyState icon="info" text={t('common.notFound')}>
      <a className="btn" href={href.dashboard()}>
        {t('common.toHome')}
      </a>
    </EmptyState>
  );
}
