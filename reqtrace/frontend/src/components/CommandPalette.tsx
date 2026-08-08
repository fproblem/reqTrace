// Глобальный поиск (Cmd+K / Ctrl+K, бэклог «UX-пакет»): палитра над всем
// приложением — страницы по названию, тесты по ключу и названию из Jira,
// проекты по имени; пустой запрос показывает недавно открытые страницы.
//
// Оверлей — по образцу Modal.tsx (портал в body, фон-затемнение, z 2000),
// но окно стоит у верхней кромки (как Spotlight/палитры редакторов) и вместо
// заголовка несёт поле ввода. role="dialog" обязателен: слушатели Escape и
// стрелок в SidePanel уступают клавиши любому открытому диалогу — палитра
// пользуется этим соглашением.
//
// Данные собираются при каждом открытии: дерево страниц (лёгкое, уже живёт
// в сайдбаре) — мгновенно, реверс-индексы тестов проектов — параллельно
// вторым заходом (лёгкий список v1.7.3, без цитат). Пока тесты едут, поиск
// уже работает по страницам и проектам.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { colors, radii, shadows } from '../styles/tokens';
import { useFadeToggle } from './fadePresence';
import { ClipboardCheckIcon, DocumentIcon, SearchIcon, TargetIcon } from './icons';
import { OVERLAY_Z } from './Modal';
import { RefreshIcon } from './RefreshIcon';
import { highlightMatch } from './Layout/PageTree';
import { useTreeRefresh } from '../hooks/useTreeRefresh';
import { PaletteEntry, PaletteKind, searchPalette } from './paletteSearch';
import { listRecentPages } from './recentPages';

// Кэш индекса палитры — модульный, на сессию SPA (ревью v1.8.1): каждое
// открытие раньше заново гоняло дерево + реверс-индексы ВСЕХ проектов
// (бэку это полный проход по привязкам), а быстрые тумблеры ⌘K складывали
// параллельные штормы. Теперь: повторные открытия отвечают из кэша сразу,
// свежая версия доезжает фоном (stale-while-revalidate); одновременные
// открытия делят один полёт запросов; смена дерева (useTreeRefresh)
// сбрасывает кэш.
let paletteCache: PaletteEntry[] | null = null;
let paletteInflight: Promise<PaletteEntry[]> | null = null;

export function invalidatePaletteCache(): void {
  paletteCache = null;
}

// Порядок массива не важен: группировку и порядок выдачи решает
// searchPalette (GROUP_ORDER), пустой запрос смотрит только на kind==='page'.
async function buildPaletteIndex(): Promise<PaletteEntry[]> {
  const tree = await api.getPageTree();
  const entries: PaletteEntry[] = [];
  const accessible = tree.filter(p => !p.no_access);
  for (const project of accessible) {
    entries.push({
      kind: 'project',
      id: project.project_id,
      title: project.project_name,
      projectId: project.project_id,
    });
    for (const space of project.spaces) {
      for (const page of space.pages) {
        entries.push({
          kind: 'page',
          id: page.id,
          title: page.title,
          subtitle: `${project.project_name} · ${space.space_key}`,
          projectId: project.project_id,
        });
      }
    }
  }
  const results = await Promise.allSettled(
    accessible.map(p => api.getProjectTests(p.project_id)),
  );
  for (const res of results) {
    if (res.status !== 'fulfilled') continue; // проект не ответил — ищем без него
    for (const t of res.value.tests) {
      entries.push({
        kind: 'test',
        id: t.key,
        title: t.key,
        subtitle: t.summary ?? res.value.project_name,
        projectId: res.value.project_id,
      });
    }
  }
  return entries;
}

function loadPaletteIndex(): Promise<PaletteEntry[]> {
  if (!paletteInflight) {
    paletteInflight = buildPaletteIndex().finally(() => {
      paletteInflight = null;
    });
  }
  return paletteInflight;
}

const GROUP_TITLES: Record<PaletteKind, string> = {
  page: 'Страницы',
  test: 'Тесты',
  project: 'Проекты',
};

const KIND_ICONS: Record<PaletteKind, React.FC<{ size?: number; style?: React.CSSProperties }>> = {
  page: DocumentIcon,
  test: ClipboardCheckIcon,
  project: TargetIcon,
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const { mounted, fadeStyle } = useFadeToggle(open);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [recent, setRecent] = useState<{ id: string; title: string }[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [selected, setSelected] = useState(0);
  // Индекс хоть раз приезжал (кэш или свежий): только тогда фильтруем
  // недавние по живым страницам — иначе «нет данных» съедал бы историю.
  const [indexLoaded, setIndexLoaded] = useState(false);

  // Изменения дерева (добавили/удалили страницу, синк, прогоны) — кэш
  // палитры устарел.
  const { version: treeVersion } = useTreeRefresh();
  useEffect(() => { invalidatePaletteCache(); }, [treeVersion]);

  // Сбор данных на открытие: кэш показывается сразу, свежий индекс доезжает
  // фоном. Токен открытия отменяет отставшие ответы; закрытие тоже гасит
  // токен (cleanup) — ответ не трогает закрытую палитру и не оставляет
  // лоадер взведённым.
  const openTokenRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    const token = ++openTokenRef.current;
    setQuery('');
    setSelected(0);
    setRecent(listRecentPages());
    if (paletteCache) {
      setEntries(paletteCache);
      setIndexLoaded(true);
    }
    setLoadingTests(!paletteCache);

    void loadPaletteIndex()
      .then(index => {
        paletteCache = index;
        if (openTokenRef.current !== token) return;
        setEntries(index);
        setIndexLoaded(true);
      })
      .catch(() => {
        // Сеть не ответила — палитра остаётся с кэшем/недавними страницами.
      })
      .finally(() => {
        if (openTokenRef.current === token) setLoadingTests(false);
      });
    return () => { openTokenRef.current++; };
  }, [open]);

  // Автофокус после появления в DOM (mounted приходит из useFadeToggle).
  useEffect(() => {
    if (open && mounted) inputRef.current?.focus();
  }, [open, mounted]);

  // Выдача: по запросу — поиск, без запроса — недавние страницы (пересечённые
  // с живыми: удалённая страница не должна вести в «не найдено»). Фильтр —
  // только когда индекс реально приезжал (indexLoaded): «дерево ещё едет» и
  // «у пользователя ноль страниц» — разные состояния, и пустое множество
  // known само по себе не повод показывать историю как есть.
  const results = useMemo<PaletteEntry[]>(() => {
    if (query.trim()) return searchPalette(entries, query);
    const known = new Set(entries.filter(e => e.kind === 'page').map(e => e.id));
    return recent
      .filter(r => !indexLoaded || known.has(r.id))
      .map(r => ({ kind: 'page' as const, id: r.id, title: r.title, projectId: '' }));
  }, [entries, recent, query, indexLoaded]);
  const isRecent = !query.trim();

  // Сброс выбора при ЛЮБОЙ смене выдачи, не только запроса: дозагрузка
  // индекса тестов пересобирает результаты, и Enter по старому индексу
  // открывал бы не ту строку, на которой стояла подсветка.
  useEffect(() => { setSelected(0); }, [results]);

  const go = useCallback((entry: PaletteEntry) => {
    onClose();
    if (entry.kind === 'page') {
      navigate(`/pages/${entry.id}`);
    } else if (entry.kind === 'project') {
      navigate(`/tests/${entry.projectId}`);
    } else {
      // Экран тестов проекта читает поиск из URL (?q=) — строка ключа
      // откроется уже отфильтрованной.
      navigate(`/tests/${entry.projectId}?q=${encodeURIComponent(entry.id)}`);
    }
  }, [navigate, onClose]);

  // Клавиатура — на документе: фокус всегда в поле, но стрелки не должны
  // теряться, даже если он ушёл (клик по пустому месту списка).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected(prev => {
          if (results.length === 0) return 0;
          const next = e.key === 'ArrowDown' ? prev + 1 : prev - 1;
          return (next + results.length) % results.length;
        });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const entry = results[selected];
        if (entry) go(entry);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, results, selected, go, onClose]);

  // Выбранная строка следует за клавиатурой — доводим её в видимую область.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '13vh',
        zIndex: OVERLAY_Z,
        ...fadeStyle,
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: '560px',
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: '60vh',
          background: colors.white,
          borderRadius: radii.lg,
          boxShadow: shadows.card,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Поле запроса — вместо заголовка окна. */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '0 16px',
          height: '52px',
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}>
          <span style={{ color: colors.textTertiary, display: 'flex', flexShrink: 0 }}>
            <SearchIcon size={15} />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Страница, ключ теста или проект…"
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              fontSize: '14px',
              fontFamily: 'inherit',
              color: colors.textPrimary,
              background: 'transparent',
            }}
          />
          {loadingTests && (
            <span
              title="Собираем индекс тестов…"
              style={{ color: colors.textTertiary, display: 'flex', flexShrink: 0 }}
            >
              <RefreshIcon size={13} spinning />
            </span>
          )}
        </div>

        {/* Выдача. */}
        <div ref={listRef} className="island-scroll" style={{ overflowY: 'auto', minHeight: 0, padding: '8px' }}>
          {results.length === 0 ? (
            <div style={{
              padding: '22px 16px',
              textAlign: 'center',
              fontSize: '13px',
              color: colors.textTertiary,
            }}>
              {isRecent
                ? 'Начните вводить название страницы, ключ теста или имя проекта'
                : 'Ничего не найдено'}
            </div>
          ) : (
            results.map((entry, idx) => {
              const Icon = KIND_ICONS[entry.kind];
              const isSelected = idx === selected;
              const groupTitle = isRecent
                ? (idx === 0 ? 'Недавние страницы' : null)
                : (idx === 0 || results[idx - 1].kind !== entry.kind
                  ? GROUP_TITLES[entry.kind]
                  : null);
              return (
                <React.Fragment key={`${entry.kind}:${entry.projectId}:${entry.id}`}>
                  {groupTitle && (
                    <div style={{
                      padding: '10px 10px 4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: colors.textTertiary,
                    }}>
                      {groupTitle}
                    </div>
                  )}
                  <button
                    data-idx={idx}
                    onClick={() => go(entry)}
                    onMouseMove={() => { if (!isSelected) setSelected(idx); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      width: '100%',
                      padding: '8px 10px',
                      border: 'none',
                      borderRadius: radii.md,
                      background: isSelected ? colors.greenLight : 'transparent',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      color: isSelected ? colors.greenDark : colors.textTertiary,
                      display: 'flex',
                      flexShrink: 0,
                    }}>
                      <Icon size={15} />
                    </span>
                    <span style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: isSelected ? colors.greenDark : colors.textPrimary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      maxWidth: '60%',
                    }}>
                      {highlightMatch(entry.title, query)}
                    </span>
                    {entry.subtitle && (
                      <span style={{
                        fontSize: '12px',
                        color: colors.textTertiary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}>
                        {highlightMatch(entry.subtitle, query)}
                      </span>
                    )}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* Подсказка-футер: язык клавиш палитры — на виду. */}
        <div style={{
          display: 'flex',
          gap: '14px',
          padding: '8px 16px',
          borderTop: `1px solid ${colors.border}`,
          fontSize: '11px',
          color: colors.textTertiary,
          flexShrink: 0,
        }}>
          <span>↑↓ — выбор</span>
          <span>Enter — открыть</span>
          <span>Esc — закрыть</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};
