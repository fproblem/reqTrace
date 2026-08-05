export const colors = {
  white: '#FFFFFF',
  background: '#F8F9FA',
  greenAccent: '#7AE05A',
  greenDark: '#4DB830',
  greenLight: 'rgba(122, 224, 90, 0.15)',

  yellowHighlight: 'rgba(255, 180, 0, 0.15)',
  redHighlight: 'rgba(239, 68, 68, 0.1)',

  textPrimary: '#1A1A1A',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',

  border: 'rgba(0, 0, 0, 0.07)',
  borderHover: 'rgba(0, 0, 0, 0.12)',
  // Рамка поля в фокусе: полупрозрачный greenDark — сплошной звенел неоном
  // (подбор по 5 вариантам на макете, v1.6.0). Пара к shadows.focusRing.
  focusBorder: 'rgba(77, 184, 48, 0.55)',

  cardBg: 'rgba(255, 255, 255, 0.8)',
  cardBgSolid: '#FFFFFF',

  statusActive: '#4DB830',
  statusOutdated: '#F59E0B',
  statusLost: '#EF4444',

  blobLilac: 'rgba(196, 167, 255, 0.3)',
  blobGreen: 'rgba(122, 224, 90, 0.2)',
  blobYellow: 'rgba(200, 224, 90, 0.2)',
};

export const radii = {
  sm: '8px',
  md: '14px',
  lg: '20px',
  xl: '24px',
  pill: '100px',
};

export const shadows = {
  card: '0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)',
  cardHover: '0 4px 16px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.06)',
  panel: '0 4px 24px rgba(0, 0, 0, 0.08)',
  // Фокус-кольцо полей (как у полей Confluence, но в фирменной зелени):
  // рамка поля при фокусе — colors.focusBorder, кольцо — тонкое, 2px.
  // greenAccent и сплошной greenDark на рамке пробовали — неоново.
  focusRing: '0 0 0 2px rgba(77, 184, 48, 0.12)',
};

export const fonts = {
  body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

/** «Острова» (v1.8.0): рабочие поверхности — дерево страниц, шапка страницы,
 * контент, панель привязки — непрозрачные скруглённые карточки на общем
 * полотне colors.background. Хром (главная шапка с лого) лежит на полотне
 * без собственной поверхности. gap — зазор между островами и краями полотна.
 *
 * ⚠ Островам нельзя transform/backdrop-filter: fixed-попапы внутри (кнопка
 * «Привязать» у выделения и т.п.) привязались бы к острову вместо окна —
 * ловушка containing block, см. шапку Modal.tsx.
 *
 * Вертикаль кнопок (выход ↕ «⋮» ↕ крестик панели): правая колонка во всех
 * шапках — 24px от края окна; внутри острова это gap(8) + рамка(1) +
 * внутренний паддинг(15). Меняешь gap — пересчитай паддинги шапок-островов
 * (PageDetailPage, SidePanel, IslandScreen) и сэш-индикатор в Layout. */
export const island = {
  gap: '8px',
  radius: radii.lg,
  background: colors.cardBgSolid,
  // Чуть темнее colors.border (0.07): рамки островов путались с рамками
  // таблиц на страницах (ревью) — 0.10 отделяет хром от контента.
  border: '1px solid rgba(0, 0, 0, 0.10)',
  boxShadow: shadows.card,
} as const;

export const glassmorphism = {
  background: 'rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(20px)',
  border: `1px solid ${colors.border}`,
};
