import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { colors, radii, shadows } from '../styles/tokens';

// Мягкость появления/скрытия — та же, что у каскада дерева (TreeReveal):
// интерфейс отвечает одинаково спокойно везде (ревью v1.6.6).
const FADE_MS = 160;
const REDUCED_MOTION = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Единая модалка приложения (эталон — экран «Настройки», v1.5.2).
//
// Портал в body обязателен: внутри контейнеров с backdrop-filter/transform
// position:fixed отсчитывается от контейнера (containing block), а не от
// вьюпорта — оверлей затемняет кусок экрана, окно прячется под соседями.
// Закрытие: ✕, Escape, mousedown по фону (mousedown, а не click — выделение
// текста с уводом курсора за окно не должно закрывать его).
// Фокус: ловушка на Tab внутри окна, возврат фокуса при закрытии.

// Выше выпадающих меню и попапов страницы (z 1000), ниже тостов (z 9999).
const OVERLAY_Z = 2000;

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  // Лёгкий блюр фона: модалка ещё заметнее отделяется от страницы. Именно
  // лёгкий — сильное размытие прячет контекст, к которому модалка относится.
  // ⚠ backdrop-filter делает оверлей containing block для fixed-потомков —
  // внутри модалок их нет (тосты и попапы живут вне, Select — absolute).
  backdropFilter: 'blur(3px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: OVERLAY_Z,
};

const windowStyle: React.CSSProperties = {
  background: colors.white,
  borderRadius: radii.lg,
  boxShadow: shadows.card,
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'calc(100vh - 48px)',
  display: 'flex',
  flexDirection: 'column',
  // Скроллится внутренняя область контента (шапка на месте): скроллбар на
  // самом окне налезал бы на скругление углов.
  overflow: 'hidden',
};

/** Сплошной текст в модалках: единый размер, интервал, выравнивание по ширине.
 *  ⚠ Не вставляйте в текст символы вне основного шрифта (→, ⚠, эмодзи):
 *  глиф из фолбэк-шрифта имеет другие вертикальные метрики и раздувает
 *  line box своей строки — межстрочные отступы становятся неровными. */
export const modalTextStyle: React.CSSProperties = {
  fontSize: '13px',
  lineHeight: 1.45,  // как у контента страниц (ContentRenderer/DiffView)
  color: colors.textSecondary,
  textAlign: 'justify',
  // Без pretty последняя строка-«сирота» оставляет предыдущую строку
  // растянутой огромными пробелами — на глаз это читается как неровные
  // межстрочные отступы (сами line box'ы ровные, замерено).
  textWrap: 'pretty',
  marginTop: 0,
  marginBottom: '14px',
};

export const XIcon: React.FC = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<{
  title: string;
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
}> = ({ title, onClose, width = '440px', children }) => {
  const windowRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Появление: прозрачность 0 → 1 после первого кадра (два rAF — приём
  // TreeReveal: закрытое состояние должно попасть в раскладку до снятия).
  const [visible, setVisible] = useState(REDUCED_MOTION);
  useEffect(() => {
    if (REDUCED_MOTION) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setVisible(true));
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, []);

  // Скрытие. Модалки живут условным рендером в десятке мест — родитель
  // размонтирует мгновенно, анимировать «после смерти» нечего. Поэтому при
  // размонтировании оверлей клонируется «призраком» прямо в body и гаснет
  // сам: работает для любого пути закрытия (крестик, Escape, фон, «Отмена»,
  // успешное действие) без переделки вызывающих. Призрак инертен
  // (pointer-events: none) и живёт меньше двух десятых секунды.
  useEffect(() => {
    // Узел захватывается на маунте: к моменту cleanup при размонтировании
    // React уже обнулил ref (пассивные эффекты чистятся после отвязки ref) —
    // чтение overlayRef.current здесь вернуло бы null, и призрака не было бы.
    const node = overlayRef.current;
    return () => {
      // Призрак — только когда узел реально покинул документ (настоящее
      // размонтирование). Страховка от cleanup на живой модалке (так делает
      // StrictMode в dev): клон поверх настоящей модалки — двойное моргание.
      if (!node || node.isConnected || REDUCED_MOTION) return;
      const ghost = node.cloneNode(true) as HTMLElement;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.pointerEvents = 'none';
      ghost.style.opacity = '1';
      ghost.style.transition = `opacity ${FADE_MS}ms ease`;
      document.body.appendChild(ghost);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { ghost.style.opacity = '0'; });
      });
      window.setTimeout(() => ghost.remove(), FADE_MS + 80);
    };
  }, []);

  useEffect(() => {
    const container = windowRef.current;
    if (!container) return;
    const opener = document.activeElement as HTMLElement | null;

    // Начальный фокус — только если autoFocus внутри окна не сработал сам.
    if (!container.contains(document.activeElement)) {
      container.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      const inside = container.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Вернуть фокус туда, откуда открыли (кнопка/пункт меню), если он ещё в DOM.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={overlayRef}
      style={{
        ...overlayStyle,
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={windowRef} role="dialog" aria-modal="true" style={{ ...windowStyle, width }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '24px 24px 0', marginBottom: '18px', flexShrink: 0,
        }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, color: colors.textPrimary, margin: 0 }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            title="Закрыть"
            style={{
              width: '30px', height: '30px', borderRadius: radii.sm,
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: colors.textTertiary, display: 'flex',
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
        <div className="island-scroll" style={{ padding: '0 24px 24px', overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};

// --- Кнопки нижнего ряда модалок: ховер и пресс-стейт у всех вариантов ---

type ModalButtonVariant = 'primary' | 'secondary' | 'danger';

const BUTTON_VARIANTS: Record<ModalButtonVariant, {
  bg: string; hoverBg: string; activeBg: string; color: string; border: string;
}> = {
  primary: {
    bg: colors.greenAccent, hoverBg: colors.greenDark, activeBg: '#3F9E27',
    color: '#fff', border: 'none',
  },
  secondary: {
    bg: 'transparent', hoverBg: 'rgba(0,0,0,0.04)', activeBg: 'rgba(0,0,0,0.08)',
    color: colors.textSecondary, border: `1px solid ${colors.border}`,
  },
  danger: {
    bg: colors.statusLost, hoverBg: '#DC2626', activeBg: '#B91C1C',
    color: '#fff', border: 'none',
  },
};

interface ModalButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ModalButtonVariant;
}

export const ModalButton: React.FC<ModalButtonProps> = ({
  variant = 'secondary', disabled, style, children, ...rest
}) => {
  const v = BUTTON_VARIANTS[variant];
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        padding: variant === 'secondary' ? '9px 18px' : '9px 22px',
        borderRadius: radii.pill,
        border: v.border,
        background: v.bg,
        color: v.color,
        fontSize: '14px',
        fontWeight: variant === 'secondary' ? 500 : 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s',
        ...style,
      }}
      onMouseEnter={e => {
        if (disabled) return;
        e.currentTarget.style.background = v.hoverBg;
        if (variant === 'secondary') {
          e.currentTarget.style.borderColor = colors.borderHover;
          e.currentTarget.style.color = colors.textPrimary;
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = v.bg;
        if (variant === 'secondary') {
          e.currentTarget.style.borderColor = colors.border;
          e.currentTarget.style.color = v.color;
        }
      }}
      onMouseDown={e => { if (!disabled) e.currentTarget.style.background = v.activeBg; }}
      onMouseUp={e => { if (!disabled) e.currentTarget.style.background = v.hoverBg; }}
    >
      {children}
    </button>
  );
};
