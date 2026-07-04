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
