import React, { useCallback, useRef, useState } from 'react';
import { colors, island, radii, shadows } from '../../styles/tokens';

// Порог появления кнопки «наверх»: примерно полтора экрана прокрутки —
// раньше она только мельтешит, позже до неё уже долго листать обратно.
const SCROLL_TOP_THRESHOLD = 480;

// Контент полотна у верхней кромки не режется, а растворяется: маска на
// скроллере (28px в прозрачность). Симметричный низ — фирменный намёк
// «там ещё есть», как фейд у цитаты в панели. Маска — НЕ transform/filter,
// containing block для fixed-потомков не создаёт.
const CANVAS_FADE_MASK =
  'linear-gradient(to bottom, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%)';

/** Единый каркас экрана (v1.8.0): бар-остров 64px + контент-остров со
 * скроллом ВНУТРИ — та же пара, что у экрана страницы. Скроллит внутренний
 * слой (двухслойный остров: классический скроллбар подрезается скруглением,
 * а не накрывает углы), колонка контента центруется внутри острова.
 *
 * barLeft — обычно IslandBarTitle (заголовок 16px + мета-строка 12px, обе с
 * эллипсисом), barRight — кластер кнопок 34×34 c гэпом 10 (правая колонка
 * встаёт в 24px от края окна: гэп(8) + рамка(1) + паддинг(15), см. island
 * в tokens.ts). ⚠ Островам нельзя transform/backdrop-filter (Modal.tsx). */
export const IslandScreen: React.FC<{
  barLeft: React.ReactNode;
  barRight?: React.ReactNode;
  /** Ширина центрируемой колонки контента (например '1060px'). */
  contentMaxWidth?: string;
  /** 'island' (по умолчанию) — контент в белой карточке со скроллом внутри
   * (сплошной контент: страница). 'canvas' — контент лежит прямо на полотне,
   * скроллер прозрачный: для экранов-наборов карточек («Тесты», профиль)
   * белая пустота огромного острова читалась неуютно (ревью), карточки сами
   * себе острова, а пустота — полотно, как поля документа. */
  surface?: 'island' | 'canvas';
  children: React.ReactNode;
}> = ({ barLeft, barRight, contentMaxWidth, surface = 'island', children }) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Кнопка «наверх» (ревью): глубоко в списке тестов возвращаться к фильтрам
  // приходилось долгим скроллом или ловлей пилюли. setState с тем же boolean
  // React схлопывает — обработчик скролла дёшев.
  const [showToTop, setShowToTop] = useState(false);
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (el) setShowToTop(el.scrollTop > SCROLL_TOP_THRESHOLD);
  }, []);
  const scrollToTop = useCallback(() => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const columnStyle: React.CSSProperties = {
    maxWidth: contentMaxWidth,
    margin: '0 auto',
    padding: '28px 40px 32px',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column', position: 'relative' }}>
      <div style={{
        height: '64px',
        flexShrink: 0,
        padding: '0 15px 0 24px',
        background: island.background,
        border: island.border,
        borderRadius: island.radius,
        boxShadow: island.boxShadow,
        marginBottom: island.gap,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>{barLeft}</div>
        {barRight && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            {barRight}
          </div>
        )}
      </div>
      {surface === 'island' ? (
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          background: island.background,
          border: island.border,
          borderRadius: island.radius,
          // Контент-остров — герой-поверхность, приподнят (см. island).
          boxShadow: island.boxShadowRaised,
          overflow: 'hidden',
        }}>
          <div
            ref={scrollerRef}
            onScroll={onScroll}
            className="island-scroll"
            style={{ flex: 1, minWidth: 0, overflow: 'auto' }}
          >
            <div style={columnStyle}>
              {children}
            </div>
          </div>
        </div>
      ) : (
        // Полотно: прозрачный скроллер, пилюля плавает у края полотна.
        // scrollbar-gutter stable — колонка не дёргается на 5px между экранами
        // со скроллом и без (жёлоб на полотне невидим, трек прозрачный).
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="island-scroll"
          style={{
            flex: 1, minHeight: 0, overflow: 'auto', scrollbarGutter: 'stable',
            maskImage: CANVAS_FADE_MASK,
            WebkitMaskImage: CANVAS_FADE_MASK,
          }}
        >
          <div style={columnStyle}>
            {children}
          </div>
        </div>
      )}

      {/* «Наверх» — слева внизу (ревью: справа спорила бы с пилюлей скролла
          у края), в общем стиле кнопок баров: 34×34, radii.md, белая с рамкой,
          тот же ховер/пресс; лёгкая тень отделяет от карточек под ней. Живёт
          в DOM постоянно: появление/уход — фирменные 160мс (opacity + лёгкий
          подъезд), pointerEvents отключены, пока скрыта. */}
      <button
        onClick={scrollToTop}
        title="Наверх"
        aria-hidden={!showToTop}
        tabIndex={showToTop ? 0 : -1}
        style={{
          position: 'absolute',
          left: '24px',
          bottom: '20px',
          width: '34px',
          height: '34px',
          padding: 0,
          borderRadius: radii.md,
          border: `1px solid ${colors.border}`,
          background: colors.white,
          boxShadow: shadows.card,
          color: colors.textSecondary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontFamily: 'inherit',
          zIndex: 5,
          opacity: showToTop ? 1 : 0,
          transform: showToTop ? 'translateY(0)' : 'translateY(6px)',
          pointerEvents: showToTop ? 'auto' : 'none',
          transition: 'opacity 0.16s ease, transform 0.16s ease, '
            + 'background 0.15s, border-color 0.15s, color 0.15s',
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
        <svg
          width={16} height={16} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round"
          style={{ display: 'block' }}
        >
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      </button>
    </div>
  );
};

/** Заголовок бара-острова: 16px/600 + опциональная мета-строка 12px, обе в
 * одну строку с эллипсисом (полный текст — в title). Типографика — зеркало
 * шапки экрана страницы. */
export const IslandBarTitle: React.FC<{
  children: React.ReactNode;
  meta?: string;
}> = ({ children, meta }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{
      fontSize: '16px', fontWeight: 600, color: colors.textPrimary,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {children}
    </div>
    {meta && (
      <div
        title={meta}
        style={{
          fontSize: '12px', color: colors.textTertiary, marginTop: '2px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {meta}
      </div>
    )}
  </div>
);
