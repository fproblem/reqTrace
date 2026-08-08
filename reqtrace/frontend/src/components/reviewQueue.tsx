// Очередь проверки (флагман бэклога «UX-пакет»): «Проверить» на карточке
// проекта ведёт по всем страницам с привязками «Требует проверки» потоком —
// страница за страницей, с прогрессом и плавающим баром. Убирает ручные
// прыжки «дерево → страница → чип».
//
// ⚠ Переход к следующей странице — ТОЛЬКО явным действием «Далее»
// (решение пользователя: автопереход после «Актуализировать» откатывали —
// панель «прыгает»). Внутри страницы привязки обходятся штатными средствами:
// клик по шапке-статусу listает «Требует проверки» по кругу, стрелки — все
// подряд. Очередь живёт в памяти (F5 её закрывает — сценарий одного захода).
import React, {
  createContext, useCallback, useContext, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ProjectTree, TreeNodeItem } from '../types';
import { colors, radii, shadows } from '../styles/tokens';
import { useToast } from './Toast';
import { useFadeToggle } from './fadePresence';
import { TargetIcon } from './icons';
import { XIcon } from './Modal';

interface QueuePage {
  id: string;
  title: string;
  /** Привязок «Требует проверки» на момент запуска очереди. */
  outdated: number;
}

interface QueueState {
  projectId: string;
  projectName: string;
  pages: QueuePage[];
  index: number;
}

interface ReviewQueueValue {
  queue: QueueState | null;
  /** Собрать очередь проекта и открыть первую страницу. */
  start: (projectId: string, projectName: string) => Promise<void>;
  /** Явное «Далее»: следующая страница; на последней — завершение. */
  next: () => void;
  /** «Назад»: предыдущая страница очереди — страховка от случайного
   * «Далее»; на первой странице делать нечего. */
  prev: () => void;
  /** Свернуть очередь досрочно. */
  stop: () => void;
}

const ReviewQueueContext = createContext<ReviewQueueValue | null>(null);

export function useReviewQueue(): ReviewQueueValue {
  const ctx = useContext(ReviewQueueContext);
  if (!ctx) throw new Error('useReviewQueue должен вызываться внутри ReviewQueueProvider');
  return ctx;
}

// Подмножество дерева, которое реально читает выборка, — производное от
// НАСТОЯЩИХ типов дерева (Pick), а не анонимная копия: переименование поля
// в ProjectTree/TreeNodeItem сломает компиляцию здесь, а не молча.
type QueueTreeProject = Pick<ProjectTree, 'project_id' | 'no_access'> & {
  spaces: { pages: Pick<TreeNodeItem, 'id' | 'title' | 'highlights_outdated'>[] }[];
};

/** Страницы проекта с привязками «Требует проверки» — в порядке дерева.
 * Чистая выборка вынесена из start() ради тестируемости. */
export function collectQueuePages(
  tree: QueueTreeProject[],
  projectId: string,
): QueuePage[] {
  const project = tree.find(p => p.project_id === projectId && !p.no_access);
  if (!project) return [];
  return project.spaces.flatMap(space =>
    space.pages
      .filter(page => page.highlights_outdated > 0)
      .map(page => ({ id: page.id, title: page.title, outdated: page.highlights_outdated })),
  );
}

export const ReviewQueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [queue, setQueue] = useState<QueueState | null>(null);

  const start = useCallback(async (projectId: string, projectName: string) => {
    try {
      // Свежий срез дерева: счётчики на карточке могли устареть.
      const tree = await api.getPageTree();
      const pages = collectQueuePages(tree, projectId);
      if (pages.length === 0) {
        showToast('success', 'Проверять нечего',
          `В проекте «${projectName}» нет привязок со статусом «Требует проверки»`);
        return;
      }
      setQueue({ projectId, projectName, pages, index: 0 });
      // ?focus=outdated — страница откроет панель на первой «Требует
      // проверки» (механизм диплинка ?highlight, PageDetailPage).
      navigate(`/pages/${pages[0].id}?focus=outdated`);
    } catch (e: any) {
      showToast('error', 'Не удалось собрать очередь проверки', e.message);
    }
  }, [navigate, showToast]);

  const next = useCallback(() => {
    if (!queue) return;
    const nextIndex = queue.index + 1;
    if (nextIndex >= queue.pages.length) {
      setQueue(null);
      showToast('success', 'Очередь проверки пройдена',
        `Просмотрены все страницы с привязками «Требует проверки»: ${queue.pages.length}`);
      return;
    }
    setQueue({ ...queue, index: nextIndex });
    navigate(`/pages/${queue.pages[nextIndex].id}?focus=outdated`);
  }, [queue, navigate, showToast]);

  const prev = useCallback(() => {
    if (!queue || queue.index === 0) return;
    const prevIndex = queue.index - 1;
    setQueue({ ...queue, index: prevIndex });
    navigate(`/pages/${queue.pages[prevIndex].id}?focus=outdated`);
  }, [queue, navigate]);

  const stop = useCallback(() => setQueue(null), []);

  const value = useMemo(
    () => ({ queue, start, next, prev, stop }),
    [queue, start, next, prev, stop],
  );

  return (
    <ReviewQueueContext.Provider value={value}>
      {children}
      <QueueBar queue={queue} onNext={next} onPrev={prev} onStop={stop} onJump={page => {
        navigate(`/pages/${page.id}?focus=outdated`);
      }} />
    </ReviewQueueContext.Provider>
  );
};

// --- Плавающий бар очереди -------------------------------------------------

const QueueBar: React.FC<{
  queue: QueueState | null;
  onNext: () => void;
  onPrev: () => void;
  onStop: () => void;
  onJump: (page: QueuePage) => void;
}> = ({ queue, onNext, onPrev, onStop, onJump }) => {
  const { mounted, fadeStyle } = useFadeToggle(!!queue);
  // На время затухания рисуем последнее состояние (queue уже null).
  const lastRef = useRef(queue);
  if (queue) lastRef.current = queue;
  const q = queue ?? lastRef.current;
  if (!mounted || !q) return null;

  const current = q.pages[q.index];
  const isLast = q.index === q.pages.length - 1;
  const isFirst = q.index === 0;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '22px',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        // Ширина бара ФИКСИРОВАНА (просьба пользователя): название страницы —
        // резиновая середина с эллипсисом, а «Назад»/«Далее» стоят на одном
        // месте при любой длине названия и разрядности счётчика — случайный
        // промах мимо уехавшей кнопки исключён. У кнопок фиксированная
        // ширина: смена подписи «Далее» → «Готово» их тоже не двигает.
        width: '620px',
        maxWidth: 'calc(100vw - 48px)',
        boxSizing: 'border-box',
        padding: '8px 8px 8px 16px',
        background: colors.white,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.pill,
        boxShadow: shadows.cardHover,
        // Ниже модалок (2000) — «Удалить страницу?» и прочие диалоги должны
        // накрывать бар; выше островов и панелей.
        zIndex: 1500,
        ...fadeStyle,
      }}
    >
      <span style={{ color: colors.greenDark, display: 'flex', flexShrink: 0 }}>
        <TargetIcon size={15} />
      </span>
      <span style={{ fontSize: '13px', fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', flexShrink: 0 }}>
        Проверка: {q.index + 1} из {q.pages.length}
      </span>
      {/* Название текущей страницы — кликом можно вернуться к ней, если
          ушли гулять по приложению посреди очереди. flex 1 — забирает всё
          между счётчиком и кнопками, лишнее — в эллипсис. */}
      <button
        onClick={() => onJump(current)}
        title={`Вернуться к странице «${current.title}» (привязок «Требует проверки» на старте очереди: ${current.outdated})`}
        style={{
          border: 'none',
          background: 'transparent',
          padding: 0,
          fontFamily: 'inherit',
          fontSize: '13px',
          color: colors.textSecondary,
          cursor: 'pointer',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'left',
          flex: 1,
          minWidth: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = colors.greenDark; }}
        onMouseLeave={e => { e.currentTarget.style.color = colors.textSecondary; }}
      >
        {current.title}
      </button>
      {/* «Назад» — страховка от случайного «Далее»: очередь листается в обе
          стороны. Охрана в onClick, а не disabled-атрибут: у недоступной
          кнопки должны жить title и курсор (урок v1.6.0). */}
      <button
        onClick={() => { if (!isFirst) onPrev(); }}
        aria-disabled={isFirst}
        title={isFirst
          ? 'Это первая страница очереди — назад некуда'
          : 'К предыдущей странице очереди'}
        style={{
          width: '76px',
          height: '30px',
          padding: 0,
          borderRadius: radii.pill,
          border: `1px solid ${colors.border}`,
          background: 'transparent',
          color: isFirst ? colors.textTertiary : colors.textSecondary,
          fontSize: '12px',
          fontWeight: 600,
          cursor: isFirst ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          flexShrink: 0,
          opacity: isFirst ? 0.5 : 1,
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          if (isFirst) return;
          e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
          e.currentTarget.style.borderColor = colors.borderHover;
          e.currentTarget.style.color = colors.textPrimary;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.borderColor = colors.border;
          e.currentTarget.style.color = isFirst ? colors.textTertiary : colors.textSecondary;
        }}
      >
        Назад
      </button>
      <button
        onClick={onNext}
        title={isLast
          ? 'Завершить очередь проверки'
          : 'К следующей странице с привязками «Требует проверки»'}
        style={{
          width: '84px',
          height: '30px',
          padding: 0,
          borderRadius: radii.pill,
          border: 'none',
          background: colors.greenAccent,
          color: '#fff',
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          flexShrink: 0,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = colors.greenDark; }}
        onMouseLeave={e => { e.currentTarget.style.background = colors.greenAccent; }}
      >
        {isLast ? 'Готово' : 'Далее'}
      </button>
      <button
        onClick={onStop}
        title="Свернуть очередь (прогресс не сохраняется)"
        style={{
          width: '30px',
          height: '30px',
          border: 'none',
          borderRadius: '50%',
          background: 'transparent',
          color: colors.textTertiary,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
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
        <XIcon />
      </button>
    </div>,
    document.body,
  );
};
