import { EmptyState } from '../components/bits';
import { PageHead } from '../components/Layout';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';

/** Placeholder until transaction templates are built. */
export function TemplatesPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHead title={t('nav.templates')} icon={<Icon name="template" />} />
      <EmptyState icon="template" text={t('templates.soon')} />
    </>
  );
}
