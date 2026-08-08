import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../../api/client';
import { ProjectTree, SpaceTree, TreeNodeItem } from '../../types';
import { useToast } from '../Toast';
import { RefreshIcon } from '../RefreshIcon';
import { LockIcon } from '../icons';
import { FadeIn, useFadeToggle } from '../fadePresence';
import { useDelayedFlag } from '../Skeleton';
import { TreeReveal } from '../TreeReveal';
import { ChevronRightIcon, CrossIcon, DocumentIcon, FilterIcon, SearchIcon } from '../icons';
import { useTreeRefresh } from '../../hooks/useTreeRefresh';
import { collectRevealKeys } from './treeReveal';
import { colors, radii, shadows } from '../../styles/tokens';

const TREE_STATE_KEY = 'reqtrace_tree_state';

// Заявка «раскрой дерево на странице» (v1.8.1, отзыв пользователя): переход
// из глобального поиска и недавних должен показать страницу в дереве —
// сбросить поиск/фильтр и развернуть предков. Буфер-модуль, а не только
// событие: при дереве, свёрнутом в рельсу, PageTree размонтирован — заявка
// дожидается разворота, но недолго (TTL: раскрытие через полчаса читалось
// бы как самодеятельность).
let pendingReveal: { pageId: string; at: number } | null = null;
const REVEAL_TTL_MS = 15000;

export function requestTreeReveal(pageId: string): void {
  pendingReveal = { pageId, at: Date.now() };
  window.dispatchEvent(new Event('reqtrace:reveal-page'));
}

// Опции фильтра дерева по статусу привязок — чипы в поповере под
// кнопкой-воронкой в шапке (итог трёх итераций с пользователем v1.8.1:
// чипы-россыпь над деревом «сваливались» в него, сегмент-контрол спорил за
// ширину узкого сайдбара — поповер даёт чипам воздух, а шапке тишину).
// Подписи — те же короткие, что на «Тестах» («Ждут проверки», «Утрачены»);
// точный смысл («страницы, где есть такие привязки») несёт title.
const STATUS_FILTERS: { key: 'outdated' | 'lost'; label: string; title: string }[] = [
  {
    key: 'outdated',
    label: 'Ждут проверки',
    title: 'Показать только страницы с привязками, требующими проверки',
  },
  {
    key: 'lost',
    label: 'Утрачены',
    title: 'Показать только страницы с утраченными привязками',
  },
];

// Плейсхолдер поиска на узком дереве обрезался жёстко, посреди буквы
// («Поиск стран») — многоточие через ::placeholder, инлайн-стилям
// псевдоэлемент недоступен (паттерн — TreeReveal/RefreshIcon).
const SEARCH_STYLES_ID = 'reqtrace-tree-search-styles';
if (typeof document !== 'undefined' && !document.getElementById(SEARCH_STYLES_ID)) {
  const style = document.createElement('style');
  style.id = SEARCH_STYLES_ID;
  style.textContent = `
.tree-search-input::placeholder {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;
  document.head.appendChild(style);
}

// Подсветка совпадения с поисковым запросом (жёлтая подложка). Экспорт —
// её же использует поиск ключей на экране «Тесты».
export function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: colors.yellowHighlight, borderRadius: '2px', padding: '0 1px' }}>
        {text.slice(idx, idx + q.length)}
      </span>
      {text.slice(idx + q.length)}
    </>
  );
}

// Шеврон раскрытия: остриё вправо, при раскрытии поворачивается вниз — как в
// Confluence. Толщина 2.7 повторяет прежний вид (1.8 на вьюбоксе 16 ≈ 2.7 на 24).
const TreeChevron: React.FC<{ expanded: boolean; size?: number }> = ({ expanded, size = 12 }) => (
  <ChevronRightIcon
    size={size}
    strokeWidth={2.7}
    style={{
      color: colors.textTertiary,
      transition: 'transform 0.18s ease',
      transform: expanded ? 'rotate(90deg)' : 'none',
    }}
  />
);

// Кнопка-иконка шапки сайдбара — в точности как кнопки верхних баров страницы
// («Обновить», «Ещё действия»): 34×34, рамка, белый фон, тот же ховер.
// Экспорт (ревью v1.8.1): ею же живут лупа глобального поиска в главной
// шапке и выгрузка CSV на «Тестах» — стиль в одном месте, не в четырёх.
export const HeaderIconButton: React.FC<{
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ title, onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      width: '34px',
      height: '34px',
      padding: 0,
      borderRadius: radii.md,
      border: `1px solid ${colors.border}`,
      background: colors.white,
      color: colors.textSecondary,
      cursor: disabled ? 'default' : 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      transition: 'all 0.15s',
    }}
    onMouseEnter={e => {
      if (disabled) return;
      e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
      e.currentTarget.style.borderColor = colors.borderHover;
      e.currentTarget.style.color = colors.textPrimary;
    }}
    onMouseLeave={e => {
      e.currentTarget.style.background = colors.white;
      e.currentTarget.style.borderColor = colors.border;
      e.currentTarget.style.color = colors.textSecondary;
    }}
  >
    {children}
  </button>
);

function loadExpandState(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(TREE_STATE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveExpandState(state: Record<string, boolean>) {
  localStorage.setItem(TREE_STATE_KEY, JSON.stringify(state));
}

// Модалка добавления страницы больше не живёт здесь (v1.8.1): добавление —
// редкое действие настройки, его входы — меню карточки проекта в профиле,
// пустой экран «/» и пустое дерево; все шлют reqtrace:open-add-page, слушает
// Layout (он смонтирован и при дереве, свёрнутом в рельсу).
export const PageTree: React.FC = () => {
  const [projects, setProjects] = useState<ProjectTree[]>([]);
  const [loading, setLoading] = useState(true);
  // Лоадер — только если ответ не мгновенный (v1.7.1, как у страниц):
  // мелькание «Загрузки…» на быстрых ответах хуже её отсутствия.
  const showLoader = useDelayedFlag(loading);
  const [expandState, setExpandState] = useState<Record<string, boolean>>(loadExpandState);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Фильтр по статусу привязок (бэклог «UX-пакет»): сужает дерево до
  // страниц, где есть что проверить/перепривязать. Живёт в памяти
  // (не в localStorage): фильтр — рабочий инструмент на один заход.
  const [statusFilter, setStatusFilter] = useState<'outdated' | 'lost' | null>(null);
  // Поповер опций фильтра — под кнопкой-воронкой в шапке (на месте бывшего
  // «плюса»); мягкое появление/гашение — как у меню действий.
  const [filterOpen, setFilterOpen] = useState(false);
  const { mounted: filterMounted, fadeStyle: filterFade } = useFadeToggle(filterOpen);
  const filterRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { version: treeVersion } = useTreeRefresh();

  // Раскрытие дерева на странице по заявке requestTreeReveal: сбрасываем
  // поиск и фильтр (они прятали бы цель), раскрываем проект → спейс →
  // предков и доводим строку в видимую область после каскада TreeReveal.
  const tryConsumeReveal = useCallback(() => {
    if (!pendingReveal) return;
    if (Date.now() - pendingReveal.at > REVEAL_TTL_MS) {
      pendingReveal = null;
      return;
    }
    const { pageId } = pendingReveal;
    const keys = collectRevealKeys(projects, pageId);
    // null — дерево ещё не доехало (или страницы нет): заявка ждёт
    // следующего прихода projects, TTL отсеет безнадёжные.
    if (!keys) return;
    pendingReveal = null;
    setSearchQuery('');
    setStatusFilter(null);
    setExpandState(prev => {
      const next = { ...prev };
      for (const key of keys) next[key] = true;
      saveExpandState(next);
      return next;
    });
    window.setTimeout(() => {
      document.querySelector(`[data-tree-page-id="${pageId}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }, 220);
  }, [projects]);

  useEffect(() => {
    window.addEventListener('reqtrace:reveal-page', tryConsumeReveal);
    return () => window.removeEventListener('reqtrace:reveal-page', tryConsumeReveal);
  }, [tryConsumeReveal]);

  // Дерево доехало (маунт после рельсы, перезагрузка) — применить заявку.
  useEffect(() => { tryConsumeReveal(); }, [tryConsumeReveal]);

  // Поповер фильтра закрывается кликом вне и Escape — как меню «⋮» страницы.
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filterOpen]);

  const loadTree = useCallback(async () => {
    try {
      const data = await api.getPageTree();
      setProjects(data);
    } catch (e: any) {
      showToast('error', 'Не удалось загрузить дерево страниц', e.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // Refetch tree on mount, when route changes (covers delete, refresh scenarios)
  // and on explicit refresh signal (изменения проектов на экране настроек).
  useEffect(() => { loadTree(); }, [location.pathname, treeVersion, loadTree]);

  const toggleExpand = useCallback((key: string) => {
    setExpandState(prev => {
      // Default is collapsed, so undefined → expand (true)
      const current = prev[key] === true;
      const next = { ...prev, [key]: !current };
      saveExpandState(next);
      return next;
    });
  }, []);

  const handleAddDemo = async () => {
    try {
      const page = await api.addDemoPage();
      await loadTree();
      navigate(`/pages/${page.id}`);
    } catch (e: any) {
      showToast('error', 'Не удалось добавить демо-страницу', e.message);
    }
  };

  const handleSyncTree = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await api.syncTree();
      await loadTree();

      const parts: string[] = [];
      if (res.moved) parts.push(`перемещено: ${res.moved}`);
      if (res.added) parts.push(`добавлено: ${res.added}`);
      if (res.removed) parts.push(`удалено: ${res.removed}`);

      if (parts.length === 0) {
        showToast('success', 'Структура актуальна', 'Изменений в иерархии не найдено');
      } else {
        showToast('success', 'Структура синхронизирована', parts.join(', '));
      }

      if (res.missing_tracked) {
        showToast(
          'warning',
          'Часть страниц отсутствует в Confluence',
          `Отслеживаемых страниц без аналога в Confluence: ${res.missing_tracked}. Они сохранены, проверьте их вручную`,
        );
      }
    } catch (e: any) {
      showToast('error', 'Не удалось синхронизировать структуру', e.message);
    } finally {
      setSyncing(false);
    }
  };

  const activePageId = useMemo(() => {
    const match = location.pathname.match(/^\/pages\/(.+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // Фильтр спейса по произвольному предикату страницы (поиск по названию,
  // статус привязок или их сочетание) — подходящие страницы плюс их предки,
  // чтобы дерево оставалось связным.
  const filterSpace = useCallback((
    space: SpaceTree, matches: (page: TreeNodeItem) => boolean,
  ): SpaceTree | null => {
    const matched = new Set<string>();
    for (const page of space.pages) {
      if (matches(page)) {
        matched.add(page.confluence_page_id);
      }
    }
    if (matched.size === 0) return null;

    // Include ancestors of matched pages so the tree stays connected
    const cpidToPage = new Map(space.pages.map(p => [p.confluence_page_id, p]));
    const withAncestors = new Set(matched);
    Array.from(matched).forEach(cpid => {
      let current = cpidToPage.get(cpid);
      while (current?.parent_confluence_page_id) {
        if (withAncestors.has(current.parent_confluence_page_id)) break;
        withAncestors.add(current.parent_confluence_page_id);
        current = cpidToPage.get(current.parent_confluence_page_id);
      }
    });

    return {
      ...space,
      pages: space.pages.filter(p => withAncestors.has(p.confluence_page_id)),
    };
  }, []);

  // Сколько привязок каждого «тревожного» статуса видно в дереве — для
  // счётчиков на чипах фильтра; нули прячут чип (фильтровать нечего).
  const statusTotals = useMemo(() => {
    let outdated = 0;
    let lost = 0;
    for (const project of projects) {
      if (project.no_access) continue;
      for (const space of project.spaces) {
        for (const page of space.pages) {
          outdated += page.highlights_outdated;
          lost += page.highlights_lost;
        }
      }
    }
    return { outdated, lost };
  }, [projects]);

  // Счётчик фильтра дошёл до нуля (всё проверили/перепривязали, дерево
  // перезагрузилось) — чип исчезает, фильтр обязан сброситься вместе с ним,
  // иначе дерево останется пустым без видимой причины.
  useEffect(() => {
    if (statusFilter && statusTotals[statusFilter] === 0) setStatusFilter(null);
  }, [statusFilter, statusTotals]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q && !statusFilter) return projects;

    const matches = (page: TreeNodeItem) =>
      (!q || page.title.toLowerCase().includes(q)) &&
      (!statusFilter || (statusFilter === 'outdated'
        ? page.highlights_outdated > 0
        : page.highlights_lost > 0));

    return projects
      .map(project => {
        if (project.no_access) return null; // содержимое закрыто — не ищется
        const spaces = project.spaces
          .map(space => filterSpace(space, matches))
          .filter((s): s is SpaceTree => s !== null);
        if (spaces.length === 0) return null;
        return { ...project, spaces } as ProjectTree;
      })
      .filter((p): p is ProjectTree => p !== null);
  }, [projects, searchQuery, statusFilter, filterSpace]);

  const isSearching = searchQuery.trim().length > 0;
  // Любой активный отбор (поиск или чип статуса) принудительно раскрывает
  // дерево — найденное должно быть видно без ручного разворачивания.
  const isFiltering = isSearching || statusFilter !== null;

  const hasAnyPages = projects.some(p => p.spaces.some(s => s.pages.length > 0));
  const isEmptySearch = isFiltering && filteredProjects.length === 0;
  // Поиску нечего искать без страниц (и пока дерево грузится).
  const searchDisabled = loading || !hasAnyPages;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Шапка панели: поиск и действия одной строкой. Высота 64px — ровно как
          у верхнего бара страницы: их нижние линии стыкуются в одну. Линия — во
          всю ширину сайдбара (отступы панель раздаёт сама, см. Layout); дерево
          скроллится под шапкой. */}
      <div style={{
        flexShrink: 0,
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '0 10px',
        borderBottom: `1px solid ${colors.border}`,
      }}>
        {/* Search — поле как у ввода ключа теста в панели выделения. При
            пустом дереве строка НЕ исчезает (пропадающее поле читалось как
            баг вёрстки), а дизейблится с подсказкой, когда поиск заработает. */}
        <div
          style={{ flex: 1, minWidth: 0, position: 'relative' }}
          title={searchDisabled && !loading
            ? 'Поиск заработает, когда появятся страницы: подключите проект и добавьте первую страницу'
            : undefined}
        >
          <span style={{
            position: 'absolute',
            left: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: colors.textTertiary,
            opacity: searchDisabled ? 0.45 : 1,
            display: 'flex',
            pointerEvents: 'none',
          }}>
            <SearchIcon size={13} />
          </span>
          <input
            type="text"
            className="tree-search-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            // В дизейбле поле само говорит о состоянии — тултип объясняет
            // причину; в рабочем состоянии — компактное «Поиск страниц…».
            // На узком дереве плейсхолдер сокращается многоточием
            // (класс tree-search-input), а не режется посреди буквы.
            placeholder={searchDisabled ? 'Поиск недоступен' : 'Поиск страниц…'}
            disabled={searchDisabled}
            style={{
              width: '100%',
              // Правый резерв — только под реально существующий крестик
              // очистки: пустующие 30px обрезали плейсхолдер «невидимкой».
              padding: `8px ${searchQuery ? 30 : 12}px 8px 28px`,
              // Chromium вешает многоточие плейсхолдера по text-overflow
              // самого инпута — правила на ::placeholder ему недостаточно
              // (проверено: первый заход только через CSS-класс не сработал).
              textOverflow: 'ellipsis',
              lineHeight: '16px',
              borderRadius: radii.md,
              border: `1px solid ${colors.border}`,
              fontSize: '13px',
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s, box-shadow 0.15s',
              background: searchDisabled ? 'rgba(0, 0, 0, 0.05)' : colors.white,
              color: searchDisabled ? colors.textTertiary : colors.textPrimary,
              cursor: searchDisabled ? 'not-allowed' : 'text',
            }}
            // Единый фокус полей: рамка greenDark + тонкое кольцо
            // (shadows.focusRing), как у поля ключа теста в панели выделения.
            onFocus={e => {
              e.currentTarget.style.borderColor = colors.focusBorder;
              e.currentTarget.style.boxShadow = shadows.focusRing;
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = colors.border;
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              title="Очистить поиск"
              style={{
                position: 'absolute',
                right: '9px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '18px',
                height: '18px',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                borderRadius: radii.sm,
                cursor: 'pointer',
                color: colors.textTertiary,
              }}
            >
              <CrossIcon size={12} />
            </button>
          )}
        </div>
        <HeaderIconButton
          title="Синхронизировать структуру с Confluence (перенос/добавление страниц)"
          onClick={handleSyncTree}
          disabled={syncing}
        >
          <RefreshIcon size={16} spinning={syncing} />
        </HeaderIconButton>
        {/* Фильтр по статусу привязок — воронка на месте бывшего «плюса»
            (решение пользователя v1.8.1: добавление страницы — редкое
            действие настройки, уехало к карточке проекта в профиле).
            По тапу — поповер с чипами опций; кнопка зелёная, пока фильтр
            активен. Обе опции по нулям — кнопка глушится с подсказкой
            (охрана в onClick, урок v1.6.0). */}
        <div style={{ position: 'relative', flexShrink: 0 }} ref={filterRef}>
          {(() => {
            const filterActive = statusFilter !== null;
            const filterEmpty = statusTotals.outdated === 0 && statusTotals.lost === 0;
            return (
              <button
                onClick={() => { if (!filterEmpty) setFilterOpen(prev => !prev); }}
                aria-haspopup="menu"
                aria-expanded={filterOpen}
                title={filterEmpty
                  ? 'Фильтровать нечего: привязок «Требует проверки» или «Утрачено» нет'
                  : 'Фильтр дерева по статусу привязок'}
                style={{
                  width: '34px', height: '34px', padding: 0,
                  borderRadius: radii.md,
                  border: `1px solid ${filterActive ? 'rgba(122, 224, 90, 0.55)' : colors.border}`,
                  background: filterActive ? colors.greenLight : colors.white,
                  color: filterActive ? colors.greenDark
                    : filterEmpty ? colors.textTertiary : colors.textSecondary,
                  cursor: filterEmpty ? 'default' : 'pointer',
                  opacity: filterEmpty ? 0.55 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  if (filterActive || filterEmpty) return;
                  e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                  e.currentTarget.style.borderColor = colors.borderHover;
                  e.currentTarget.style.color = colors.textPrimary;
                }}
                onMouseLeave={e => {
                  if (filterActive || filterEmpty) return;
                  e.currentTarget.style.background = colors.white;
                  e.currentTarget.style.borderColor = colors.border;
                  e.currentTarget.style.color = colors.textSecondary;
                }}
              >
                <FilterIcon size={15} />
              </button>
            );
          })()}
          {filterMounted && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 30,
                padding: '8px',
                background: colors.white,
                border: `1px solid ${colors.border}`,
                borderRadius: radii.md,
                boxShadow: shadows.panel,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                ...filterFade,
              }}
            >
              {STATUS_FILTERS.map(option => {
                const count = statusTotals[option.key];
                const active = statusFilter === option.key;
                const disabled = count === 0 && !active;
                return (
                  <button
                    key={option.key}
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      if (disabled) return;
                      setStatusFilter(active ? null : option.key);
                      setFilterOpen(false);
                    }}
                    title={disabled
                      ? 'Таких привязок сейчас нет'
                      : active ? 'Снять фильтр' : option.title}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 10px',
                      borderRadius: radii.pill,
                      border: `1px solid ${active ? 'transparent' : colors.border}`,
                      background: active ? colors.greenLight : 'transparent',
                      color: active ? colors.greenDark
                        : disabled ? colors.textTertiary : colors.textSecondary,
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: disabled ? 'default' : 'pointer',
                      fontFamily: 'inherit',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s',
                      opacity: disabled ? 0.55 : 1,
                    }}
                    onMouseEnter={e => {
                      if (!active && !disabled) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                    }}
                    onMouseLeave={e => {
                      if (!active) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {option.label}
                    <span style={{ opacity: 0.75, marginLeft: 'auto' }}>{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Tree content */}
      <div className="island-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 10px 4px' }}>
        {loading ? (
          // Пусто до порога 200мс, дальше — мягкая строка с фирменным
          // лоадером (тот же loadstate, что у страницы требований).
          showLoader ? (
            // height 100% + центрирование: строка стоит по центру колонки
            // дерева, а не прижата к верхнему левому углу.
            <FadeIn style={{ height: '100%' }}>
              <div style={{
                height: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '8px',
                color: colors.textTertiary, fontSize: '12px',
              }}>
                <RefreshIcon size={13} spinning />
                Загружаем дерево…
              </div>
            </FadeIn>
          ) : null
        ) : projects.length === 0 ? (
          <div style={{ padding: '20px 4px', textAlign: 'center' }}>
            <div style={{
              display: 'flex', justifyContent: 'center', marginBottom: '8px',
              color: colors.textTertiary, opacity: 0.55,
            }}>
              <DocumentIcon size={26} strokeWidth={1.6} />
            </div>
            <div style={{ fontSize: '12px', color: colors.textTertiary, marginBottom: '12px' }}>
              Нет проектов. Подключите проект в своём профиле — или попробуйте демо-страницу
            </div>
            {/* Колонкой: в ряд кнопки упирались друг в друга на узком дереве
                и переносили текст по слову на строку. */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
            }}>
              <button
                onClick={() => navigate('/settings')}
                style={{
                  padding: '6px 12px',
                  borderRadius: radii.sm,
                  border: 'none',
                  background: colors.greenAccent,
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Профиль и проекты
              </button>
              <button
                onClick={handleAddDemo}
                style={{
                  padding: '6px 12px',
                  borderRadius: radii.sm,
                  border: `1px solid ${colors.border}`,
                  background: 'transparent',
                  color: colors.textSecondary,
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Демо-страница
              </button>
            </div>
          </div>
        ) : !hasAnyPages && projects.every(p => !p.no_access) ? (
          <div style={{ padding: '20px 4px', textAlign: 'center' }}>
            <div style={{
              display: 'flex', justifyContent: 'center', marginBottom: '8px',
              color: colors.textTertiary, opacity: 0.55,
            }}>
              <DocumentIcon size={26} strokeWidth={1.6} />
            </div>
            <div style={{ fontSize: '12px', color: colors.textTertiary, marginBottom: '12px' }}>
              Нет страниц
            </div>
            {/* Колонкой, как в состоянии «нет проектов»: главное действие —
                добавить первую страницу (кнопка из шапки дерева уехала к
                карточке проекта, v1.8.1 — пустому дереву нужен свой вход). */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
            }}>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('reqtrace:open-add-page'))}
                style={{
                  padding: '6px 12px',
                  borderRadius: radii.sm,
                  border: 'none',
                  background: colors.greenAccent,
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Добавить страницу
              </button>
              <button
                onClick={handleAddDemo}
                style={{
                  padding: '6px 12px',
                  borderRadius: radii.sm,
                  border: `1px solid ${colors.border}`,
                  background: 'transparent',
                  color: colors.textSecondary,
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Демо-страница
              </button>
            </div>
          </div>
        ) : isEmptySearch ? (
          <div style={{ padding: '12px 4px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: colors.textTertiary }}>
              Ничего не найдено
            </div>
          </div>
        ) : (
          filteredProjects.map(project => (
            <ProjectNode
              key={project.project_id}
              project={project}
              expandState={expandState}
              toggleExpand={toggleExpand}
              activePageId={activePageId}
              navigate={navigate}
              isSearching={isFiltering}
              searchQuery={searchQuery}
            />
          ))
        )}
      </div>
    </div>
  );
};

// --- Project node (верхний уровень дерева) ---

interface ProjectNodeProps {
  project: ProjectTree;
  expandState: Record<string, boolean>;
  toggleExpand: (key: string) => void;
  activePageId: string | null;
  navigate: (path: string) => void;
  isSearching: boolean;
  searchQuery: string;
}

const ProjectNode: React.FC<ProjectNodeProps> = ({
  project, expandState, toggleExpand, activePageId, navigate, isSearching, searchQuery,
}) => {
  const projectKey = `project:${project.project_id}`;
  const isExpanded = isSearching || expandState[projectKey] === true;

  if (project.no_access) {
    // Замок: креды невалидны — содержимое закрыто, клик ведёт в профиль.
    return (
      <div style={{ marginBottom: '4px' }}>
        <button
          onClick={() => navigate('/settings')}
          title={`Нет доступа к проекту «${project.project_name}» — Confluence отклонил ваши логин/пароль. Нажмите, чтобы обновить креды в профиле`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            width: '100%',
            padding: '5px 4px',
            border: 'none',
            borderRadius: radii.sm,
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          <LockIcon size={12} style={{ color: colors.textTertiary }} />
          <span style={{
            fontSize: '12.5px',
            fontWeight: 600,
            color: colors.textTertiary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}>
            {project.project_name}
          </span>
          <span style={{ fontSize: '10px', color: colors.textTertiary, flexShrink: 0 }}>
            нет доступа
          </span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '6px' }}>
      <button
        onClick={() => toggleExpand(projectKey)}
        title={project.project_name}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          width: '100%',
          padding: '5px 4px',
          border: 'none',
          borderRadius: radii.sm,
          background: 'transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <TreeChevron expanded={isExpanded} size={13} />
        <span style={{
          fontSize: '12.5px',
          fontWeight: 700,
          color: colors.textPrimary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}>
          {project.project_name}
        </span>
      </button>
      <div style={{ marginLeft: '8px' }}>
        <TreeReveal expanded={isExpanded}>
          {project.spaces.map(space => (
            <SpaceNode
              key={space.space_key}
              projectId={project.project_id}
              space={space}
              expandState={expandState}
              toggleExpand={toggleExpand}
              activePageId={activePageId}
              navigate={navigate}
              isSearching={isSearching}
              searchQuery={searchQuery}
            />
          ))}
        </TreeReveal>
      </div>
    </div>
  );
};

// --- Space node ---

interface SpaceNodeProps {
  projectId: string;
  space: SpaceTree;
  expandState: Record<string, boolean>;
  toggleExpand: (key: string) => void;
  activePageId: string | null;
  navigate: (path: string) => void;
  isSearching: boolean;
  searchQuery: string;
}

const SpaceNode: React.FC<SpaceNodeProps> = ({ projectId, space, expandState, toggleExpand, activePageId, navigate, isSearching, searchQuery }) => {
  const spaceKey = `space:${projectId}:${space.space_key}`;
  const isExpanded = isSearching || expandState[spaceKey] === true; // collapsed by default; force expand when searching

  // Build children map
  const childrenMap = useMemo(() => {
    const map: Record<string, TreeNodeItem[]> = { __roots__: [] };
    for (const page of space.pages) {
      if (!page.parent_confluence_page_id) {
        map.__roots__.push(page);
      } else {
        const parentKey = page.parent_confluence_page_id;
        if (!map[parentKey]) map[parentKey] = [];
        map[parentKey].push(page);
      }
    }

    // Pages whose parent is not in this space's page list → treat as roots
    const allCpids = new Set(space.pages.map(p => p.confluence_page_id));
    for (const page of space.pages) {
      if (page.parent_confluence_page_id && !allCpids.has(page.parent_confluence_page_id)) {
        // Parent not in this space, move to roots
        const parentKey = page.parent_confluence_page_id;
        const arr = map[parentKey];
        if (arr) {
          const idx = arr.indexOf(page);
          if (idx !== -1) arr.splice(idx, 1);
          if (arr.length === 0) delete map[parentKey];
        }
        map.__roots__.push(page);
      }
    }

    return map;
  }, [space.pages]);

  return (
    <div style={{ marginBottom: '4px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '2px 4px',
      }}>
        <button
          onClick={() => toggleExpand(spaceKey)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            flex: 1,
            minWidth: 0,
            padding: '4px 0',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          <TreeChevron expanded={isExpanded} size={12} />
          <span style={{
            fontSize: '12px',
            fontWeight: 600,
            color: colors.textSecondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {space.space_key}
          </span>
        </button>
      </div>
      <TreeReveal expanded={isExpanded}>
        {childrenMap.__roots__.map(node => (
          <TreeNodeComponent
            key={node.id}
            node={node}
            childrenMap={childrenMap}
            depth={0}
            expandState={expandState}
            toggleExpand={toggleExpand}
            activePageId={activePageId}
            navigate={navigate}
            isSearching={isSearching}
            searchQuery={searchQuery}
          />
        ))}
      </TreeReveal>
    </div>
  );
};

// --- Tree node ---

interface TreeNodeProps {
  node: TreeNodeItem;
  childrenMap: Record<string, TreeNodeItem[]>;
  depth: number;
  expandState: Record<string, boolean>;
  toggleExpand: (key: string) => void;
  activePageId: string | null;
  navigate: (path: string) => void;
  isSearching: boolean;
  searchQuery: string;
}

const TreeNodeComponent: React.FC<TreeNodeProps> = React.memo(({
  node, childrenMap, depth, expandState, toggleExpand, activePageId, navigate, isSearching, searchQuery,
}) => {
  const children = childrenMap[node.confluence_page_id] || [];
  const hasChildren = children.length > 0;
  const nodeKey = `page:${node.confluence_page_id}`;
  const isExpanded = hasChildren && (isSearching || expandState[nodeKey] === true);
  const isActive = activePageId === node.id;

  const handleClick = () => {
    if (node.is_virtual) {
      navigate(`/pages/${node.id}`);
      if (hasChildren) toggleExpand(nodeKey);
    } else {
      navigate(`/pages/${node.id}`);
    }
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleExpand(nodeKey);
  };

  // Точка — худший статус привязок страницы: утрачено > требует проверки >
  // актуально. Нет привязок (или виртуальная страница) — нет точки.
  const statusDotColor = node.is_virtual ? undefined
    : node.highlights_lost > 0 ? colors.statusLost
    : node.highlights_outdated > 0 ? colors.statusOutdated
    : node.highlights_active > 0 ? colors.statusActive
    : undefined;

  const breakdown = [
    node.highlights_active > 0 && `актуально: ${node.highlights_active}`,
    node.highlights_outdated > 0 && `требует проверки: ${node.highlights_outdated}`,
    node.highlights_lost > 0 && `утрачено: ${node.highlights_lost}`,
  ].filter(Boolean).join(', ');
  const nodeTooltip = breakdown ? `${node.title}\nПривязки — ${breakdown}` : node.title;

  return (
    <div>
      <button
        onClick={handleClick}
        title={nodeTooltip}
        // Якорь подскролла: раскрытие дерева на странице (requestTreeReveal)
        // доводит эту строку в видимую область.
        data-tree-page-id={node.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          width: '100%',
          padding: '4px 4px',
          paddingLeft: `${8 + depth * 14}px`,
          border: 'none',
          borderRadius: radii.sm,
          background: isActive ? colors.greenLight : 'transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => {
          if (!isActive) e.currentTarget.style.background = 'rgba(0,0,0,0.03)';
        }}
        onMouseLeave={e => {
          if (!isActive) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Chevron */}
        {hasChildren ? (
          <span
            onClick={handleChevronClick}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '12px',
              height: '12px',
              flexShrink: 0,
            }}
          >
            <TreeChevron expanded={isExpanded} size={12} />
          </span>
        ) : (
          <span style={{ width: '12px', flexShrink: 0 }} />
        )}

        {/* Точка худшего статуса привязок */}
        {statusDotColor && (
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: statusDotColor,
            flexShrink: 0,
          }} />
        )}

        {/* Title */}
        <span style={{
          fontSize: '13px',
          fontWeight: isActive ? 600 : 400,
          color: isActive ? colors.greenDark
            : node.is_virtual ? colors.textTertiary
            : colors.textPrimary,
          fontStyle: node.is_virtual ? 'italic' : 'normal',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}>
          {isSearching ? highlightMatch(node.title, searchQuery) : node.title}
        </span>
      </button>

      {/* Children — каскад появления сверху вниз и сворачивания снизу вверх */}
      {hasChildren && (
        <TreeReveal expanded={isExpanded}>
          {children.map(child => (
            <TreeNodeComponent
              key={child.id}
              node={child}
              childrenMap={childrenMap}
              depth={depth + 1}
              expandState={expandState}
              toggleExpand={toggleExpand}
              activePageId={activePageId}
              navigate={navigate}
              isSearching={isSearching}
              searchQuery={searchQuery}
            />
          ))}
        </TreeReveal>
      )}
    </div>
  );
});

export default PageTree;
