import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Highlight, TestLink } from '../../types';
import { colors, radii, shadows } from '../../styles/tokens';
import { XIcon } from '../Modal';
import { LinkIcon, QuoteIcon, StatusAlertIcon, TrashIcon } from '../icons';
import { useToast } from '../Toast';
import { highlightDomOrder, compareByDomThenAnchor } from './HighlightLayer';
import { strippedEquals } from './highlightMatching';
import { DiffPart, quoteDiff } from './quoteDiff';
import { sortedTests } from './testOrder';
import { isLikelyJiraKey } from './testKeyFormat';

/** Дифф цитаты для «Требует проверки»: что изменилось в тексте под маркером
 * относительно замороженной цитаты. Удалённое — зачёркнуто красным,
 * добавленное — на зелёной подложке (фирменные оттенки ICON_TINTS). */
const QuoteDiffView: React.FC<{ parts: DiffPart[] }> = ({ parts }) => (
  <>
    {parts.map((part, i) => {
      if (part.kind === 'removed') {
        return (
          <span key={i} style={{
            color: '#DC2626',
            textDecoration: 'line-through',
            background: 'rgba(239, 68, 68, 0.07)',
            borderRadius: '3px',
          }}>
            {part.text}
          </span>
        );
      }
      if (part.kind === 'added') {
        return (
          <span key={i} style={{
            color: '#3A9E20',
            background: 'rgba(122, 224, 90, 0.18)',
            borderRadius: '3px',
          }}>
            {part.text}
          </span>
        );
      }
      return <span key={i}>{part.text}</span>;
    }).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}
  </>
);

interface SidePanelProps {
  highlight: Highlight | null;
  allHighlights: Highlight[];
  jiraBaseUrl: string;
  notOnPage?: boolean;
  onClose: () => void;
  onAddTest: (highlightId: string, testKey: string) => Promise<void>;
  onRemoveTest: (linkId: string) => Promise<void>;
  onDeleteHighlight: (highlightId: string) => Promise<void>;
  onReanchor?: (highlightId: string) => Promise<void>;
  onNavigate: (highlight: Highlight) => void;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  active: { label: 'Актуально', color: colors.statusActive },
  outdated: { label: 'Требует проверки', color: colors.statusOutdated },
  lost: { label: 'Утрачено', color: colors.statusLost },
};

// Знак статуса привязки → вид общего StatusAlertIcon (галочка/«!»/крестик).
const STATUS_ICON_KIND: Record<string, 'ok' | 'warning' | 'error'> = {
  active: 'ok',
  outdated: 'warning',
  lost: 'error',
};

// Корзина — библиотечная TrashIcon (см. импорт): своя копия больше не нужна.

// Длительность анимации открытия/закрытия панели (ширина 0↔360). Экспорт —
// для PageDetailPage: пока идёт открытие, подскролл к выделению не должен
// прицеливаться (контент пере-вёрстывается, координаты цели плывут).
export const PANEL_ANIM_MS = 220;

function sortedByPosition(highlights: Highlight[]): Highlight[] {
  // Порядок навигации = фактический порядок отрисованных подсветок сверху вниз
  // (позиция <mark> в DOM). Подробности — в compareByDomThenAnchor.
  return [...highlights].sort(compareByDomThenAnchor(highlightDomOrder()));
}

export const SidePanel: React.FC<SidePanelProps> = ({
  highlight: activeHighlight, allHighlights, jiraBaseUrl, notOnPage, onClose,
  onAddTest, onRemoveTest, onDeleteHighlight, onReanchor, onNavigate,
}) => {
  const { showToast } = useToast();
  const [testKey, setTestKey] = useState('');
  const [adding, setAdding] = useState(false);
  const testInputRef = useRef<HTMLInputElement>(null);
  const [reanchoring, setReanchoring] = useState(false);
  // Компактное подтверждение удаления — поповер над кнопкой в футере.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);

  // Плавное появление/скрытие: анимируется ширина корня 0↔360 (как у
  // inline-комментариев Confluence). Корень живёт в DOM постоянно (пустой,
  // шириной 0 — см. return ниже): транзишен тогда стартует из уже
  // зафиксированного браузером width:0 при ЛЮБОМ сценарии открытия. Прежний
  // вариант «смонтировать с width:0 и раскрыть через два rAF» проигрывал
  // гонку кадров, когда открытие сопровождалось тяжёлой синхронной работой
  // (клик по чипу статуса: пересортировка, перерисовка слоя, подскролл), — и
  // панель появлялась скачком. Пока идёт анимация закрытия, продолжаем
  // рисовать последнее выделение (rendered) — активного уже нет — и убираем
  // контент по таймеру чуть длиннее транзишена (220мс).
  const [rendered, setRendered] = useState<Highlight | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (activeHighlight) {
      setRendered(activeHighlight);
      setOpen(true);
      return;
    }
    setOpen(false);
    const t = setTimeout(() => setRendered(null), PANEL_ANIM_MS + 80);
    return () => clearTimeout(t);
  }, [activeHighlight]);

  // Оболочка панели — общая для пустого и наполненного состояния, чтобы React
  // переиспользовал один DOM-узел и транзишен ширины не прерывался. Фон и блюр
  // только при контенте: у пустой оболочки прозрачная рамка (1px) не должна
  // просвечивать белой полоской у правого края.
  const shellStyle = (opened: boolean, withContent: boolean): React.CSSProperties => ({
    width: opened ? '360px' : '0px',
    flexShrink: 0,
    transition: `width ${PANEL_ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1), border-color ${PANEL_ANIM_MS}ms ease`,
    borderLeft: `1px solid ${opened ? colors.border : 'transparent'}`,
    background: withContent ? 'rgba(255,255,255,0.92)' : 'transparent',
    backdropFilter: withContent ? 'blur(20px)' : undefined,
    height: '100%',
    overflow: 'hidden',
  });

  // Закрытие поповера: клик вне футера или Escape (как у меню «⋮»).
  useEffect(() => {
    if (!confirmOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!confirmRef.current?.contains(e.target as Node)) setConfirmOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [confirmOpen]);

  // Переключились на другое выделение — вопрос больше не актуален.
  useEffect(() => { setConfirmOpen(false); }, [rendered?.id]);

  // Автофокус в поле теста: главный сценарий — «выделил текст → привязал
  // тест», обязательный клик в поле между ними лишний. Срабатывает при
  // открытии панели и при переходе на другое выделение. preventScroll —
  // нативный доскролл к фокусу во время анимации ширины дёргал бы раскладку;
  // вместо него после раскрытия мягко доводим поле сами, если оно за краем.
  useEffect(() => {
    if (!rendered) return;
    const input = testInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const t = setTimeout(() => input.scrollIntoView({ block: 'nearest' }), 260);
    return () => clearTimeout(t);
  }, [rendered?.id]);

  // Escape закрывает панель — с автофокусом поля весь цикл «выделил →
  // привязал тесты → закрыл» проходит без мыши. Слои: открытый поповер
  // подтверждения удаления обрабатывает Escape сам (confirmOpen), модалки и
  // меню — тоже сами (их stopPropagation на document-слушателе соседей не
  // останавливает, поэтому проверяем их наличие в DOM); непустое поле теста
  // первая Escape только очищает.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Панель теперь смонтирована всегда (ради анимации) — закрытой Escape не адресован.
      if (!rendered) return;
      if (confirmOpen) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (e.target === testInputRef.current && testKey) {
        setTestKey('');
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmOpen, testKey, onClose, rendered]);

  // Стрелки ↑/↓ листают привязки в порядке отрисовки — вместе с Escape и
  // автофокусом весь обход «выделение за выделением» проходит без мыши.
  // Слои — как у Escape: поповер подтверждения и модалки/меню стрелкам не
  // отдаются; чужие поля ввода (поиск в дереве) живут своей жизнью; своё
  // поле теста отдаёт стрелки только пустым — с текстом они правят каретку.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (!rendered || confirmOpen) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const target = e.target as HTMLElement | null;
      const isOwnInput = target === testInputRef.current;
      if (isOwnInput && testKey) return;
      if (!isOwnInput && target && (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      )) return;
      const ordered = sortedByPosition(allHighlights);
      const idx = ordered.findIndex(h => h.id === rendered.id);
      if (idx === -1) return;
      const nextIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= ordered.length) return;
      e.preventDefault();
      onNavigate(ordered[nextIdx]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rendered, confirmOpen, testKey, allHighlights, onNavigate]);

  // Дальше рисуем rendered: во время анимации закрытия activeHighlight уже
  // null, а панель ещё должна показывать последнее выделение. Когда показывать
  // нечего — возвращаем пустую оболочку, а не null: она держит DOM-узел живым
  // для следующего транзишена.
  const highlight = rendered;

  // Дифф цитаты для «Требует проверки» — один раз на привязку (LCS
  // квадратичен). null — показывать нечего: тексты совпадают по norm,
  // anchored_text ещё не заполнен или дифф слишком велик (потолок quoteDiff).
  const quoteDiffParts = useMemo<DiffPart[] | null>(() => {
    if (!highlight || highlight.status !== 'outdated' || highlight.anchored_text == null) {
      return null;
    }
    if (strippedEquals(highlight.anchored_text, highlight.text_content)) return null;
    const parts = quoteDiff(highlight.text_content, highlight.anchored_text);
    return parts && parts.length ? parts : null;
  }, [highlight]);

  if (!highlight) return <div style={shellStyle(false, false)} />;

  const sorted = sortedByPosition(allHighlights);
  const currentIndex = sorted.findIndex(h => h.id === highlight.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < sorted.length - 1;

  const statusInfo = statusLabels[highlight.status] || statusLabels.active;
  const noTests = highlight.tests.length === 0;
  // Список рисуем по ключу (testOrder): сервер порядок связей не гарантирует,
  // и «как пришло» ставило только что добавленный тест в случайное место.
  const tests = sortedTests(highlight.tests);

  // Навигация по статусу: плашка ведёт к следующему выделению с тем же
  // статусом (по кругу, в порядке отрисовки на странице). В день актуализации
  // можно обходить только «Требует проверки», не листая остальные стрелками.
  const sameStatus = sorted.filter(h => h.status === highlight.status);
  const statusIndex = sameStatus.findIndex(h => h.id === highlight.id);
  const statusNavigable = sameStatus.length > 1;

  const handleNextOfStatus = () => {
    if (!statusNavigable) return;
    onNavigate(sameStatus[(statusIndex + 1) % sameStatus.length]);
  };

  const handleAdd = async () => {
    const key = testKey.trim().toUpperCase();
    if (!key) return;
    // Дубль не отправляем: ключ уже привязан к этому выделению. Набранное
    // оставляем выделенным — следующий набор сразу заменит его.
    if (highlight.tests.some(t => t.test_key === key)) {
      showToast('warning', 'Тест уже привязан', `${key} уже есть у этого выделения`);
      testInputRef.current?.select();
      return;
    }
    setAdding(true);
    try {
      await onAddTest(highlight.id, key);
      setTestKey('');
      // Мягкое напоминание ПОСЛЕ привязки (не запрет): из ключа строится
      // ссылка /browse/<ключ>, и непохожий на PROJECT-123 ключ — почти
      // наверняка опечатка с битой ссылкой. В списке такой ключ дополнительно
      // помечен янтарным значком.
      if (!isLikelyJiraKey(key)) {
        showToast('warning', 'Ключ не похож на формат Jira', `${key} не соответствует виду PROJECT-123 — ссылка на тест может не открыться`);
      }
    } finally {
      setAdding(false);
      // Фокус не теряется после добавления (клик по «Добавить» уводит его на
      // кнопку) — серию тестов можно вбить подряд, не трогая мышь.
      testInputRef.current?.focus();
    }
  };

  // Ссылка на конкретную привязку: текущий адрес страницы + ?highlight=<id>.
  // По ней ReqTrace открывает панель на этой привязке и подскролливает к
  // выделению — связь Jira/Slack → ReqTrace, обратная к ссылкам на тесты.
  // Доступ ссылка не расширяет: не-участнику проекта откроется обычный отказ.
  const handleCopyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('highlight', highlight.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      showToast('success', 'Ссылка скопирована', 'У получателя страница откроется сразу на этом выделении');
    } catch {
      showToast('error', 'Не удалось скопировать ссылку', 'Скопируйте адрес из строки браузера');
    }
  };

  const handlePrev = () => {
    if (hasPrev) onNavigate(sorted[currentIndex - 1]);
  };

  const handleNext = () => {
    if (hasNext) onNavigate(sorted[currentIndex + 1]);
  };

  // Компактный формат под строку футера: «13.07.2026, 23:31» — полнословная
  // версия («13 июл. 2026 г., 23:31») не оставляла места имени автора.
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  return (
    <div style={shellStyle(open, true)}>
      {/* Контент — на фиксированной ширине панели: при анимации ширины корня
          он не пере-верстается, а «въезжает» справа единым блоком (левый край
          корня движется вместе с шириной, контент прижат к нему). */}
      <div style={{
        width: '360px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}>
      {/* Header with navigation. Правый паддинг, размеры кнопок (34×34) и гэп
          (10px) — как у правого кластера верхнего бара страницы: крестик встаёт
          ровно под «⋮», стрелка «вниз» — под «Обновить». Высота фиксированная
          64px (с бордером), как у шапок сайдбара и бара страницы, — не гуляет
          от содержимого. */}
      <div style={{
        height: '64px',
        padding: '0 24px 0 20px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        {/* Заголовка-слова в шапке нет (ревью v1.6.0): панель и так открывается
            по клику на выделение. На его месте — счётчик позиции: отдельно от
            кнопок справа и без переноса на две строки в узкой шапке. */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {sorted.length > 1 && (
            <span style={{
              fontSize: '14px',
              fontWeight: 600,
              color: colors.textSecondary,
              whiteSpace: 'nowrap',
            }}>
              {currentIndex + 1} из {sorted.length}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Копирование ссылки на привязку — первым в кластере: правые две
              кнопки (стрелка/крестик) держат колонку с верхним баром. */}
          <button
            onClick={handleCopyLink}
            title="Скопировать ссылку на это выделение — у получателя страница откроется сразу на нём (нужно быть участником проекта)"
            style={{
              width: '34px',
              height: '34px',
              background: colors.white,
              border: `1px solid ${colors.border}`,
              cursor: 'pointer',
              borderRadius: radii.md,
              color: colors.textSecondary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
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
            <LinkIcon size={16} />
          </button>
          {/* Дивайдер отделяет копирование ссылки от навигации по выделениям —
              как чипы тестов от «Покрытие | Изменения» в верхнем баре. */}
          <div style={{ width: '1px', height: '24px', background: colors.border, flexShrink: 0 }} />
          {sorted.length > 1 && (
            <>
              <button
                onClick={handlePrev}
                disabled={!hasPrev}
                title="Предыдущее выделение"
                style={{
                  width: '34px',
                  height: '34px',
                  background: colors.white,
                  border: `1px solid ${colors.border}`,
                  cursor: hasPrev ? 'pointer' : 'default',
                  borderRadius: radii.md,
                  color: hasPrev ? colors.textSecondary : colors.textTertiary,
                  opacity: hasPrev ? 1 : 0.4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  if (!hasPrev) return;
                  e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                  e.currentTarget.style.borderColor = colors.borderHover;
                  e.currentTarget.style.color = colors.textPrimary;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = colors.white;
                  e.currentTarget.style.borderColor = colors.border;
                  e.currentTarget.style.color = hasPrev ? colors.textSecondary : colors.textTertiary;
                }}
                onMouseDown={e => { if (hasPrev) e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
                onMouseUp={e => { if (hasPrev) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
              >
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ display: 'block' }}
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
              <button
                onClick={handleNext}
                disabled={!hasNext}
                title="Следующее выделение"
                style={{
                  width: '34px',
                  height: '34px',
                  background: colors.white,
                  border: `1px solid ${colors.border}`,
                  cursor: hasNext ? 'pointer' : 'default',
                  borderRadius: radii.md,
                  color: hasNext ? colors.textSecondary : colors.textTertiary,
                  opacity: hasNext ? 1 : 0.4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  if (!hasNext) return;
                  e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                  e.currentTarget.style.borderColor = colors.borderHover;
                  e.currentTarget.style.color = colors.textPrimary;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = colors.white;
                  e.currentTarget.style.borderColor = colors.border;
                  e.currentTarget.style.color = hasNext ? colors.textSecondary : colors.textTertiary;
                }}
                onMouseDown={e => { if (hasNext) e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
                onMouseUp={e => { if (hasNext) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
              >
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ display: 'block' }}
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <polyline points="19 12 12 19 5 12" />
                </svg>
              </button>
            </>
          )}
          {/* Крестик — как в модалках (XIcon, прозрачный фон, тот же ховер);
              34×34 вместо модальных 30×30 — ради колонки с «⋮» верхнего бара. */}
          <button
            onClick={onClose}
            title="Закрыть"
            style={{
              width: '34px', height: '34px', borderRadius: radii.sm,
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: colors.textTertiary, display: 'flex', flexShrink: 0,
              alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
              e.currentTarget.style.color = colors.textPrimary;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = colors.textTertiary;
            }}
            onMouseDown={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
            onMouseUp={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
          >
            <XIcon />
          </button>
        </div>
      </div>

      <div style={{ padding: '20px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* Секция привязки — единая карточка (вариант 2 референса):
            тонированная шапка-статус, белое тело цитаты со знаком «❝»,
            «Актуализировать» — встроенная нижняя строка. Заголовка секции нет
            сознательно: панель открылась по клику на выделение, карточка
            самодостаточна. Клик-зоны прежние: шапка — следующая привязка
            того же статуса, цитата — подскролл к выделению. */}

        {/* Alert-аномалия: НЕ-lost привязка, которую слой отказался рендерить —
            содержимое и координаты рассинхронизированы (фронт статусы не
            меняет, v1.5.9). У «Утрачено» отдельной плашки нет: пояснение —
            нижняя строка карточки, там же, где у outdated «Актуализировать». */}
        {notOnPage && highlight.status !== 'lost' && (
          <div style={{
            display: 'flex',
            gap: '8px',
            padding: '10px 12px',
            marginBottom: '16px',
            borderRadius: radii.sm,
            border: `1px solid rgba(239,68,68,0.3)`,
            background: 'rgba(239,68,68,0.06)',
            color: colors.statusLost,
            fontSize: '12px',
            lineHeight: 1.45,
          }}>
            <span style={{ flexShrink: 0 }}>⚠</span>
            <span>
              Эта привязка <strong>не отображается на странице</strong>: содержимое
              и координаты привязки рассинхронизированы. Нажмите «Обновить» в
              шапке — сервер пересчитает привязки по актуальной версии страницы.
            </span>
          </div>
        )}

        {/* Карточка привязки: рамка и линии между зонами — в цвете статуса. */}
        <div style={{
          borderRadius: radii.md,
          border: `1px solid ${statusInfo.color}33`,
          overflow: 'hidden',
        }}>

        {/* Шапка-статус карточки. Кликабельна, если выделений этого статуса
            несколько: ведёт к следующему по кругу; справа — позиция среди
            одностатусных и шеврон как намёк на переход. */}
        <div
          onClick={statusNavigable ? handleNextOfStatus : undefined}
          title={statusNavigable ? 'Перейти к следующему выделению с этим статусом' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            height: '44px',
            padding: '0 14px',
            background: `${statusInfo.color}15`,
            color: statusInfo.color,
            fontSize: '13px',
            fontWeight: 600,
            cursor: statusNavigable ? 'pointer' : 'default',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => {
            if (statusNavigable) e.currentTarget.style.background = `${statusInfo.color}26`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = `${statusInfo.color}15`;
          }}
          onMouseDown={e => {
            if (statusNavigable) e.currentTarget.style.background = `${statusInfo.color}33`;
          }}
          onMouseUp={e => {
            if (statusNavigable) e.currentTarget.style.background = `${statusInfo.color}26`;
          }}
        >
          <StatusAlertIcon kind={STATUS_ICON_KIND[highlight.status] ?? 'ok'} />
          {statusInfo.label}
          {statusNavigable && (
            <span style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              fontWeight: 500,
              opacity: 0.85,
            }}>
              {statusIndex + 1} из {sameStatus.length}
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth={2.2}
                strokeLinecap="round" strokeLinejoin="round"
                style={{ display: 'block' }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          )}
        </div>

        {/* Тело-цитата — клик возвращает страницу к самому выделению
            (полистал контент → потерял место). Для не отображающихся на
            странице привязок скроллить некуда — цитата остаётся текстом. */}
        <div
          onClick={notOnPage ? undefined : () => {
            // Выделение текста цитаты (для копирования) кликом не считаем.
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed) return;
            onNavigate(highlight);
          }}
          title={notOnPage ? undefined : 'Показать выделение на странице'}
          style={{
            background: colors.white,
            padding: '12px 16px',
            fontSize: '13px',
            lineHeight: '1.5',
            color: colors.textPrimary,
            maxHeight: '150px',
            overflow: 'auto',
            borderTop: `1px solid ${statusInfo.color}33`,
            cursor: notOnPage ? 'default' : 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => {
            if (notOnPage) return;
            e.currentTarget.style.background = 'rgba(0,0,0,0.03)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = colors.white;
          }}
        >
          {/* «❝» — маркер дословной цитаты со страницы. Подстрочник у диффа
              убран (ревью): красное зачёркнутое / зелёное читается и без
              пояснения, а подпись висела не над цитатой, а над статусом. */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <QuoteIcon size={14} style={{ marginTop: '3px', color: colors.textTertiary }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              {quoteDiffParts
                ? <QuoteDiffView parts={quoteDiffParts} />
                : highlight.text_content}
            </div>
          </div>
        </div>

        {/* Reanchor — нижняя строка карточки, продолжает блок «статус +
            цитата» (вариант 2 референса). Без тестов кнопка задизейблена:
            актуализация подтверждает, что привязанные тесты всё ещё покрывают
            текст — «актуальное» выделение без единого теста вводило бы в
            заблуждение. Привязали первый тест — кнопка оживает. */}
        {highlight.status === 'outdated' && onReanchor && (
          <button
            // Не disabled-атрибут, а охрана в onClick: disabled глушит события
            // мыши, и у недоступной кнопки не работали ни title, ни курсор —
            // а «почему нельзя нажать» важнее всего именно у недоступной.
            onClick={async () => {
              if (reanchoring || noTests) return;
              setReanchoring(true);
              try {
                await onReanchor(highlight.id);
              } finally {
                setReanchoring(false);
              }
            }}
            aria-disabled={reanchoring || noTests}
            title={noTests
              ? 'Сначала привяжите хотя бы один тест — актуализация подтверждает, что тесты покрывают текущий текст'
              : 'Подтвердить: текст под выделением проверен, привязка снова «Актуально»'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
              height: '44px',
              padding: '0 14px',
              border: 'none',
              borderTop: `1px solid ${statusInfo.color}33`,
              // Ступени фона — те же, что у шапки-статуса (0F → 26 → 33):
              // зоны карточки откликаются одинаково.
              background: `${statusInfo.color}0F`,
              color: colors.statusOutdated,
              fontSize: '13px',
              fontWeight: 600,
              cursor: reanchoring ? 'wait' : noTests ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
              opacity: reanchoring ? 0.7 : noTests ? 0.5 : 1,
            }}
            onMouseEnter={e => {
              if (!reanchoring && !noTests) e.currentTarget.style.background = `${statusInfo.color}26`;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = `${statusInfo.color}0F`;
            }}
            onMouseDown={e => {
              if (!reanchoring && !noTests) e.currentTarget.style.background = `${statusInfo.color}33`;
            }}
            onMouseUp={e => {
              if (!reanchoring && !noTests) e.currentTarget.style.background = `${statusInfo.color}26`;
            }}
          >
            {reanchoring ? 'Актуализация...' : 'Актуализировать'}
          </button>
        )}

        {/* У «Утрачено» нижняя строка карточки — краткое пояснение вместо
            действия: статус терминальный, актуализировать нечего. Полная
            версия текста жила отдельной красной плашкой над карточкой и
            выглядела оторванной от статуса. */}
        {highlight.status === 'lost' && (
          <div style={{
            padding: '10px 14px',
            borderTop: `1px solid ${statusInfo.color}33`,
            background: `${statusInfo.color}0F`,
            color: colors.statusLost,
            fontSize: '12px',
            lineHeight: 1.45,
          }}>
            Выделенный текст удалён со страницы — привязка утрачена
            окончательно. Привязанные тесты сохранены: перепривяжите их
            к новому выделению.
          </div>
        )}
        </div>

        {/* Дивайдер-секция: группа привязки (статус + цитата + актуализация)
            отделена от тестов. В пределах контентных полей, краёв панели не
            касается — как вертикальный разделитель в шапке. */}
        <div style={{ height: '1px', background: colors.border, margin: '20px 0' }} />

        {/* Tests */}
        <div style={{ marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: colors.textSecondary }}>
              Привязанные тесты
            </span>
            {/* Число — нейтральной пилюлей, а не «(2)» в скобках; без цветового
                акцента — в панели их и так достаточно */}
            {tests.length > 0 && (
              <span style={{
                padding: '2px 8px',
                borderRadius: radii.pill,
                background: 'rgba(0,0,0,0.05)',
                color: colors.textSecondary,
                fontSize: '11px',
                fontWeight: 600,
                lineHeight: 1.4,
              }}>
                {tests.length}
              </span>
            )}
          </div>

          {noTests ? (
            <div style={{ fontSize: '13px', color: colors.textTertiary, fontStyle: 'italic' }}>
              Нет привязанных тестов
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {tests.map(test => {
                // Ключ непохож на PROJECT-123 — вероятная опечатка и битая
                // ссылка в Jira. Строка целиком в янтаре (рамка + заливка, как
                // у плашки «Требует проверки»), значок-пояснение — В НАЧАЛЕ
                // строки; помечаются и давние опечатки, не только свежий ввод.
                const nonstandard = !isLikelyJiraKey(test.test_key);
                return (
                <div
                  key={test.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    height: '44px',
                    padding: '0 12px',
                    borderRadius: radii.md,
                    border: `1px solid ${nonstandard ? 'rgba(245,158,11,0.3)' : colors.border}`,
                    background: nonstandard ? 'rgba(245,158,11,0.06)' : colors.white,
                  }}
                >
                  {/* Без адреса Jira ссылка собиралась бы в «/browse/КЛЮЧ» —
                      битый роут самого приложения в новой вкладке. Показываем
                      ключ текстом с подсказкой, где включить ссылки. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    {nonstandard && (
                      <span
                        title="Ключ не похож на формат Jira (PROJECT-123) — ссылка на тест может не открыться"
                        style={{ color: colors.statusOutdated, display: 'flex', cursor: 'help' }}
                      >
                        <StatusAlertIcon kind="warning" size={14} />
                      </span>
                    )}
                    {jiraBaseUrl ? (
                      <a
                        href={`${jiraBaseUrl}/browse/${test.test_key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: '#2563EB',
                          textDecoration: 'none',
                          fontWeight: 500,
                          fontSize: '13px',
                        }}
                        onClick={e => e.stopPropagation()}
                      >
                        {test.test_key}
                      </a>
                    ) : (
                      <span
                        title="Укажите адрес Jira в карточке проекта (профиль), чтобы ключи тестов стали ссылками"
                        style={{
                          color: colors.textPrimary,
                          fontWeight: 500,
                          fontSize: '13px',
                          cursor: 'help',
                        }}
                      >
                        {test.test_key}
                      </span>
                    )}
                  </div>
                  {/* Крестик — как у закрытия панели/модалок: XIcon, нейтральный ховер */}
                  <button
                    onClick={() => onRemoveTest(test.id)}
                    style={{
                      width: '26px', height: '26px', borderRadius: radii.sm,
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      color: colors.textTertiary, display: 'flex', flexShrink: 0,
                      alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                    }}
                    title="Отвязать тест"
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                      e.currentTarget.style.color = colors.textPrimary;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = colors.textTertiary;
                    }}
                    onMouseDown={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
                    onMouseUp={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                  >
                    <XIcon />
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add test form */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            ref={testInputRef}
            type="text"
            value={testKey}
            onChange={e => setTestKey(e.target.value)}
            placeholder="PROJECT-123"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            style={{
              flex: 1,
              height: '44px',
              padding: '0 12px',
              borderRadius: radii.md,
              border: `1px solid ${colors.border}`,
              fontSize: '13px',
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleAdd}
            disabled={!testKey.trim() || adding}
            style={{
              height: '44px',
              padding: '0 14px',
              borderRadius: radii.md,
              border: 'none',
              background: testKey.trim() ? colors.greenAccent : '#E5E7EB',
              color: '#fff',
              fontWeight: 600,
              fontSize: '13px',
              cursor: testKey.trim() && !adding ? 'pointer' : 'default',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              if (testKey.trim() && !adding) e.currentTarget.style.background = colors.greenDark;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = testKey.trim() ? colors.greenAccent : '#E5E7EB';
            }}
            onMouseDown={e => {
              if (testKey.trim() && !adding) e.currentTarget.style.background = '#3F9E27';
            }}
            onMouseUp={e => {
              if (testKey.trim() && !adding) e.currentTarget.style.background = colors.greenDark;
            }}
          >
            {adding ? '...' : 'Добавить'}
          </button>
        </div>

      </div>

      {/* Футер: слева — компактная мета (кто и когда создал/актуализировал,
          по строке на событие, длинное — в эллипсис с полным текстом в title),
          справа — корзина 34×34 (стиль кнопок шапки, красные тона). Клик по
          корзине открывает поповер-подтверждение; удаление мгновенное. */}
      <div
        ref={confirmRef}
        style={{
          // Зеркало шапки: фиксированные 64px (с бордером) — та же сетка.
          height: '64px',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          borderTop: `1px solid ${colors.border}`,
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {confirmOpen && (
          <div style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '20px',
            right: '20px',
            zIndex: 11,
            background: colors.cardBgSolid,
            border: `1px solid ${colors.border}`,
            borderRadius: radii.lg,
            boxShadow: shadows.panel,
            padding: '20px 16px 16px',
            textAlign: 'center',
          }}>
            {/* Симметричная карточка: заголовок и текст по центру, кнопки 50/50
                без дивайдера. Корзины в круге больше нет — иконку уже несёт
                кнопка футера, из которой поповер открылся. Это единственная
                защита от случайного удаления — undo-таймера больше нет (v1.6.0),
                текст честно предупреждает о необратимости. */}
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              color: colors.textPrimary,
              marginBottom: '6px',
            }}>
              Удалить выделение?
            </div>
            <div style={{
              fontSize: '12.5px',
              color: colors.textSecondary,
              lineHeight: 1.45,
              marginBottom: '16px',
            }}>
              Связи с тестами удалятся вместе с ним — действие необратимо
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setConfirmOpen(false)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: radii.pill,
                  border: `1px solid ${colors.border}`,
                  background: 'transparent',
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
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = colors.border;
                  e.currentTarget.style.color = colors.textSecondary;
                }}
                onMouseDown={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
                onMouseUp={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
              >
                Отмена
              </button>
              <button
                onClick={() => { setConfirmOpen(false); onDeleteHighlight(highlight.id); }}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: radii.pill,
                  border: 'none',
                  background: colors.statusLost,
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#DC2626'; }}
                onMouseLeave={e => { e.currentTarget.style.background = colors.statusLost; }}
                onMouseDown={e => { e.currentTarget.style.background = '#B91C1C'; }}
                onMouseUp={e => { e.currentTarget.style.background = '#DC2626'; }}
              >
                Удалить
              </button>
            </div>
          </div>
        )}
        <div style={{
          flex: 1,
          minWidth: 0,
          fontSize: '11px',
          color: colors.textTertiary,
          lineHeight: 1.55,
        }}>
          <div
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={`Создан ${formatDate(highlight.created_at)}${highlight.created_by_name ? ` · ${highlight.created_by_name}` : ''}`}
          >
            Создан {formatDate(highlight.created_at)}
            {highlight.created_by_name && (
              <span style={{ color: colors.textSecondary }}> · {highlight.created_by_name}</span>
            )}
          </div>
          {highlight.reanchored_at && (
            <div
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={`Обновлён ${formatDate(highlight.reanchored_at)}${highlight.reanchored_by_name ? ` · ${highlight.reanchored_by_name}` : ''}`}
            >
              Обновлён {formatDate(highlight.reanchored_at)}
              {highlight.reanchored_by_name && (
                <span style={{ color: colors.textSecondary }}> · {highlight.reanchored_by_name}</span>
              )}
            </div>
          )}
        </div>
        {/* Дивайдер отделяет справку от деструктивной кнопки — как разделитель
            в шапке панели (1×24, краёв не касается). */}
        <div style={{ width: '1px', height: '24px', background: colors.border, flexShrink: 0 }} />
        <button
          onClick={() => setConfirmOpen(o => !o)}
          title="Удалить выделение"
          style={{
            width: '34px',
            height: '34px',
            borderRadius: radii.md,
            border: `1px solid rgba(239,68,68,0.2)`,
            background: 'rgba(239,68,68,0.05)',
            color: colors.statusLost,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
            e.currentTarget.style.borderColor = 'rgba(239,68,68,0.35)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(239,68,68,0.05)';
            e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)';
          }}
          onMouseDown={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.16)'; }}
          onMouseUp={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
        >
          <TrashIcon size={16} />
        </button>
      </div>
      </div>
    </div>
  );
};

export default SidePanel;
