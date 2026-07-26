// Плавная высота под содержимое: контейнер анимирует свой height к фактической
// высоте внутренностей при каждом её изменении. Родился на экране «Тесты»
// (v1.7.3): раскрытая строка в ожидании привязок держит высоту одной строки,
// а с приходом ответа плавно ДОРАСТАЕТ до реального списка — без рывка при
// смене лоадера на контент. Приём: внутренний блок измеряется ResizeObserver,
// высота переносится на внешний с transition; изменения от переносов текста
// и ресайза окна едут той же мягкостью. Тайминг — 200мс, в ряду общей
// мягкости приложения (160мс модалок и TreeReveal).
import React, { useLayoutEffect, useRef, useState } from 'react';

const GROW_MS = 200;
const REDUCED_MOTION = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const AnimatedHeight: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const innerRef = useRef<HTMLDivElement>(null);
  // null — до первого замера (и в средах без ResizeObserver): высота auto,
  // контейнер ведёт себя как обычный div.
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    setHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{
      height: height === null ? 'auto' : `${height}px`,
      overflow: 'hidden',
      transition: REDUCED_MOTION ? undefined : `height ${GROW_MS}ms ease`,
    }}>
      <div ref={innerRef}>{children}</div>
    </div>
  );
};
