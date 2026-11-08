import { DndContext, closestCenter, type DragEndEvent, type Modifier } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type UiIconName } from '../icons/ui';
import { useI18n } from '../i18n';
import type { DictKey } from '../i18n/en';
import { getIndex } from '../lib/stats';
import { parseHash, type ListKind } from '../router';
import { useStore } from '../store/store';
import { activate, backTab, closeAllTabs, closeOtherTabs, closeTab, getTabs, moveTab, navigateTab, newTab, openLink, openTab, tabHash, useTabs, type Tab } from '../store/tabs';
import { Avatar } from './bits';
import { swallowNextClick, useDragSensors } from './dnd';

// ---- the tab a page lives in ----

interface TabInfo {
  id: string;
  /** its page's address */
  hash: string;
  /** shown (the others are mounted, out of sight) */
  active: boolean;
}

// outside of tabs (a page rendered on its own): the address bar's page, always shown
const TabContext = createContext<TabInfo>({
  id: '',
  get hash() {
    return location.hash;
  },
  active: true,
});

export function TabProvider({ value, children }: { value: TabInfo; children: ReactNode }) {
  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}

/** The tab this component is in (outside of tabs: always shown). */
export const useTab = () => useContext(TabContext);

/** Navigation bound to this component's own tab (even when it is not the shown one). */
export function useTabNav() {
  const { id } = useTab();
  return {
    navigate: (to: string, opts: { replace?: boolean } = {}) => (id ? navigateTab(id, to, opts) : openLink(to)),
    back: (fallback: string) => (id ? backTab(id, fallback) : openLink(fallback)),
  };
}

// ---- what a tab is called ----

const SECTION: Record<ListKind | 'dashboard' | 'analytics' | 'transactions' | 'templates' | 'settings', { icon: UiIconName; label: DictKey }> = {
  dashboard: { icon: 'dashboard', label: 'nav.dashboard' },
  analytics: { icon: 'chart', label: 'nav.analytics' },
  contacts: { icon: 'users', label: 'nav.contacts' },
  accounts: { icon: 'wallet', label: 'nav.accounts' },
  transactions: { icon: 'swap', label: 'nav.transactions' },
  debts: { icon: 'handshake', label: 'nav.debts' },
  categories: { icon: 'tag', label: 'nav.categories' },
  assets: { icon: 'currency', label: 'nav.assets' },
  services: { icon: 'bank', label: 'nav.servicesShort' },
  templates: { icon: 'template', label: 'nav.templates' },
  settings: { icon: 'settings', label: 'settings.title' },
};

/**
 * A tab's name and its section's icon: the record's own name on a record's page; a contact's page
 * also shows the contact's picture (`picture`) in place of the icon.
 */
export function useTabTitle(hash: string): { title: string; icon: UiIconName; picture?: ReactNode } {
  const i18n = useI18n();
  const { t } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const r = parseHash(hash);
  switch (r.name) {
    case 'detail': {
      const s = SECTION[r.kind];
      const name =
        r.kind === 'accounts'
          ? ix.accounts.get(r.id)?.name
          : r.kind === 'contacts'
            ? ix.contacts.get(r.id)?.name
            : r.kind === 'assets'
              ? ix.assets.get(r.id)?.code
              : r.kind === 'services'
                ? ix.services.get(r.id)?.name
                : r.kind === 'categories'
                  ? ix.categories.get(r.id)?.name
                  : ix.debts.get(r.id)?.name;
      const contact = r.kind === 'contacts' ? ix.contacts.get(r.id) : undefined;
      return {
        title: name ?? t(s.label),
        icon: s.icon,
        picture: contact ? <Avatar image={contact.image} name={contact.name} size={18} /> : undefined,
      };
    }
    case 'transaction': {
      const tx = ix.transactions.get(r.id);
      return { title: tx ? `${t('tx.one')} · ${i18n.date(tx.date)}` : t('tx.one'), icon: SECTION.transactions.icon };
    }
    case 'list':
      return { title: t(SECTION[r.kind].label), icon: SECTION[r.kind].icon };
    case 'templates': {
      const q = r.query.get('q');
      return { title: q ? `${t('nav.templates')}: ${q}` : t('nav.templates'), icon: SECTION.templates.icon };
    }
    default:
      return { title: t(SECTION[r.name].label), icon: SECTION[r.name].icon };
  }
}

// ---- a small menu at the pointer (links, tabs) ----

interface MenuItem {
  label: string;
  icon: UiIconName;
  onSelect: () => void;
}

function PointerMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // inside the window, flipped to the other side of the pointer when needed
    const left = x + el.offsetWidth > window.innerWidth - 8 ? Math.max(8, x - el.offsetWidth) : x;
    const top = y + el.offsetHeight > window.innerHeight - 8 ? Math.max(8, y - el.offsetHeight) : y;
    setPlace({ left, top });
  }, [x, y]);
  useEffect(() => {
    const outside = (e: Event) => !box.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={box} className="menu-list menu-pop ctx-menu" role="menu" style={place}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            it.onSelect();
          }}
        >
          <Icon name={it.icon} size={16} />
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/**
 * The right-click menu of the app: none of the browser's (except in text fields); in-app links
 * (links, chips, rows leading to a record or a section) get ours - open here, open in a new tab.
 */
export function LinkMenu() {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ x: number; y: number; to: string; inTab: boolean } | null>(null);
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // text fields keep the browser's menu: paste, copy, spelling (on a phone, the only way to paste)
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      // nowhere else in the app: links get ours, the rest none (tabs show their own)
      e.preventDefault();
      const el = target?.closest?.('a[href^="#"], [data-href]');
      if (!el || el.closest('.tab-strip')) return;
      const to = el.getAttribute('href') ?? el.getAttribute('data-href');
      if (!to || !to.startsWith('#')) return;
      setMenu({ x: e.clientX, y: e.clientY, to, inTab: !!el.closest('.side-nav, .brand, .crumbs') });
    };
    document.addEventListener('contextmenu', onMenu);
    return () => document.removeEventListener('contextmenu', onMenu);
  }, []);
  if (!menu) return null;
  const close = () => setMenu(null);
  return (
    <PointerMenu
      x={menu.x}
      y={menu.y}
      onClose={close}
      items={[
        { label: t('ctx.open'), icon: 'chevronRight', onSelect: () => (menu.inTab ? navigateTab(getTabs().active, menu.to) : openLink(menu.to)) },
        { label: t('ctx.openNewTab'), icon: 'plus', onSelect: () => newTab(menu.to, { background: true }) },
      ]}
    />
  );
}

// ---- the tab strip ----

/** A miniature of a tab's page: a copy of it, scaled down, scrolled where the tab was. */
function Preview({ tab, anchor, title }: { tab: Tab; anchor: DOMRect; title: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const W = 300;
  const H = 180;
  const [left] = useState(() => Math.max(8, Math.min(window.innerWidth - W - 8, anchor.left)));
  useLayoutEffect(() => {
    const host = inner.current;
    const pane = document.querySelector<HTMLElement>(`.tab-pane[data-tab="${tab.id}"]`);
    const shown = document.querySelector<HTMLElement>('.tab-pane:not([hidden])');
    if (!host || !pane) return;
    const width = (shown ?? pane).clientWidth || 1000;
    const copy = pane.cloneNode(true) as HTMLElement;
    copy.removeAttribute('hidden');
    // the copy's ids would clash with the page's own (svg clip paths and the like)
    for (const el of copy.querySelectorAll('[id]')) el.removeAttribute('id');
    copy.style.width = `${width}px`;
    const scale = W / width;
    const scroll = getTabs().active === tab.id ? window.scrollY : (previewScroll.get(tab.id) ?? 0);
    const top = shown ? shown.getBoundingClientRect().top + window.scrollY : 0;
    copy.style.transform = `scale(${scale}) translateY(${-Math.max(0, scroll - top + 8)}px)`;
    host.replaceChildren(copy);
  }, [tab.id]);
  return createPortal(
    <div className="tab-preview" style={{ left, top: anchor.bottom + 6, width: W }} aria-hidden="true">
      <div className="tab-preview-title">{title}</div>
      <div className="tab-preview-shot" ref={inner} style={{ height: H }} />
    </div>,
    document.body,
  );
}

/** where hidden tabs were scrolled to, for their previews */
const previewScroll = new Map<string, number>();

function TabItem({ tab, active, menuOpen, onMenu }: { tab: Tab; active: boolean; menuOpen: boolean; onMenu: (e: ReactMouseEvent, id: string) => void }) {
  const { t } = useI18n();
  const hash = tabHash(tab);
  const { title, icon, picture } = useTabTitle(hash);
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: tab.id });
  const el = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (isDragging) setPreview(null);
  }, [isDragging]);

  return (
    <div
      ref={(n) => {
        setNodeRef(n);
        el.current = n;
      }}
      className={`tab ${active ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform && { ...transform, y: 0 }), transition }}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={active}
      onClick={() => activate(tab.id)}
      onAuxClick={(e) => {
        // the middle button closes it, as in a browser
        if (e.button === 1) {
          e.preventDefault();
          closeTab(tab.id);
        }
      }}
      onContextMenu={(e) => {
        // the menu takes the preview's place
        window.clearTimeout(timer.current);
        setPreview(null);
        onMenu(e, tab.id);
      }}
      onMouseEnter={() => {
        window.clearTimeout(timer.current);
        if (menuOpen) return;
        timer.current = window.setTimeout(() => el.current && setPreview(el.current.getBoundingClientRect()), 500);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        setPreview(null);
      }}
    >
      {picture ? <span className="tab-pic">{picture}</span> : <Icon name={icon} size={15} />}
      <span className="tab-title">{title}</span>
      <button
        type="button"
        className="tab-close"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tab.id);
        }}
        aria-label={`${t('tabs.close')}: ${title}`}
        title={t('tabs.close')}
      >
        <Icon name="close" size={13} />
      </button>
      {preview && !isDragging && !menuOpen && <Preview tab={tab} anchor={preview} title={title} />}
    </div>
  );
}

/** The tabs along the top bar: click to show, drag to reorder, × or the middle button to close. */
export function TabStrip() {
  const { t } = useI18n();
  const { tabs, active } = useTabs();
  const sensors = useDragSensors();
  const strip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  // a tab that becomes the shown one is brought into view in a strip that scrolls (only then: closing
  // or adding other tabs leaves the strip where the user scrolled it)
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  // the hidden tabs' scroll, for their previews
  useEffect(() => {
    const save = () => previewScroll.set(getTabs().active, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, []);
  // a wheel over the strip scrolls it sideways
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // a dragged tab moves only sideways and stays within the strip (no scrolling the strip away under it)
  const keepInStrip: Modifier = ({ transform, draggingNodeRect }) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box || !draggingNodeRect) return { ...transform, y: 0 };
    const min = box.left - draggingNodeRect.left;
    const max = box.right - draggingNodeRect.right;
    return { ...transform, x: Math.min(max, Math.max(min, transform.x)), y: 0 };
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    swallowNextClick();
    if (over && a.id !== over.id) moveTab(String(a.id), String(over.id));
  };

  return (
    <div className="tab-strip-wrap">
      <div className="tab-strip" ref={strip} role="tablist" aria-label={t('tabs.title')}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[keepInStrip]} autoScroll={false}>
          <SortableContext items={tabs.map((x) => x.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab) => (
              <TabItem
                key={tab.id}
                tab={tab}
                active={tab.id === active}
                menuOpen={!!menu}
                onMenu={(e, id) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, id });
                }}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <button type="button" className="icon-btn tab-new" onClick={() => newTab()} aria-label={t('tabs.new')} title={t('tabs.new')}>
        <Icon name="plus" size={18} />
      </button>
      {menu && (
        <PointerMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: t('tabs.duplicate'), icon: 'copy', onSelect: () => newTab(tabHash(tabs.find((x) => x.id === menu.id)!)) },
            { label: t('tabs.close'), icon: 'close', onSelect: () => closeTab(menu.id) },
            ...(tabs.length > 1 ? [{ label: t('tabs.closeOthers'), icon: 'close' as const, onSelect: () => closeOtherTabs(menu.id) }] : []),
            { label: t('tabs.closeAll'), icon: 'trash', onSelect: closeAllTabs },
          ]}
        />
      )}
    </div>
  );
}

export { openLink, openTab };
