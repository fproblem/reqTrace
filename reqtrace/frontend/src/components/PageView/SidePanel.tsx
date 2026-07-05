import React, { useEffect, useRef, useState } from 'react';
import { Highlight, TestLink } from '../../types';
import { colors, radii, shadows } from '../../styles/tokens';
import { XIcon } from '../Modal';
import { useToast } from '../Toast';
import { highlightDomOrder, compareByDomThenAnchor } from './HighlightLayer';

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

// Иконка алерта статуса: залитый круг цвета статуса с белым знаком —
// галочка (актуально), «!» (требует проверки), крестик (утрачено).
const StatusAlertIcon: React.FC<{ status: string }> = ({ status }) => (
  <svg width={16} height={16} viewBox="0 0 24 24" style={{ display: 'block', flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    {status === 'active' && (
      <polyline
        points="8 12.5 11 15.5 16.5 9.5" fill="none" stroke="#fff"
        strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
      />
    )}
    {status === 'outdated' && (
      <>
        <line x1="12" y1="7" x2="12" y2="13" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
        <circle cx="12" cy="16.6" r="1.3" fill="#fff" />
      </>
    )}
    {status === 'lost' && (
      <>
        <line x1="9" y1="9" x2="15" y2="15" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
        <line x1="15" y1="9" x2="9" y2="15" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
      </>
    )}
  </svg>
);

// Корзина для карточки подтверждения удаления (feather trash-2).
const TrashIcon: React.FC = () => (
  <svg
    width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

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

  // Дальше рисуем rendered: во время анимации закрытия activeHighlight уже
  // null, а панель ещё должна показывать последнее выделение. Когда показывать
  // нечего — возвращаем пустую оболочку, а не null: она держит DOM-узел живым
  // для следующего транзишена.
  const highlight = rendered;
  if (!highlight) return <div style={shellStyle(false, false)} />;

  const sorted = sortedByPosition(allHighlights);
  const currentIndex = sorted.findIndex(h => h.id === highlight.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < sorted.length - 1;

  const statusInfo = statusLabels[highlight.status] || statusLabels.active;
  const noTests = highlight.tests.length === 0;

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
    } finally {
      setAdding(false);
      // Фокус не теряется после добавления (клик по «Добавить» уводит его на
      // кнопку) — серию тестов можно вбить подряд, не трогая мышь.
      testInputRef.current?.focus();
    }
  };

  const handlePrev = () => {
    if (hasPrev) onNavigate(sorted[currentIndex - 1]);
  };

  const handleNext = () => {
    if (hasNext) onNavigate(sorted[currentIndex + 1]);
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'short', year: 'numeric',
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
          ровно под «⋮», стрелка «вниз» — под «Обновить». */}
      <div style={{
        padding: '12px 24px 12px 20px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        {/* baseline, не center: кегли разные (15px и 12px), и центрирование
            по высоте строк поднимало базовую линию счётчика на ~1px над
            базовой линией слова — текст в одной строке ровняем по baseline. */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontWeight: 600, fontSize: '15px', color: colors.textPrimary }}>
            Выделение
          </span>
          {sorted.length > 1 && (
            <span style={{
              fontSize: '12px', color: colors.textTertiary, fontWeight: 400,
            }}>
              {currentIndex + 1} из {sorted.length}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
        {/* Status — алерт во всю ширину: иконка и текст прижаты к левому краю.
            Если выделений этого статуса несколько, плашка кликабельна и ведёт
            к следующему по кругу; справа — позиция среди одностатусных и
            шеврон как намёк на переход. */}
        <div
          onClick={statusNavigable ? handleNextOfStatus : undefined}
          title={statusNavigable ? 'Перейти к следующему выделению с этим статусом' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 14px',
            borderRadius: radii.md,
            background: `${statusInfo.color}15`,
            border: `1px solid ${statusInfo.color}33`,
            color: statusInfo.color,
            fontSize: '13px',
            fontWeight: 600,
            marginBottom: '16px',
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
          <StatusAlertIcon status={statusLabels[highlight.status] ? highlight.status : 'active'} />
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

        {/* Alert: привязка не отображается на странице */}
        {notOnPage && (
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
              Эта привязка <strong>не отображается на странице</strong>: выделенный
              текст не удалось найти в текущем содержимом, поэтому она помечена как
              «Утрачено». Найти её можно внизу страницы или по чипу «утрачено» в
              верхней панели. Привязанные тесты сохранены.
            </span>
          </div>
        )}

        {/* Reanchor button for outdated highlights. Без тестов кнопка
            задизейблена: актуализация подтверждает, что привязанные тесты всё
            ещё покрывают текст — «актуальное» выделение без единого теста
            вводило бы в заблуждение. Привязали первый тест — кнопка оживает. */}
        {highlight.status === 'outdated' && onReanchor && (
          <button
            onClick={async () => {
              setReanchoring(true);
              try {
                await onReanchor(highlight.id);
              } finally {
                setReanchoring(false);
              }
            }}
            disabled={reanchoring || noTests}
            title={noTests
              ? 'Актуализация подтверждает покрытие выделения — сначала привяжите хотя бы один тест'
              : undefined}
            style={{
              display: 'block',
              alignItems: 'center',
              gap: '6px',
              width: '100%',
              padding: '10px 14px',
              marginBottom: '16px',
              borderRadius: radii.md,
              border: `1px solid rgba(245,158,11,0.3)`,
              background: 'rgba(245,158,11,0.06)',
              color: colors.statusOutdated,
              fontSize: '13px',
              fontWeight: 600,
              cursor: reanchoring ? 'wait' : noTests ? 'default' : 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
              opacity: reanchoring ? 0.7 : noTests ? 0.5 : 1,
            }}
            onMouseEnter={e => {
              if (!reanchoring && !noTests) e.currentTarget.style.background = 'rgba(245,158,11,0.12)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(245,158,11,0.06)';
            }}
            onMouseDown={e => {
              if (!reanchoring && !noTests) e.currentTarget.style.background = 'rgba(245,158,11,0.18)';
            }}
            onMouseUp={e => {
              if (!reanchoring && !noTests) e.currentTarget.style.background = 'rgba(245,158,11,0.12)';
            }}
          >
            {reanchoring ? 'Актуализация...' : 'Актуализировать'}
          </button>
        )}

        {/* Text excerpt — клик возвращает страницу к самому выделению
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
            background: 'rgba(0,0,0,0.02)',
            borderRadius: radii.md,
            padding: '12px 16px',
            fontSize: '13px',
            lineHeight: '1.5',
            color: colors.textPrimary,
            marginBottom: '20px',
            maxHeight: '150px',
            overflow: 'auto',
            border: `1px solid ${colors.border}`,
            cursor: notOnPage ? 'default' : 'pointer',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            if (notOnPage) return;
            e.currentTarget.style.background = 'rgba(0,0,0,0.05)';
            e.currentTarget.style.borderColor = colors.borderHover;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(0,0,0,0.02)';
            e.currentTarget.style.borderColor = colors.border;
          }}
        >
          {highlight.text_content}
        </div>

        {/* Tests */}
        <div style={{ marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: colors.textSecondary }}>
              Привязанные тесты
            </span>
            {/* Число — нейтральной пилюлей, а не «(2)» в скобках; без цветового
                акцента — в панели их и так достаточно */}
            {highlight.tests.length > 0 && (
              <span style={{
                padding: '2px 8px',
                borderRadius: radii.pill,
                background: 'rgba(0,0,0,0.05)',
                color: colors.textSecondary,
                fontSize: '11px',
                fontWeight: 600,
                lineHeight: 1.4,
              }}>
                {highlight.tests.length}
              </span>
            )}
          </div>

          {highlight.tests.length === 0 ? (
            <div style={{ fontSize: '13px', color: colors.textTertiary, fontStyle: 'italic' }}>
              Нет привязанных тестов
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {highlight.tests.map(test => (
                <div
                  key={test.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: radii.md,
                    border: `1px solid ${colors.border}`,
                    background: colors.white,
                  }}
                >
                  {/* Без адреса Jira ссылка собиралась бы в «/browse/КЛЮЧ» —
                      битый роут самого приложения в новой вкладке. Показываем
                      ключ текстом с подсказкой, где включить ссылки. */}
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
                      title="Укажите адрес Jira в настройках проекта, чтобы ключи тестов стали ссылками"
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
              ))}
            </div>
          )}
        </div>

        {/* Add test form */}
        <div style={{
          display: 'flex', gap: '8px', marginBottom: '20px',
        }}>
          <input
            ref={testInputRef}
            type="text"
            value={testKey}
            onChange={e => setTestKey(e.target.value)}
            placeholder="PROJECT-123"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            style={{
              flex: 1,
              padding: '8px 12px',
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
              padding: '8px 14px',
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

        {/* Meta info */}
        <div style={{
          fontSize: '12px', color: colors.textTertiary,
          display: 'flex', flexDirection: 'column', gap: '10px',
        }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '2px' }}>Создано:</div>
            <div>
              {formatDate(highlight.created_at)}
              {highlight.created_by_name && (
                <span style={{ color: colors.textSecondary }}> — {highlight.created_by_name}</span>
              )}
            </div>
          </div>
          {highlight.reanchored_at && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: '2px' }}>Актуализировано:</div>
              <div>
                {formatDate(highlight.reanchored_at)}
                {highlight.reanchored_by_name && (
                  <span style={{ color: colors.textSecondary }}> — {highlight.reanchored_by_name}</span>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Футер с удалением — прижат к низу панели и отделён от контента
          линией, как шапка: деструктивное действие не смешивается с работой
          над привязкой. Клик открывает компактный поповер-подтверждение
          (стиль меню «⋮»), само удаление отложенное — с тостом «Отменить». */}
      <div
        ref={confirmRef}
        style={{
          padding: '14px 20px',
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
            {/* Симметричная карточка: корзина в тонированном круге, заголовок
                и текст по центру, кнопки 50/50 без дивайдера. Текст честный:
                удаление можно отменить в течение таймера undo-тоста. */}
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: 'rgba(239,68,68,0.1)',
              color: colors.statusLost,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px',
            }}>
              <TrashIcon />
            </div>
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
              Связи с тестами удалятся вместе с ним. После удаления будет 5 секунд, чтобы передумать
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
        <button
          onClick={() => setConfirmOpen(o => !o)}
          style={{
            width: '100%',
            padding: '8px',
            borderRadius: radii.md,
            border: `1px solid rgba(239,68,68,0.2)`,
            background: 'rgba(239,68,68,0.05)',
            color: colors.statusLost,
            fontSize: '13px',
            cursor: 'pointer',
            fontFamily: 'inherit',
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
          Удалить выделение
        </button>
      </div>
      </div>
    </div>
  );
};

export default SidePanel;
