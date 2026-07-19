// Мягкое появление/скрытие выпадающих элементов (v1.6.6) — меню действий,
// панель дайджеста. Тайминг TreeReveal (160мс ease): интерфейс отвечает
// одинаково спокойно везде.
//
// В отличие от модалок (Modal.tsx гасит «призрак»-клон: их размонтирует
// родитель мгновенно), выпадашки позиционированы absolute относительно
// СВОЕГО родителя — клон в body потерял бы место. Поэтому здесь элемент
// задерживается в DOM на время затухания: хук превращает булево open в
// пару «mounted (рендерить ли) + fadeStyle (прозрачность и переход)».
// Пока элемент гаснет, он инертен (pointer-events: none) — клики по
// исчезающим пунктам не срабатывают.
import React, { useEffect, useState } from 'react';

const FADE_MS = 160;
const REDUCED_MOTION = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useFadeToggle(open: boolean): {
  /** Рендерить ли элемент: true и при open, и пока он догасает. */
  mounted: boolean;
  /** Домешать в style корня элемента. */
  fadeStyle: React.CSSProperties;
} {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      if (REDUCED_MOTION) {
        setVisible(true);
        return;
      }
      // Два кадра — приём TreeReveal: прозрачное состояние должно попасть
      // в раскладку до снятия, иначе transition не запустится.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setVisible(false);
    if (REDUCED_MOTION) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), FADE_MS + 20);
    return () => clearTimeout(timer);
  }, [open]);

  return {
    mounted,
    fadeStyle: REDUCED_MOTION ? {} : {
      opacity: visible ? 1 : 0,
      transition: `opacity ${FADE_MS}ms ease`,
      pointerEvents: open ? undefined : 'none',
    },
  };
}
