// Скелетоны списочных экранов (v1.7.1): вместо «Загрузка…» — серый каркас
// в габаритах будущего контента. Язык — полоски artBar из иллюстраций
// онбординга; вместо shimmer — спокойный пульс прозрачности (мягкость
// ReqTrace, reduced-motion отключает).
//
// Скелетон показывается ТОЛЬКО после задержки (useDelayedFlag ~200мс):
// локальная БД отвечает быстрее, и мигание каркаса на десятки миллисекунд
// хуже, чем его отсутствие. Поэлементное совпадение с контентом невозможно
// по построению (количество и высоты известны только после ответа) —
// совпадает каркас, а несовпадение количества прощает FadeIn контента.
import React, { useEffect, useState } from 'react';

const PULSE_STYLES_ID = 'reqtrace-skeleton-pulse';
if (typeof document !== 'undefined' && !document.getElementById(PULSE_STYLES_ID)) {
  const style = document.createElement('style');
  style.id = PULSE_STYLES_ID;
  style.textContent = `
@keyframes reqtrace-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
.skeleton-pulse { animation: reqtrace-skeleton-pulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .skeleton-pulse { animation: none; }
}
`;
  document.head.appendChild(style);
}

/** Серая полоска-заглушка «текста» — единица всех скелетонов. */
export const SkeletonBar: React.FC<{
  width: string;
  height?: number;
  radius?: number;
  style?: React.CSSProperties;
}> = ({ width, height = 10, radius = 5, style }) => (
  <span
    className="skeleton-pulse"
    style={{
      display: 'block',
      width,
      height: `${height}px`,
      borderRadius: `${radius}px`,
      background: 'rgba(0, 0, 0, 0.07)',
      ...style,
    }}
  />
);

/** Показ скелетона с задержкой: быстрый ответ не должен мигать каркасом. */
export function useDelayedFlag(active: boolean, delayMs = 200): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return show;
}
