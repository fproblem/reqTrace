import React from 'react';
import { colors, island } from '../../styles/tokens';

/** Единый каркас экрана (v1.8.0): бар-остров 64px + контент-остров со
 * скроллом ВНУТРИ — та же пара, что у экрана страницы. Скроллит внутренний
 * слой (двухслойный остров: классический скроллбар подрезается скруглением,
 * а не накрывает углы), колонка контента центруется внутри острова.
 *
 * barLeft — обычно IslandBarTitle (заголовок 16px + мета-строка 12px, обе с
 * эллипсисом), barRight — кластер кнопок 34×34 c гэпом 10 (правая колонка
 * встаёт в 24px от края окна: гэп(10) + рамка(1) + паддинг(13), см. island
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
}> = ({ barLeft, barRight, contentMaxWidth, surface = 'island', children }) => (
  <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
    <div style={{
      height: '64px',
      flexShrink: 0,
      padding: '0 13px 0 24px',
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
        boxShadow: island.boxShadow,
        overflow: 'hidden',
      }}>
        <div className="island-scroll" style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          <div style={{
            maxWidth: contentMaxWidth,
            margin: '0 auto',
            padding: '28px 40px 32px',
            boxSizing: 'border-box',
          }}>
            {children}
          </div>
        </div>
      </div>
    ) : (
      // Полотно: прозрачный скроллер, пилюля плавает у края полотна.
      // scrollbar-gutter stable — колонка не дёргается на 5px между экранами
      // со скроллом и без (жёлоб на полотне невидим, трек прозрачный).
      <div className="island-scroll" style={{
        flex: 1, minHeight: 0, overflow: 'auto', scrollbarGutter: 'stable',
      }}>
        <div style={{
          maxWidth: contentMaxWidth,
          margin: '0 auto',
          padding: '28px 40px 32px',
          boxSizing: 'border-box',
        }}>
          {children}
        </div>
      </div>
    )}
  </div>
);

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
