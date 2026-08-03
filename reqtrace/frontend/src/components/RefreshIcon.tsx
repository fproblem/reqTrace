import React, { useEffect, useRef, useState } from 'react';

// Иконка «Обновить» (стрелка по кругу) — общая для синхронизации дерева,
// обновления страницы и проверки кред. Вращение не обрывается на ответе:
// оборот докручивается до конца (animationiteration), иначе стрелка резко
// телепортируется в исходный угол.

// Keyframes инъектируются один раз на документ — иконок на экране может быть
// много (карточки проектов), по <style> на каждую плодить не хочется.
const KEYFRAMES_ID = 'reqtrace-spin-keyframes';
if (typeof document !== 'undefined' && !document.getElementById(KEYFRAMES_ID)) {
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent =
    '@keyframes reqtrace-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

/** Вращение, пока active; после active=false докручивает текущий оборот. */
function useSpinFinish(active: boolean) {
  const ref = useRef<SVGSVGElement>(null);
  const [animating, setAnimating] = useState(active);

  useEffect(() => {
    const el = ref.current;
    if (active) {
      if (el) el.style.animationPlayState = '';
      setAnimating(true);
      return;
    }
    if (!el || !animating) return;
    const stop = () => {
      // Пауза синхронно на границе оборота (0°): снятие animation придёт
      // рендером на кадр позже, без паузы стрелка успела бы уехать дальше.
      el.style.animationPlayState = 'paused';
      setAnimating(false);
    };
    el.addEventListener('animationiteration', stop);
    return () => el.removeEventListener('animationiteration', stop);
  }, [active, animating]);

  return { ref, animating };
}

// Слот лоадера внутри кнопки (v1.7.5): в покое не занимает ширины, при
// active кнопка плавно дорастает под крутящиеся стрелки — приём капсулы
// колокольчика (grid 0fr↔1fr; max-width обрывал движение, v1.6.4). Текст
// кнопки при этом никуда не девается — ожидание видно, кнопка живая.
const REDUCED_MOTION = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Минимальная церемония лоадера (v1.7.5, спека пользователя): по тапу
// стрелки обязаны выехать, сделать два полных оборота и только после этого
// заехать обратно — даже если ответ пришёл мгновенно. Без этого на быстрой
// сети слот дёргался «выехал-заехал». Хук держит видимое active, пока не
// пройдут и операция, и церемония.
export const SPINNER_CEREMONY_MS = 300 + 2 * 800; // выезд (0.3s) + два оборота (по 0.8s)

export function useSpinnerCeremony(busy: boolean): boolean {
  const [held, setHeld] = useState(false);
  const startedAtRef = useRef(0);
  useEffect(() => {
    if (busy) {
      startedAtRef.current = performance.now();
      setHeld(true);
      return;
    }
    if (!held) return;
    const left = SPINNER_CEREMONY_MS - (performance.now() - startedAtRef.current);
    if (left <= 0) {
      setHeld(false);
      return;
    }
    const t = window.setTimeout(() => setHeld(false), left);
    return () => window.clearTimeout(t);
  }, [busy, held]);
  return held;
}

export const ExpandingSpinner: React.FC<{ active: boolean; size?: number; gap?: number }> = ({
  active, size = 15, gap = 8,
}) => (
  <span style={{
    display: 'grid',
    gridTemplateColumns: active ? '1fr' : '0fr',
    transition: REDUCED_MOTION ? undefined : 'grid-template-columns 0.3s ease-in-out',
  }}>
    <span style={{ overflow: 'hidden', minWidth: 0, display: 'flex', alignItems: 'center' }}>
      {/* Стрелки проявляются чуть позже ширины, а гаснут первыми — как
          статус в капсуле колокольчика. */}
      <span style={{
        display: 'flex', alignItems: 'center', paddingRight: `${gap}px`,
        opacity: active ? 1 : 0,
        transition: REDUCED_MOTION ? undefined
          : active ? 'opacity 0.2s ease 0.1s' : 'opacity 0.15s ease',
      }}>
        <RefreshIcon size={size} spinning={active} />
      </span>
    </span>
  </span>
);

export const RefreshIcon: React.FC<{ size?: number; spinning?: boolean }> = ({
  size = 16, spinning = false,
}) => {
  const { ref, animating } = useSpinFinish(spinning);
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        display: 'block',
        flexShrink: 0,
        animation: animating ? 'reqtrace-spin 0.8s linear infinite' : undefined,
      }}
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
};

export default RefreshIcon;
