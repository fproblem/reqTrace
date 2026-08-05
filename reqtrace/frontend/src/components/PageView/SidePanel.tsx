import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Highlight, TestLink } from '../../types';
import { colors, radii, shadows, island } from '../../styles/tokens';
import { useFadeToggle } from '../fadePresence';
import { RefreshIcon } from '../RefreshIcon';
import { TreeReveal } from '../TreeReveal';
import { KeyIssueInformer } from '../KeyIssueInformer';
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

// hint — определение статуса для тултипа шапки карточки: модель привязок
// должна объясняться сама, без чтения документации (формулировки — по
// правилам anchoring-plan-v1.5.9).
const statusLabels: Record<string, { label: string; color: string; hint: string }> = {
  active: {
    label: 'Актуально',
    color: colors.statusActive,
    hint: 'Актуально: текст выделения подтверждён человеком и после этого не менялся',
  },
  outdated: {
    label: 'Требует проверки',
    color: colors.statusOutdated,
    hint: 'Требует проверки: привязка ещё не подтверждена или текст под ней изменился — проверьте и нажмите «Актуализировать»',
  },
  lost: {
    label: 'Утрачено',
    color: colors.statusLost,
    hint: 'Утрачено: выделенный текст удалён со страницы, статус окончательный — тесты сохранены для перепривязки',
  },
};

// Знак статуса привязки → вид общего StatusAlertIcon (галочка/«!»/крестик).
const STATUS_ICON_KIND: Record<string, 'ok' | 'warning' | 'error'> = {
  active: 'ok',
  outdated: 'warning',
  lost: 'error',
};

// Корзина — библиотечная TrashIcon (см. импорт): своя копия больше не нужна.

// Один оборот лоадера RefreshIcon (0.8s в его keyframes): «Актуализировать»
// не складывается раньше полного оборота — быстрый ответ дёргал глаз.
const SPIN_TURN_MS = 800;
// Пауза на зелёной галочке успеха после оборота — глаз успевает считать
// итог прежде, чем строка сложится.
const DONE_HOLD_MS = 600;

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
  // Фаза «галочка успеха» после полного оборота лоадера (см. onClick кнопки).
  const [reanchorDone, setReanchorDone] = useState(false);
  // Компактное подтверждение удаления — поповер над кнопкой в футере.
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Мягкое появление/гашение поповера подтверждения удаления (v1.6.6) —
  // как у меню действий и панели дайджеста.
  const { mounted: confirmMounted, fadeStyle: confirmFade } = useFadeToggle(confirmOpen);
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
  // Свежий статус для замыкания onClick «Актуализировать»: галочка успеха
  // показывается только если реанкор реально перевёл привязку в active.
  const renderedStatusRef = useRef<string | undefined>(undefined);
  renderedStatusRef.current = rendered?.status;
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
  // переиспользовал один DOM-узел и транзишен ширины не прерывался. Фон и тень
  // только при контенте: у пустой оболочки прозрачная рамка (1px) не должна
  // просвечивать белой полоской у правого края.
  // Остров (v1.8.0): гэп до контента (margin-left) анимируется ВМЕСТЕ с
  // шириной — иначе у закрытой панели оставалась бы мёртвая полоса гэпа у
  // правого края полотна. Блюра нет: остров непрозрачен, а backdrop-filter
  // ломал бы fixed-потомков (ловушка containing block, Modal.tsx).
  const shellStyle = (opened: boolean, withContent: boolean): React.CSSProperties => ({
    width: opened ? '360px' : '0px',
    flexShrink: 0,
    transition: `width ${PANEL_ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1), `
      + `margin-left ${PANEL_ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1), `
      + `border-color ${PANEL_ANIM_MS}ms ease`,
    marginLeft: opened ? island.gap : '0px',
    border: `1px solid ${opened && withContent ? colors.border : 'transparent'}`,
    borderRadius: island.radius,
    background: withContent ? island.background : 'transparent',
    boxShadow: withContent ? island.boxShadow : undefined,
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

  // Цвет фокуса следует за статусом привязки (v1.7.0). При листании привязок
  // поле НЕ теряет фокус — onFocus не перевызовется, и обводка застряла бы в
  // цвете прошлого статуса: перекрашиваем вручную при смене статуса.
  // statusLabels — напрямую из rendered: statusInfo объявляется ниже раннего
  // return, хукам он недоступен.
  useEffect(() => {
    const input = testInputRef.current;
    if (!rendered || !input || document.activeElement !== input) return;
    const tint = (statusLabels[rendered.status] || statusLabels.active).color;
    input.style.borderColor = `${tint}8C`;
    input.style.boxShadow = `0 0 0 2px ${tint}1F`;
  }, [rendered?.status]);

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

  // Одноразовый пульс «Актуализировать» в момент, когда у outdated-привязки
  // появился ПЕРВЫЙ тест: кнопка ожила — остался один шаг. Сигнал привязан к
  // событию перехода (не к состоянию), затухает за ~1с и не возвращается —
  // постоянное напоминание мозолило бы глаза при серийной работе.
  const [reanchorPulse, setReanchorPulse] = useState(false);
  const prevTestsRef = useRef<{ id: string; count: number } | null>(null);
  useEffect(() => {
    if (!rendered) {
      prevTestsRef.current = null;
      return;
    }
    const prev = prevTestsRef.current;
    prevTestsRef.current = { id: rendered.id, count: rendered.tests.length };
    // Смена привязки — не событие «тест добавили», мигать нечему.
    if (!prev || prev.id !== rendered.id) {
      setReanchorPulse(false);
      return;
    }
    if (prev.count === 0 && rendered.tests.length > 0 && rendered.status === 'outdated') {
      setReanchorPulse(true);
      const t = setTimeout(() => setReanchorPulse(false), 1700);
      return () => clearTimeout(t);
    }
  }, [rendered]);

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

  // Фейд-подсказка прокрутки у длинной цитаты: жёсткий обрез на maxHeight не
  // намекал, что внутри есть ещё текст. Градиент виден, пока скролл цитаты
  // не дошёл до конца (иначе затухала бы последняя строка).
  const quoteScrollRef = useRef<HTMLDivElement>(null);
  const [quoteFade, setQuoteFade] = useState(false);
  const updateQuoteFade = useCallback(() => {
    const el = quoteScrollRef.current;
    if (!el) return;
    setQuoteFade(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  }, []);
  useEffect(() => { updateQuoteFade(); }, [rendered, quoteDiffParts, updateQuoteFade]);

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
      // Мягкое напоминание ПОСЛЕ привязки (не запрет): непохожий на
      // TEST-123 ключ — почти наверняка опечатка, поэтому ссылкой в Jira
      // он не становится (см. рендер списка). В списке такой ключ дополнительно
      // помечен янтарной строкой со значком.
      if (!isLikelyJiraKey(key)) {
        showToast('warning', 'Ключ не похож на формат Jira', `${key} не соответствует виду TEST-123 и не станет ссылкой на тест — проверьте, нет ли опечатки`);
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
    <div style={shellStyle(open, true)} data-popover-center>
      {/* Контент — на фиксированной ширине панели: при анимации ширины корня
          он не пере-верстается, а «въезжает» справа единым блоком (левый край
          корня движется вместе с шириной, контент прижат к нему). */}
      <div style={{
        width: '360px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}>
      {/* Микро-стили панели: крестик «Отвязать» только при наведении на
          строку теста (или его фокусе с клавиатуры) — список в покое чище.
          Fade контента при листании пробовали и убрали: «мигание» всего блока
          читалось как переинициализация панели, резкая смена содержимого в
          зафиксированных элементах воспринимается лучше. */}
      <style>{`
        .test-row .test-row-remove { opacity: 0; transition: opacity 0.15s; }
        .test-row:hover .test-row-remove,
        .test-row .test-row-remove:focus-visible { opacity: 1; }
      `}</style>
      {/* Header with navigation. Правый паддинг 13px — остров: гэп(10) +
          рамка(1) + 13 = те же 24px от края окна, что и раньше, — крестик
          встаёт ровно под «⋮» бара-острова, стрелка «вниз» — под «Обновить»
          (см. island в tokens.ts). Размеры кнопок (34×34) и гэп (10px) — как у
          правого кластера верхнего бара. Высота фиксированная 64px (с
          бордером), как у шапок сайдбара и бара страницы, — не гуляет от
          содержимого. */}
      <div style={{
        height: '64px',
        padding: '0 13px 0 20px',
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
            {/* 14px на строке 12px/1.45 (~17px): 1.5px сверху центрируют по первой строке */}
            <StatusAlertIcon kind="warning" size={14} style={{ marginTop: '1.5px' }} />
            <span>
              Эта привязка <strong>не отображается на странице</strong>: содержимое
              и координаты привязки рассинхронизированы. Нажмите «Обновить» в
              шапке — сервер пересчитает привязки по актуальной версии страницы.
            </span>
          </div>
        )}

        {/* Карточка привязки: рамка и линии между зонами — в цвете статуса;
            лёгкая тень приподнимает героя панели над служебными блоками. */}
        <div style={{
          borderRadius: radii.md,
          border: `1px solid ${statusInfo.color}33`,
          overflow: 'hidden',
          boxShadow: shadows.card,
        }}>

        {/* Шапка-статус карточки. Кликабельна, если выделений этого статуса
            несколько: ведёт к следующему по кругу; справа — позиция среди
            одностатусных и шеврон как намёк на переход. */}
        <div
          onClick={statusNavigable ? handleNextOfStatus : undefined}
          title={statusNavigable
            ? `${statusInfo.hint}. Клик — к следующему выделению с этим статусом`
            : statusInfo.hint}
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
            borderTop: `1px solid ${statusInfo.color}33`,
            cursor: notOnPage ? 'default' : 'pointer',
            transition: 'background 0.15s',
            position: 'relative',
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
          <div
            ref={quoteScrollRef}
            onScroll={updateQuoteFade}
            style={{
              padding: '12px 16px',
              fontSize: '13px',
              lineHeight: '1.5',
              color: colors.textPrimary,
              maxHeight: '150px',
              overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <QuoteIcon size={14} style={{ marginTop: '3px', color: colors.textTertiary }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                {quoteDiffParts
                  ? <QuoteDiffView parts={quoteDiffParts} />
                  : highlight.text_content}
              </div>
            </div>
          </div>
          {/* Градиент поверх нижнего края — «там ещё есть»; гаснет у конца
              прокрутки, чтобы не туманить последнюю строку. */}
          {quoteFade && (
            <div style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '18px',
              background: `linear-gradient(to bottom, rgba(255,255,255,0), ${colors.white})`,
              pointerEvents: 'none',
            }} />
          )}
        </div>

        {/* Reanchor — нижняя строка карточки, продолжает блок «статус +
            цитата» (вариант 2 референса). Без тестов кнопка задизейблена:
            актуализация подтверждает, что привязанные тесты всё ещё покрывают
            текст — «актуальное» выделение без единого теста вводило бы в
            заблуждение. Привязали первый тест — кнопка оживает. */}
        {/* TreeReveal (один ребёнок): после «Актуализировать» строка кнопки
            складывается те же 160мс, что всё в ReqTrace, — карточка привязки
            сжимается плавно, без скачка контента панели (ревью v1.7.0). */}
        <TreeReveal expanded={(highlight.status === 'outdated' && !!onReanchor) || reanchoring || reanchorDone}>
          <div>
          {/* Пульс — CSS-классом, а не инлайном: анимация перебивает инлайновые
              ховер-манипуляции фоном на время проигрывания, а reduced-motion
              отключается медиа-запросом. */}
          <style>{`
            @keyframes reanchor-pulse {
              0%, 100% { background-color: ${colors.statusOutdated}0F; }
              50% { background-color: ${colors.statusOutdated}33; }
            }
            .reanchor-pulse { animation: reanchor-pulse 0.6s ease-in-out 2; }
            @keyframes reanchor-done-pop {
              from { opacity: 0; transform: scale(0.7); }
              to { opacity: 1; transform: scale(1); }
            }
            .reanchor-done-pop { animation: reanchor-done-pop 160ms ease; }
            @media (prefers-reduced-motion: reduce) {
              .reanchor-pulse, .reanchor-done-pop { animation: none; }
            }
          `}</style>
          <button
            className={reanchorPulse ? 'reanchor-pulse' : undefined}
            // Не disabled-атрибут, а охрана в onClick: disabled глушит события
            // мыши, и у недоступной кнопки не работали ни title, ни курсор —
            // а «почему нельзя нажать» важнее всего именно у недоступной.
            onClick={async () => {
              // !onReanchor — для TypeScript: условный рендер больше не сужает
              // тип (кнопка живёт внутри TreeReveal без внешнего &&).
              if (reanchoring || noTests || !onReanchor) return;
              setReanchoring(true);
              // Лоадер делает ПОЛНЫЙ оборот прежде, чем строка сложится:
              // мгновенный ответ обрывал вращение на первых градусах —
              // выглядело дёргано (ревью). reanchoring держит TreeReveal
              // раскрытым (см. expanded выше): статус уже «Актуально», строка
              // зеленеет — докрутка читается как знак успеха.
              const fullTurn = new Promise<void>(r => setTimeout(r, SPIN_TURN_MS));
              try {
                await onReanchor(highlight.id);
              } finally {
                await fullTurn;
                // Галочка успеха — только если статус реально стал active
                // (реанкор мог не удаться: parent показал тост, строка
                // останется — зелёная галочка была бы враньём).
                if (renderedStatusRef.current === 'active') {
                  setReanchorDone(true);
                  await new Promise(r => setTimeout(r, DONE_HOLD_MS));
                  setReanchorDone(false);
                }
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
              position: 'relative',
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
            {/* Подпись не меняется (нечитаемая «Актуализация…» в момент
                схлопывания смотрелась странно — ревью): на время ожидания
                она гаснет, поверх крутятся стрелки — как у «Добавить». */}
            <span style={{ opacity: reanchoring || reanchorDone ? 0 : 1, transition: 'opacity 0.15s' }}>
              Актуализировать
            </span>
            {reanchoring && !reanchorDone && (
              // Цвет лоадера следует за статусом: когда привязка уже стала
              // «Актуально», докрутка идёт зелёным на зелёном блоке — а не
              // янтарным (ревью).
              <span style={{
                position: 'absolute', inset: 0, color: statusInfo.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <RefreshIcon size={15} spinning />
              </span>
            )}
            {reanchorDone && (
              // color обязателен: круг StatusAlertIcon красится через
              // currentColor, а кнопка несёт янтарный color — без явного
              // зелёного галочка успеха выходила янтарной.
              <span
                className="reanchor-done-pop"
                style={{
                  position: 'absolute', inset: 0, color: colors.statusActive,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <StatusAlertIcon kind="ok" size={16} />
              </span>
            )}
          </button>
          </div>
        </TreeReveal>

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

          {/* Add test form — закреплена НАД списком: добавить следующий тест
              можно не прокручивая длинный список, а свежепривязанный ключ
              появляется прямо под полем. */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <input
              ref={testInputRef}
              type="text"
              value={testKey}
              onChange={e => setTestKey(e.target.value)}
              placeholder="TEST-123"
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
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              // Фокус — в цвете статуса привязки (v1.7.0, вслед за чипами
              // ключей): на «Требует проверки» поле обводится янтарным, на
              // «Актуально» — зелёным, на «Утрачено» — красным. Геометрия
              // стандартная (рамка 0.55 + кольцо 0.12, как focusBorder/
              // focusRing из tokens), меняется только оттенок — 8C и 1F это
              // те же альфы в hex.
              onFocus={e => {
                e.currentTarget.style.borderColor = `${statusInfo.color}8C`;
                e.currentTarget.style.boxShadow = `0 0 0 2px ${statusInfo.color}1F`;
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.boxShadow = 'none';
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
                // Лоадер живёт ПОВЕРХ невидимой подписи: ширина кнопки не
                // меняется, кнопка не «дышит» (ревью v1.7.0 — ожидание
                // ответа Jira стало заметным).
                position: 'relative',
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
              {/* Подпись прозрачная на время ожидания — держит ширину;
                  крутятся стрелки RefreshIcon (докрутка оборота внутри). */}
              <span style={{ opacity: adding ? 0 : 1, transition: 'opacity 0.15s' }}>
                Добавить
              </span>
              {adding && (
                <span style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <RefreshIcon size={15} spinning />
                </span>
              )}
            </button>
          </div>

          {noTests ? (
            <div style={{ fontSize: '13px', color: colors.textTertiary, fontStyle: 'italic' }}>
              Тестов пока нет — привяжите первый
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {tests.map(test => {
                // Ключ непохож на TEST-123 — вероятная опечатка и битая
                // ссылка в Jira: чип не кликабелен, рядом значок-пояснение.
                const nonstandard = !isLikelyJiraKey(test.test_key);
                // Jira не знает такой задачи (тест удалён или ключ-фантом):
                // чип гаснет в серый и теряет ссылку — /browse дал бы 404.
                const notInJira = test.jira_status === 'not_found';
                const chipClickable = !!jiraBaseUrl && !nonstandard && !notInJira;
                // Чип ключа тонирован статусом ПРИВЯЗКИ (референс v1.7.0,
                // вариант D): ключ визуально отделён от названия и говорит
                // о состоянии покрытия. Ступени заливки 15/26/33 — как у
                // карточки привязки выше. Проблемные ключи — нейтральный
                // серый: не путать с красным «Утрачено».
                const tint = statusInfo.color;
                const chipStyle: React.CSSProperties = {
                  display: 'inline-block',
                  padding: '3px 10px',
                  borderRadius: radii.pill,
                  background: nonstandard || notInJira ? 'rgba(0,0,0,0.04)' : `${tint}15`,
                  border: `1px solid ${nonstandard || notInJira ? colors.border : `${tint}33`}`,
                  color: nonstandard || notInJira ? colors.textSecondary : tint,
                  fontSize: '12.5px',
                  fontWeight: 600,
                  lineHeight: 1.4,
                  textDecoration: 'none',
                  flexShrink: 0,
                  transition: 'background 0.15s, border-color 0.15s',
                };
                return (
                <div
                  key={test.id}
                  className="test-row"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '10px 12px',
                    borderRadius: radii.md,
                    border: `1px solid ${colors.border}`,
                    background: colors.white,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    {/* Информер — слева от чипа и единственный носитель
                        объяснения (кликабельный поповер, v1.7.0): тултип не
                        живёт на тачах. Тексты разные: «не похож на формат»
                        и «задачи нет в Jira» чинятся по-разному. */}
                    {(nonstandard || notInJira) && (
                      <KeyIssueInformer
                        text={nonstandard
                          ? 'Ключ не похож на формат Jira (TEST-123) — проверьте, нет ли опечатки'
                          : 'Задачи с таким ключом нет в Jira — тест удалён или ключ с опечаткой'}
                      />
                    )}
                    {chipClickable ? (
                      // Чип-кнопка: клик открывает тест в Jira (только чтение,
                      // как и вся интеграция); шеврона из референса нет —
                      // решение пользователя.
                      <a
                        href={`${jiraBaseUrl}/browse/${test.test_key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Открыть тест в Jira"
                        style={{ ...chipStyle, cursor: 'pointer' }}
                        onClick={e => e.stopPropagation()}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = `${tint}26`;
                          e.currentTarget.style.borderColor = `${tint}55`;
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = `${tint}15`;
                          e.currentTarget.style.borderColor = `${tint}33`;
                        }}
                        onMouseDown={e => { e.currentTarget.style.background = `${tint}33`; }}
                        onMouseUp={e => { e.currentTarget.style.background = `${tint}26`; }}
                      >
                        {test.test_key}
                      </a>
                    ) : (
                      <span
                        title={!nonstandard && !notInJira
                          ? 'Укажите адрес Jira в карточке проекта (профиль), чтобы ключи тестов стали ссылками'
                          : undefined}
                        style={{
                          ...chipStyle,
                          cursor: !nonstandard && !notInJira ? 'help' : 'default',
                        }}
                      >
                        {test.test_key}
                      </span>
                    )}
                    {/* Крестик — как у закрытия панели/модалок: XIcon, нейтральный
                        ховер; виден только при наведении на строку (.test-row) —
                        список в покое без колонки крестиков. */}
                    <button
                      onClick={() => onRemoveTest(test.id)}
                      className="test-row-remove"
                      style={{
                        width: '26px', height: '26px', borderRadius: radii.sm,
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        color: colors.textTertiary, display: 'flex', flexShrink: 0,
                        alignItems: 'center', justifyContent: 'center',
                        marginLeft: 'auto', transition: 'all 0.15s',
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
                  {/* Название из Jira (v1.7.0): целиком, с переносами —
                      обрезанное название не читается (ревью). */}
                  {test.summary && (
                    <div style={{
                      fontSize: '12px', color: colors.textSecondary,
                      lineHeight: 1.5, wordBreak: 'break-word',
                    }}>
                      {test.summary}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
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
        {confirmMounted && (
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
            ...confirmFade,
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
