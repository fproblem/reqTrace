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
  // рамка поля при фокусе зеленеет до greenAccent, кольцо — тонкое, 2px.
  focusRing: '0 0 0 2px rgba(122, 224, 90, 0.35)',
};

export const fonts = {
  body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export const glassmorphism = {
  background: 'rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(20px)',
  border: `1px solid ${colors.border}`,
};
