import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { useMemo, useState } from 'react';
import { EmptyState, Pagination, SearchField, usePaged } from '../components/bits';
import { swallowNextClick, useDragSensors } from '../components/dnd';
import { PageHead } from '../components/Layout';
import { TemplateCard } from '../components/Templates';
import { TxFilterGroups } from '../components/TxFilters';
import { useViewState } from '../components/viewState';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { activeFilters, emptyFilter, filterTemplates, type TxFilter } from '../lib/analytics';
import { moveTemplate } from '../lib/ops';
import { getIndex } from '../lib/stats';
import { mutate, useStore } from '../store/store';
import { openTemplateForm } from '../store/ui';

/**
 * Prepared transactions: a card per template, the button on it makes a transaction dated now.
 * Search and filters work like on the transactions page (no dates: a template has none).
 * A link with ?q= (from a "related templates" list) opens the list searched by a template's name.
 */
export function TemplatesPage({ query }: { query: URLSearchParams }) {
  const { t, num } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const linked = query.get('q');

  // the plain list remembers its search and filters; a link always starts from what it says
  const [stored, setStored] = useViewState<TxFilter>('templates.filter', emptyFilter);
  const [fromLink, setFromLink] = useState<TxFilter>(() => ({ ...emptyFilter(), q: linked ?? '' }));
  const [f, setFilter] = linked !== null ? [fromLink, setFromLink] : [stored, setStored];
  const [moreFilters, setMoreFilters] = useViewState('templates.filtersOpen', false);
  const activeCount = activeFilters(f);

  const list = useMemo(() => filterTemplates(ix, f), [ix, f]);
  const paged = usePaged(list, 'templates', JSON.stringify(f));
  // the order is only changed on the full list, never on search or filter results
  const filtered = !!f.q.trim() || activeCount > 0;

  const sensors = useDragSensors();
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    swallowNextClick();
    if (over && active.id !== over.id) mutate((d) => moveTemplate(d, String(active.id), String(over.id)));
  };

  return (
    <>
      <PageHead
        title={t('nav.templates')}
        icon={<Icon name="template" />}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => openTemplateForm()}>
            <Icon name="plus" size={18} />
            {t('templates.add')}
          </button>
        }
      />
      {data.templates.length > 0 && (
        <>
          <div className="toolbar toolbar-wide">
            <SearchField value={f.q} onChange={(q) => setFilter((prev) => ({ ...prev, q }))} placeholder={t('templates.search')} />
            <button type="button" className={`btn ${moreFilters ? 'btn-active' : ''}`} onClick={() => setMoreFilters(!moreFilters)} aria-expanded={moreFilters}>
              <Icon name="filter" size={18} />
              {t('filter.more')}
              {activeCount > 0 && <span className="badge badge-accent">{activeCount}</span>}
            </button>
            {activeCount > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => setFilter({ ...emptyFilter(), q: f.q })}>
                {t('filter.reset')}
              </button>
            )}
          </div>
          {moreFilters && <TxFilterGroups ix={ix} f={f} onChange={setFilter} dates={false} />}
          {filtered && list.length > 0 && (
            <p className="muted list-count">
              {t('templates.shown', { n: num(list.length), all: num(data.templates.length) })}
            </p>
          )}
        </>
      )}
      {list.length === 0 ? (
        <EmptyState icon="template" text={filtered ? t('common.nothingFound') : t('templates.empty')} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={paged.items.map((x) => x.id)} strategy={rectSortingStrategy} disabled={filtered}>
            <div className="rows rows-grid tpl-grid">
              {paged.items.map((x) => (
                <TemplateCard key={x.id} x={x} q={f.q} sortable={!filtered} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <Pagination p={paged} />
    </>
  );
}
