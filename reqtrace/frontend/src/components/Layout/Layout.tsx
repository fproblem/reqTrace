import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { colors, radii, glassmorphism, fonts } from '../../styles/tokens';
import { ChangelogModal, useCurrentVersion } from '../ChangelogModal';
import { PageTree } from './PageTree';
import { BellIcon, ClipboardCheckIcon, LogoutIcon } from '../icons';

interface LayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_KEY = 'reqtrace_sidebar';
// Порог появления/сворачивания дерева при перетаскивании. 220 — минимум, при
// котором в шапке панели уживаются поиск и две кнопки 34px (у́же — поле
// поиска сжималось в щель и налезало на кнопки), а тексты пустых состояний
// не рвутся по слову на строку. Сохранённая ширина у́же порога подтянется
// при загрузке (см. loadSidebarState).
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;
const RAIL_WIDTH = 48;

interface SidebarState {
  width: number;
  collapsed: boolean;
}

function loadSidebarState(): SidebarState {
  try {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const width = typeof parsed.width === 'number'
        ? Math.min(Math.max(parsed.width, MIN_WIDTH), MAX_WIDTH)
        : DEFAULT_WIDTH;
      return { width, collapsed: !!parsed.collapsed };
    }
  } catch {
    // ignore malformed state
  }
  return { width: DEFAULT_WIDTH, collapsed: false };
}

const Chevron: React.FC<{ dir: 'left' | 'right'; size?: number }> = ({ dir, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'block' }}
  >
    <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
  </svg>
);

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [changelogOpen, setChangelogOpen] = useState(false);
  const currentVersion = useCurrentVersion();

  const [sidebar, setSidebar] = useState<SidebarState>(loadSidebarState);
  const asideRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const rawXRef = useRef(sidebar.width);
  const zoneRef = useRef(false); // true while drag width is past MIN_WIDTH (tree shown)
  const [dragging, setDragging] = useState(false);
  const [dragTree, setDragTree] = useState(false);

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebar));
  }, [sidebar]);

  // During drag we mutate the aside width directly (bypassing React) so a large
  // PageTree doesn't re-render on every mouse move; we commit to state on release.
  const onDrag = useCallback((e: MouseEvent) => {
    if (!draggingRef.current) return;
    const x = e.clientX;
    rawXRef.current = x;
    // Width follows the cursor smoothly (direct DOM write, no re-render → no jank).
    if (asideRef.current) {
      asideRef.current.style.width = `${Math.min(Math.max(x, RAIL_WIDTH), MAX_WIDTH)}px`;
    }
    // Content swaps rail↔tree once when crossing MIN_WIDTH — width stays smooth, only
    // the contents change, so the tree appears as soon as we reach 150px.
    const tree = x >= MIN_WIDTH;
    if (tree !== zoneRef.current) {
      zoneRef.current = tree;
      setDragTree(tree);
    }
  }, []);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);

    // On release decide by final position: narrower than MIN_WIDTH → collapse, else expand.
    const x = rawXRef.current;
    const collapsed = x < MIN_WIDTH;
    const finalWidth = collapsed ? RAIL_WIDTH : Math.min(x, MAX_WIDTH);
    // Width was set imperatively during the drag (bypassing React), so React may skip
    // the DOM write when the committed value matches its last render (e.g. collapsing
    // back to the rail: 48 → 48). Snap the DOM ourselves and restore the transition.
    if (asideRef.current) {
      asideRef.current.style.transition = 'width 0.18s ease';
      asideRef.current.style.width = `${finalWidth}px`;
    }
    if (collapsed) {
      setSidebar(prev => ({ ...prev, collapsed: true }));
    } else {
      setSidebar({ width: finalWidth, collapsed: false });
    }
  }, [onDrag]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    rawXRef.current = e.clientX;
    // Зону контента (дерево/рельса) инициализируем по фактической позиции
    // курсора: dragTree — остаточное состояние ПРОШЛОГО драга (изначально
    // false), и без этого клик по линии без движения мгновенно подменял
    // дерево рельсой со стрелкой — до первого mousemove.
    const tree = e.clientX >= MIN_WIDTH;
    zoneRef.current = tree;
    setDragTree(tree);
    setDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    if (asideRef.current) asideRef.current.style.transition = 'none';
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  }, [onDrag, endDrag]);

  // Safety: drop listeners if unmounted mid-drag
  useEffect(() => () => {
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);
  }, [onDrag, endDrag]);

  const toggleCollapsed = useCallback(() => {
    setSidebar(prev => ({
      width: prev.width || DEFAULT_WIDTH,
      collapsed: !prev.collapsed,
    }));
  }, []);

  const isSettings = location.pathname === '/settings';
  const isTests = location.pathname === '/tests' || location.pathname.startsWith('/tests/');
  // During a drag the contents follow the cursor zone (tree once width >= MIN_WIDTH),
  // while the width tracks the cursor smoothly. Outside a drag they follow the
  // committed state. Release commits the dragged width as-is (no snap-back → no bounce).
  const showRail = dragging ? !dragTree : sidebar.collapsed;
  const width = dragging
    ? Math.min(Math.max(rawXRef.current, RAIL_WIDTH), MAX_WIDTH)
    : (sidebar.collapsed ? RAIL_WIDTH : sidebar.width);

  // Same drag handle works both ways: drag left to collapse, drag right to expand.
  // Грип-маркер («‖») убран: чёрточки висели поверх контента страницы рядом с
  // разделителем. Вместо него тянется сама линия: узкая зона захвата (±4px)
  // оседлала правую границу сайдбара, а визуальный отклик — подсветка линии
  // ровно по разделителю при наведении и на всё время перетаскивания.
  const resizeHandle = (
    <div
      onMouseDown={startDrag}
      title={sidebar.collapsed ? 'Потяните вправо, чтобы раскрыть' : 'Потяните, чтобы изменить ширину (до упора — свернуть)'}
      style={{
        position: 'absolute', top: 0, right: '-4px', width: '8px', height: '100%',
        cursor: 'col-resize', zIndex: 3,
        display: 'flex', justifyContent: 'center',
      }}
      onMouseEnter={e => {
        // greenLight, не greenAccent: неоновая линия во всю высоту выбивалась
        // из приглушённой стилистики интерфейса.
        const line = e.currentTarget.firstElementChild as HTMLElement | null;
        if (line) line.style.background = colors.greenLight;
      }}
      onMouseLeave={e => {
        // Во время перетаскивания курсор уходит с зоны захвата — линия
        // остаётся подсвеченной, погасит её ре-рендер по окончании драга.
        if (draggingRef.current) return;
        const line = e.currentTarget.firstElementChild as HTMLElement | null;
        if (line) line.style.background = 'transparent';
      }}
    >
      <div style={{
        width: '2px', height: '100%',
        background: dragging ? colors.greenLight : 'transparent',
        transition: 'background 0.15s',
        pointerEvents: 'none',
      }} />
    </div>
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      fontFamily: fonts.body,
      background: colors.background,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background blobs. Сиреневого в углу шапки/сайдбара сознательно НЕТ:
          он просвечивал сквозь их полупрозрачный фон и красил разделительные
          линии в разные оттенки вдоль ширины (линии «разного цвета»). */}
      <div style={{
        position: 'fixed', bottom: '-15%', right: '-5%',
        width: '600px', height: '600px', borderRadius: '50%',
        background: colors.blobGreen, filter: 'blur(80px)', zIndex: 0,
      }} />
      <div style={{
        position: 'fixed', top: '40%', right: '20%',
        width: '400px', height: '400px', borderRadius: '50%',
        background: colors.blobYellow, filter: 'blur(80px)', zIndex: 0,
      }} />

      {/* Top bar */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '64px',
        flexShrink: 0,
        // Правый отступ 24px — как у верхнего бара страницы и шапки панели
        // выделения: кнопка выхода встаёт в одну вертикаль с «Ещё действия»
        // и крестиком закрытия панели (гэп между кнопками у всех баров 10px).
        padding: '0 24px 0 16px',
        ...glassmorphism,
        // glassmorphism несёт рамку со всех сторон — шапке нужна только нижняя,
        // остальные рисовали лишние линии по краям окна.
        border: 'none',
        borderBottom: `1px solid ${colors.border}`,
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Left: brand */}
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <img
            src={`${process.env.PUBLIC_URL}/logo-header.svg?v=${currentVersion}`}
            alt="ReqTrace"
            onClick={() => navigate('/')}
            style={{ height: '42px', display: 'block', cursor: 'pointer', flexShrink: 0 }}
          />
        </div>

        {/* Чип версии — кнопка в общем стиле баров (34px, radii.md, тот же
            ховер и пресс). Позиция абсолютная: левый край совпадает с левым
            краем кнопки синхронизации дерева (width − 10px паддинга −
            34px «+» − 6px гэпа − 34px синка = width − 84); на узком дереве
            (или свёрнутой рельсе) прижимается к логотипу (187 ≈ 16px отступа +
            161px ширины лого при высоте 42 + 10px зазора), чтобы не наезжать. */}
        {currentVersion && (
          <button
            onClick={() => setChangelogOpen(true)}
            title="История изменений"
            style={{
              position: 'absolute',
              left: `${Math.max((showRail ? 0 : width) - 84, 187)}px`,
              top: '50%',
              transform: 'translateY(-50%)',
              height: '34px',
              padding: '0 14px',
              borderRadius: radii.md,
              border: `1px solid ${colors.border}`,
              background: colors.white,
              color: colors.textSecondary,
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
              e.currentTarget.style.borderColor = colors.borderHover;
              e.currentTarget.style.color = colors.textPrimary;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = colors.white;
              e.currentTarget.style.borderColor = colors.border;
              e.currentTarget.style.color = colors.textSecondary;
            }}
            onMouseDown={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
            onMouseUp={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
          >
            v{currentVersion}
          </button>
        )}

        {/* Right: профиль и выход. Аватар, имя и экран настроек «склеены» в
            один профиль-чип: настройки в ReqTrace — это ЛИЧНЫЕ подключения
            пользователя («Профиль и проекты»), а не свойства приложения,
            поэтому вход туда живёт под лицом пользователя, а не отдельной
            кнопкой. «Выйти» — кнопка-иконка в общем стиле кнопок баров. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {/* Раздел «Тесты» — реверс-индекс «тест → требования». Полноценная
              кнопка с текстом (не квадратик): раздел новый, его нужно найти.
              Серая в покое, зелёная — когда раздел открыт (как профиль-чип). */}
          {user && (
            <button
              onClick={() => navigate('/tests')}
              title="Тесты проектов: какие требования держит каждый тест"
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                height: '34px', padding: '0 14px',
                borderRadius: radii.md,
                border: `1px solid ${isTests ? 'rgba(122, 224, 90, 0.55)' : colors.border}`,
                background: isTests ? colors.greenLight : 'rgba(0,0,0,0.03)',
                color: isTests ? colors.greenDark : colors.textSecondary,
                fontSize: '13px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                if (isTests) return;
                e.currentTarget.style.background = 'rgba(0,0,0,0.07)';
                e.currentTarget.style.borderColor = colors.borderHover;
                e.currentTarget.style.color = colors.textPrimary;
              }}
              onMouseLeave={e => {
                if (isTests) return;
                e.currentTarget.style.background = 'rgba(0,0,0,0.03)';
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.color = colors.textSecondary;
              }}
              onMouseDown={e => { if (!isTests) e.currentTarget.style.background = 'rgba(0,0,0,0.10)'; }}
              onMouseUp={e => { if (!isTests) e.currentTarget.style.background = 'rgba(0,0,0,0.07)'; }}
            >
              <ClipboardCheckIcon size={15} />
              Тесты
            </button>
          )}
          {/* Дивайдер отделяет разделы приложения от персонального кластера —
              как разделители в шапках панели и страницы. */}
          {user && (
            <div style={{ width: '1px', height: '24px', background: colors.border, flexShrink: 0 }} />
          )}
          {user && (
            <button
              onClick={() => navigate('/settings')}
              title={`Профиль и проекты${user.email ? `\n${user.email}` : ''}`}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                height: '34px', boxSizing: 'border-box',
                padding: '0 12px 0 4px', borderRadius: radii.pill,
                // Рамка и белый фон — как у остальных кнопок баров: без них
                // чип читался просто как имя, а не как кнопка.
                border: `1px solid ${isSettings ? 'rgba(122, 224, 90, 0.55)' : colors.border}`,
                background: isSettings ? colors.greenLight : colors.white,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                if (isSettings) return;
                e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                e.currentTarget.style.borderColor = colors.borderHover;
              }}
              onMouseLeave={e => {
                if (isSettings) return;
                e.currentTarget.style.background = colors.white;
                e.currentTarget.style.borderColor = colors.border;
              }}
            >
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  referrerPolicy="no-referrer"
                  style={{
                    width: '26px', height: '26px', borderRadius: '50%',
                    display: 'block', flexShrink: 0,
                    border: `1px solid ${colors.border}`,
                  }}
                />
              ) : (
                <span style={{
                  width: '26px', height: '26px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, background: colors.greenLight,
                  color: colors.greenDark, fontSize: '13px', fontWeight: 700,
                }}>
                  {(user.name || '?').charAt(0).toUpperCase()}
                </span>
              )}
              <span style={{
                fontSize: '13px', fontWeight: 600,
                color: isSettings ? colors.greenDark : colors.textPrimary,
              }}>
                {user.name}
              </span>
            </button>
          )}

          {/* Колокольчик — замах на систему оповещений и дайджестов: место
              застолблено уже сейчас, кнопка сознательно НЕАКТИВНАЯ на вид
              (приглушена, без ховера и клика) — тултип обещает будущее. */}
          {user && (
            <button
              title="Уведомления и дайджесты — скоро"
              aria-disabled
              style={{
                width: '34px', height: '34px', padding: 0,
                borderRadius: radii.md,
                border: `1px solid ${colors.border}`,
                background: colors.white,
                color: colors.textTertiary,
                opacity: 0.55,
                cursor: 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <BellIcon size={16} />
            </button>
          )}
          {user && (
            <button
              onClick={() => { void logout(); }}
              title="Выйти из ReqTrace"
              style={{
                width: '34px', height: '34px', padding: 0,
                borderRadius: radii.md,
                border: `1px solid ${colors.border}`,
                background: colors.white,
                color: colors.textSecondary,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
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
              <LogoutIcon size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Content row: sidebar + main */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative', zIndex: 1 }}>
        <aside
          ref={asideRef}
          style={{
            width: `${width}px`,
            flexShrink: 0,
            ...glassmorphism,
            // Только правая граница: верхняя из glassmorphism складывалась с
            // нижней границей шапки в двойную (2px) линию над сайдбаром.
            border: 'none',
            borderRight: `1px solid ${colors.border}`,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            // No overflow:hidden — the tree clips itself via its own container, and
            // this lets the resize grip sit outside, on the divider (Confluence-style).
            zIndex: 2, // above main so the protruding grip stays visible
            transition: dragging ? 'none' : 'width 0.18s ease',
          }}
        >
          {showRail ? (
            <>
              {/* Whole rail is the expand target — big click area; thin right edge stays draggable */}
              <button
                onClick={toggleCollapsed}
                title="Раскрыть панель страниц"
                style={{
                  flex: 1, width: '100%', border: 'none', background: 'transparent',
                  color: colors.textSecondary, cursor: 'pointer', display: 'flex',
                  flexDirection: 'column', alignItems: 'center', paddingTop: '14px',
                  transition: 'background 0.15s, color 0.15s', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = colors.greenLight; e.currentTarget.style.color = colors.greenDark; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textSecondary; }}
              >
                <Chevron dir="right" size={18} />
              </button>
              {resizeHandle}
            </>
          ) : (
            <>
              {/* Отступы панель раздаёт сама (PageTree): линия под её шапкой
                  должна идти во всю ширину сайдбара, до самых краёв. */}
              <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                <PageTree />
              </div>

              {/* Collapse control — bottom-right corner, Confluence-style */}
              <div style={{
                flexShrink: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
                padding: '4px 14px 8px',
              }}>
                <button
                  onClick={toggleCollapsed}
                  title="Свернуть панель страниц"
                  style={{
                    width: '36px', height: '30px', border: 'none', borderRadius: radii.sm,
                    background: 'transparent', color: colors.textTertiary, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s', fontFamily: 'inherit', padding: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = colors.greenLight; e.currentTarget.style.color = colors.greenDark; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textTertiary; }}
                >
                  <Chevron dir="left" size={16} />
                </button>
              </div>

              {/* Resize handle on the right divider */}
              {resizeHandle}
            </>
          )}
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, position: 'relative', zIndex: 1, overflow: 'auto', minWidth: 0 }}>
          {children}
        </main>
      </div>

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
};

export default Layout;
