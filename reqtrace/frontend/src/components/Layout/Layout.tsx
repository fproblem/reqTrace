import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { colors, radii, island, fonts } from '../../styles/tokens';
import { ChangelogModal, useCurrentVersion } from '../ChangelogModal';
import { Modal, ModalButton, modalTextStyle } from '../Modal';
import { PageTree } from './PageTree';
import { ClipboardCheckIcon, LogoutIcon } from '../icons';
import { NotificationBell } from '../NotificationBell';
import { PANEL_ANIM_MS } from '../PageView/SidePanel';

// Оба боковых острова дышат в одном ритме (ревью островов): длительность
// сворачивания/разворачивания дерева — та же, что у панели привязки.
const SIDEBAR_ANIM = `width ${PANEL_ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;

// Кастомный скроллбар рабочих областей (v1.8.0): тонкая «пилюля» с воздухом,
// трек прозрачный — скруглённые углы островов остаются свободными, системная
// полоса их больше не накрывает. Автоскрытие (ревью-3): пилюля видна только
// 2.5с после последнего скролла своего контейнера (класс is-scrolling вешает
// capture-слушатель ниже) — скроллеров на экране много (дерево, контент,
// панель, цитата, таблицы), постоянные пилюли шумели. Прозрачный бегунок
// остаётся кликабельным: ховер по его зоне подсвечивает пилюлю светлой
// зеленью (пастель, не чёрный — ревью-3), пресс — чуть плотнее.
const islandScrollStyles = `
  /* Цвет пилюли зарегистрирован как <color> — только так транзишен
     CSS-переменной анимируется и пилюля ТАЕТ, а не выключается (ревью-4).
     ⚠ inherits: true обязателен: ::-webkit-scrollbar-thumb получает значение
     переменной НАСЛЕДОВАНИЕМ от скроллера; с false псевдоэлемент видел лишь
     initial-value — пилюля в Chrome не появлялась при скролле вовсе
     (ревью-5). Вложенным скроллерам наследование не мешает: собственное
     объявление --rt-thumb на элементе всегда сильнее унаследованного. */
  @property --rt-thumb {
    syntax: '<color>';
    inherits: true;
    initial-value: transparent;
  }
  .island-scroll, .table-scroll {
    --rt-thumb: transparent;
    /* Гаснет неторопливо… */
    transition: --rt-thumb 0.45s ease;
  }
  .island-scroll.is-scrolling, .table-scroll.is-scrolling {
    --rt-thumb: rgba(0, 0, 0, 0.15);
    /* …а появляется на первом же движении почти сразу. */
    transition: --rt-thumb 0.12s ease;
  }
  /* Наведение на жёлоб (класс вешает mousemove-слушатель ниже): пилюля
     мягко проявляется зелёной тем же анимируемым каналом --rt-thumb.
     Правило ПОСЛЕ .is-scrolling — при одновременном скролле и наведении
     зелень главнее серого. */
  .island-scroll.is-scroll-hover, .table-scroll.is-scroll-hover {
    --rt-thumb: rgba(122, 224, 90, 0.45);
    transition: --rt-thumb 0.12s ease;
  }
  /* ⚠ Стандартные scrollbar-width/scrollbar-color — ТОЛЬКО для браузеров без
     ::-webkit-скина (Firefox). В Chrome 121+/Safari задание этих свойств
     ОТКЛЮЧАЕТ ::-webkit-scrollbar-* целиком: вместо пилюли рисовался тонкий
     системный бар с системным почти чёрным ховером (ревью-4 — «зелёный ховер
     не работает»). Не выносить из-под @supports.
     Firefox остаётся с родным тонким баром (появление/скрытие то же, через
     is-scrolling): пилюлю-в-воздухе, зелёный ховер и плавное таяние его
     движок не умеет — предел платформы, принято на ревью-5. */
  @supports not selector(::-webkit-scrollbar) {
    .island-scroll, .table-scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; }
    .island-scroll.is-scrolling, .table-scroll.is-scrolling { scrollbar-color: rgba(0, 0, 0, 0.15) transparent; }
    .island-scroll.is-scroll-hover, .table-scroll.is-scroll-hover { scrollbar-color: rgba(122, 224, 90, 0.45) transparent; }
  }
  .island-scroll::-webkit-scrollbar, .table-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
  .island-scroll::-webkit-scrollbar-track, .table-scroll::-webkit-scrollbar-track { background: transparent; }
  .island-scroll::-webkit-scrollbar-corner, .table-scroll::-webkit-scrollbar-corner { background: transparent; }
  .island-scroll::-webkit-scrollbar-thumb, .table-scroll::-webkit-scrollbar-thumb {
    background-color: var(--rt-thumb);
    border: 3px solid transparent;
    background-clip: content-box;
    border-radius: 8px;
  }
  /* Ховер живёт классом is-scroll-hover (см. выше) — webkit-:hover на
     бегунке менял цвет МГНОВЕННО, «из ниоткуда» (ревью-6). Пресс остаётся
     мгновенной ступенью: пилюля к этому моменту уже видна, а мгновенный
     отклик на захват ощущается правильнее плавного. */
  .island-scroll::-webkit-scrollbar-thumb:active, .table-scroll::-webkit-scrollbar-thumb:active {
    background-color: rgba(122, 224, 90, 0.65);
  }
`;

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
  // Подтверждение выхода: кнопка выхода соседствует с колокольчиком, и
  // случайный клик мгновенно выбрасывал на экран входа (ревью v1.6.5).
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const currentVersion = useCurrentVersion();

  const [sidebar, setSidebar] = useState<SidebarState>(loadSidebarState);
  const asideRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const rawXRef = useRef(sidebar.width);
  const zoneRef = useRef(false); // true while drag width is past MIN_WIDTH (tree shown)
  const [dragging, setDragging] = useState(false);
  const [dragTree, setDragTree] = useState(false);
  const resizeIndicatorRef = useRef<HTMLDivElement>(null);
  const indicatorHoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebar));
  }, [sidebar]);

  // Автоскрытие пилюль скролла (ревью-3): скролл не всплывает, но ловится
  // capture-фазой на документе — один слушатель на все скроллеры приложения,
  // включая создаваемые динамически обёртки таблиц (.table-scroll). Каждому
  // скроллеру — свой таймер: пилюля тает через 2.5с после его последнего
  // скролла, не мешая соседним.
  // Наведение (ревью-6): mousemove следит за жёлобом скролла (14px от
  // правого/нижнего края скроллера) и вешает is-scroll-hover — пилюля мягко
  // проявляется зелёной через тот же анимируемый --rt-thumb; webkit-:hover
  // на бегунке так не умеет (цвет менялся мгновенно, «из ниоткуда»).
  // Пока курсор в жёлобе, класс держит пилюлю видимой — таймер её не заберёт.
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      if (!el.classList.contains('island-scroll') && !el.classList.contains('table-scroll')) return;
      el.classList.add('is-scrolling');
      const prev = timers.get(el);
      if (prev !== undefined) window.clearTimeout(prev);
      timers.set(el, window.setTimeout(() => el.classList.remove('is-scrolling'), 2500));
    };

    const HOVER_ZONE = 14;
    const hovered = new Set<Element>();
    let pendingMove: MouseEvent | null = null;
    const processMove = () => {
      const e = pendingMove;
      pendingMove = null;
      if (!e) return;
      const next = new Set<Element>();
      // От самого глубокого скроллера вверх по цепочке предков: у вложенных
      // (цитата в теле панели, таблица в контенте) жёлобы у разных краёв.
      let node: Element | null = e.target instanceof Element
        ? e.target.closest('.island-scroll, .table-scroll')
        : null;
      while (node) {
        const r = node.getBoundingClientRect();
        const nearRight = node.scrollHeight > node.clientHeight
          && e.clientX <= r.right && r.right - e.clientX <= HOVER_ZONE;
        const nearBottom = node.scrollWidth > node.clientWidth
          && e.clientY <= r.bottom && r.bottom - e.clientY <= HOVER_ZONE;
        if (nearRight || nearBottom) next.add(node);
        node = node.parentElement?.closest('.island-scroll, .table-scroll') ?? null;
      }
      hovered.forEach(el => {
        if (!next.has(el)) {
          el.classList.remove('is-scroll-hover');
          hovered.delete(el);
        }
      });
      next.forEach(el => {
        if (!hovered.has(el)) {
          el.classList.add('is-scroll-hover');
          hovered.add(el);
        }
      });
    };
    // rAF-троттлинг: обрабатывается последний mousemove кадра, геометрия
    // меряется не чаще перерисовки.
    const onMouseMove = (ev: MouseEvent) => {
      if (!pendingMove) requestAnimationFrame(processMove);
      pendingMove = ev;
    };
    const clearHover = () => {
      pendingMove = null;
      hovered.forEach(el => el.classList.remove('is-scroll-hover'));
      hovered.clear();
    };

    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.documentElement.addEventListener('mouseleave', clearHover);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousemove', onMouseMove, true);
      document.documentElement.removeEventListener('mouseleave', clearHover);
      clearHover();
    };
  }, []);

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
      asideRef.current.style.transition = SIDEBAR_ANIM;
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

  // Тап по рельсе (ревью-2): разворачивает остров до минимально допустимой
  // ширины — предсказуемый результат вместо «какой-то прошлой ширины»;
  // перетаскивание у рельсы отключено, жест один.
  const expandToMin = useCallback(() => {
    setSidebar({ width: MIN_WIDTH, collapsed: false });
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

  // Drag handle: только у РАЗВЁРНУТОГО дерева (drag left to collapse, drag
  // right to expand). Свёрнутая рельса не тянется — раскрывается тапом
  // (ревью-2: два жеста на 48px конфликтовали, градиент-подсказка выглядела
  // резко). Визуальный отклик — как сэш в VS Code: тонкая зелёная черта в
  // ЗАЗОРЕ между островами, во всю высоту, появляется с задержкой 200мс
  // (мимолётный проход мыши её не зажигает) и мгновенно гаснет.
  const resizeIndicator = (
    <div
      ref={resizeIndicatorRef}
      style={{
        // Черта 4px по центру гэпа(8): остров кончается на right:0,
        // зазор — [0..-8], центр — -4.
        position: 'absolute', top: 0, right: '-6px', bottom: 0, width: '4px',
        borderRadius: '2px',
        // Пастель (ревью-3): плотный greenDark кричал, светлая фирменная
        // зелень читается подсказкой, а не сигналом тревоги.
        background: 'rgba(122, 224, 90, 0.45)',
        opacity: dragging ? 1 : 0,
        transition: 'opacity 0.15s ease',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  );
  const resizeHandle = (
    <div
      onMouseDown={startDrag}
      title="Потяните, чтобы изменить ширину (до упора — свернуть)"
      style={{
        // Зона захвата накрывает весь зазор (8) и 2px кромки острова.
        position: 'absolute', top: 0, right: '-8px', width: '10px', height: '100%',
        cursor: 'col-resize', zIndex: 3,
      }}
      onMouseEnter={() => {
        clearTimeout(indicatorHoverTimer.current);
        indicatorHoverTimer.current = setTimeout(() => {
          if (resizeIndicatorRef.current) resizeIndicatorRef.current.style.opacity = '1';
        }, 200);
      }}
      onMouseLeave={() => {
        clearTimeout(indicatorHoverTimer.current);
        // Во время перетаскивания курсор уходит с зоны захвата — черта
        // остаётся, погасит её ре-рендер по окончании драга.
        if (draggingRef.current) return;
        if (resizeIndicatorRef.current) resizeIndicatorRef.current.style.opacity = '0';
      }}
    />
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
      <style>{islandScrollStyles}</style>
      {/* Блобов на рабочем полотне НЕТ (ревью v1.8.0): с непрозрачными
          островами цветные пятна выглядывали только в гэпах и отвлекали;
          фирменная гамма живёт в самих элементах. Блобы остались лишь на
          экране входа — там они герой-фон под стеклянной карточкой. */}

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
        // Остров-схема (v1.8.0): главная шапка лежит на полотне без своей
        // поверхности — белые карточки только у рабочих областей ниже.
        background: 'transparent',
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Left: brand. Чип версии переехал в футер сайдбара (v1.7.5) —
            шапка осталась чистому логотипу. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <img
            src={`${process.env.PUBLIC_URL}/logo-header.svg?v=${currentVersion}`}
            alt="ReqTrace"
            onClick={() => navigate('/')}
            style={{ height: '42px', display: 'block', cursor: 'pointer', flexShrink: 0 }}
          />
        </div>

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
              // Якорь панели дайджеста: её левая граница равняется по левой
              // грани этой кнопки (NotificationBell меряет по атрибуту).
              data-rt-header-tests=""
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                height: '34px', padding: '0 14px',
                borderRadius: radii.md,
                // Белая, как остальные кнопки баров (чип версии, «Выйти»):
                // серая заливка выбивалась из общей гаммы кнопок шапки.
                border: `1px solid ${isTests ? 'rgba(122, 224, 90, 0.55)' : colors.border}`,
                background: isTests ? colors.greenLight : colors.white,
                color: isTests ? colors.greenDark : colors.textSecondary,
                fontSize: '13px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                if (isTests) return;
                e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                e.currentTarget.style.borderColor = colors.borderHover;
                e.currentTarget.style.color = colors.textPrimary;
              }}
              onMouseLeave={e => {
                if (isTests) return;
                e.currentTarget.style.background = colors.white;
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.color = colors.textSecondary;
              }}
              onMouseDown={e => { if (!isTests) e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
              onMouseUp={e => { if (!isTests) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
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
                // 174×35 — фактические размеры сегмент-контрола
                // «Покрытие|Изменения» (замер headless-мокапом): профиль стоит
                // ровно над ним и совпадает по габаритам. Аватар с именем — по
                // центру чипа (короткое имя не оставляет перекос вправо),
                // длинное имя — в эллипсис.
                justifyContent: 'center',
                height: '35px', width: '174px', boxSizing: 'border-box',
                padding: '0 10px', borderRadius: radii.pill,
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
                minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {user.name}
              </span>
            </button>
          )}

          {/* Колокольчик уведомлений (жив с v1.6.3): бейдж непрочитанного +
              панель с дайджестами ночных прогонов. Заглушка стояла с v1.6.1. */}
          {user && <NotificationBell />}
          {user && (
            <button
              onClick={() => setLogoutConfirmOpen(true)}
              title="Выйти из ReqTrace"
              // Якорь панели дайджеста: её правая граница равняется по правой
              // грани этой кнопки.
              data-rt-header-logout=""
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

      {/* Content row: sidebar + main. Гэп острова — по бокам и снизу; сверху
          НУЛЬ: воздух под шапкой-на-полотне уже даёт её собственная центровка
          (64px минус контент), добавка паддинга удваивала отступ (ревью
          фазы 1). Гэп между сайдбаром и main отдан гэпу флекса. */}
      <div style={{
        display: 'flex', flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
        padding: `0 ${island.gap} ${island.gap}`, gap: island.gap,
      }}>
        <aside
          ref={asideRef}
          style={{
            width: `${width}px`,
            flexShrink: 0,
            // Остров: и дерево, и свёрнутая рельса — тонкая белая карточка.
            background: island.background,
            border: island.border,
            borderRadius: island.radius,
            boxShadow: island.boxShadow,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            // No overflow:hidden — the tree clips itself via its own container, and
            // this lets the resize grip sit outside, on the divider (Confluence-style).
            zIndex: 2, // above main so the protruding grip stays visible
            transition: dragging ? 'none' : SIDEBAR_ANIM,
          }}
        >
          {showRail ? (
            <>
              {/* Вся рельса — цель тапа; перетаскивания у рельсы нет (ревью-2).
                  Индикатор рядом — на случай, если драг из развёрнутого
                  состояния нырнул ниже порога и рельса показалась мид-драгом. */}
              <button
                onClick={expandToMin}
                title="Раскрыть панель страниц"
                style={{
                  flex: 1, width: '100%', border: 'none', background: 'transparent',
                  color: colors.textSecondary, cursor: 'pointer', display: 'flex',
                  flexDirection: 'column', alignItems: 'center', paddingTop: '14px',
                  transition: 'background 0.15s, color 0.15s', fontFamily: 'inherit',
                  // Ховер-заливка не должна выпирать из скруглённых углов острова.
                  borderRadius: island.radius,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = colors.greenLight; e.currentTarget.style.color = colors.greenDark; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textSecondary; }}
              >
                <Chevron dir="right" size={18} />
              </button>
              {resizeIndicator}
            </>
          ) : (
            <>
              {/* Отступы панель раздаёт сама (PageTree): линия под её шапкой
                  должна идти во всю ширину сайдбара, до самых краёв. */}
              <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                <PageTree />
              </div>

              {/* Футер — зеркало футера панели привязки (64px, верхняя линия,
                  та же сетка): консистентные низы обоих сайдбаров (ревью
                  v1.7.5). Слева — тихая кнопка версии (открывает «Историю
                  изменений»; переехала из шапки от логотипа — место лобное,
                  а функция справочная), справа — кнопка сворачивания. */}
              <div style={{
                height: '64px', flexShrink: 0,
                padding: '0 14px 0 20px',
                display: 'flex', alignItems: 'center', gap: '12px',
                borderTop: `1px solid ${colors.border}`,
              }}>
                {currentVersion && (
                  <button
                    onClick={() => setChangelogOpen(true)}
                    title="История изменений"
                    style={{
                      border: 'none', background: 'transparent',
                      padding: '6px 8px', marginLeft: '-8px',
                      borderRadius: radii.sm,
                      color: colors.textTertiary, fontSize: '12px', fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                      e.currentTarget.style.color = colors.textPrimary;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = colors.textTertiary;
                    }}
                  >
                    v{currentVersion}
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button
                  onClick={toggleCollapsed}
                  title="Свернуть панель страниц"
                  style={{
                    width: '36px', height: '30px', border: 'none', borderRadius: radii.sm,
                    background: 'transparent', color: colors.textTertiary, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s', fontFamily: 'inherit', padding: 0,
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = colors.greenLight; e.currentTarget.style.color = colors.greenDark; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textTertiary; }}
                >
                  <Chevron dir="left" size={16} />
                </button>
              </div>

              {/* Черта-индикатор в зазоре + зона захвата ресайза */}
              {resizeIndicator}
              {resizeHandle}
            </>
          )}
        </aside>

        {/* Main content. Не скроллится НИКОГДА (v1.8.0): каждый экран —
            IslandScreen или своя пара островов, прокрутка живёт внутри
            контент-острова. Сага о scrollbar-gutter (v1.6.6–v1.7.2: жёлоб
            только на скроллящих main экранах, отвергнутая проба-компенсация
            в шапке) закрыта по построению — скроллбара у main больше нет.
            ⚠ overflow — visible: гэпы вокруг main принадлежат ряду, и
            overflow hidden обрубал тени герой-острова ровно по прямоугольнику
            main — резкие срезы на углах (ревью). Размеры детей держит флекс,
            скроллят они себя сами — клипать main нечего. */}
        <main style={{
          flex: 1, position: 'relative', zIndex: 1, overflow: 'visible',
          minWidth: 0,
        }}>
          {children}
        </main>
      </div>

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />

      {logoutConfirmOpen && (
        <Modal title="Выйти из ReqTrace?" width="400px" onClose={() => setLogoutConfirmOpen(false)}>
          <p style={modalTextStyle}>
            Сессия на этом устройстве завершится, для возвращения понадобится
            снова войти через Google. Привязки и настройки, разумеется, никуда
            не денутся.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <ModalButton variant="secondary" onClick={() => setLogoutConfirmOpen(false)}>
              Отмена
            </ModalButton>
            <ModalButton
              variant="primary"
              onClick={() => { setLogoutConfirmOpen(false); void logout(); }}
            >
              Выйти
            </ModalButton>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Layout;
