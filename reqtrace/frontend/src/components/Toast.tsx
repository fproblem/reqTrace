import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { colors, radii, shadows } from '../styles/tokens';
import { XIcon } from './Modal';

type ToastType = 'error' | 'success' | 'warning';

/** Тост-предложение с обратным отсчётом (наследник undo-тоста удаления
 *  привязок v1.5.4–v1.5.9). Живёт ровно `seconds` секунд с анимированным
 *  таймером: дотикал до конца или нажали кнопку отказа — НИЧЕГО не происходит,
 *  тост просто исчезает; нажали кнопку согласия — onAccept. Обычного крестика
 *  нет: явный отказ — это кнопка declineLabel. */
interface ToastPrompt {
  seconds: number;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
}

interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  prompt?: ToastPrompt;
}

interface ToastContextValue {
  showToast: (type: ToastType, title: string, message?: string) => void;
  /** Возвращает id — им можно снять тост досрочно через dismissToast
   *  (например, при уходе со страницы, к которой относилось предложение). */
  showPromptToast: (type: ToastType, title: string, opts: ToastPrompt & { message?: string }) => number;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

const TOAST_DURATION = 6000;

const typeStyles: Record<ToastType, { bg: string; border: string; titleColor: string }> = {
  error: {
    bg: 'rgba(239, 68, 68, 0.06)',
    border: 'rgba(239, 68, 68, 0.25)',
    titleColor: colors.statusLost,
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.06)',
    border: 'rgba(245, 158, 11, 0.25)',
    titleColor: colors.statusOutdated,
  },
  success: {
    bg: 'rgba(77, 184, 48, 0.06)',
    border: 'rgba(77, 184, 48, 0.25)',
    titleColor: colors.statusActive,
  },
};

// \u041a\u043e\u043b\u044c\u0446\u043e \u043e\u0431\u0440\u0430\u0442\u043d\u043e\u0433\u043e \u043e\u0442\u0441\u0447\u0451\u0442\u0430 undo-\u0442\u043e\u0441\u0442\u0430: \u0446\u0438\u0444\u0440\u0430 \u0441\u0435\u043a\u0443\u043d\u0434 \u0432 \u0446\u0435\u043d\u0442\u0440\u0435, \u0432\u043e\u043a\u0440\u0443\u0433 \u2014
// \u0434\u0443\u0433\u0430, \u043f\u043b\u0430\u0432\u043d\u043e \u0442\u0430\u044e\u0449\u0430\u044f \u043f\u043e \u0447\u0430\u0441\u043e\u0432\u043e\u0439 (stroke-dashoffset + transition 1s linear).
// \u041a\u043e\u043c\u043f\u0430\u043a\u0442\u043d\u043e\u0435 (26px), \u0441\u0442\u043e\u0438\u0442 \u0432 \u043f\u0440\u0430\u0432\u043e\u043c \u043a\u043b\u0430\u0441\u0442\u0435\u0440\u0435 \u0440\u044f\u0434\u043e\u043c \u0441 \u043a\u043d\u043e\u043f\u043a\u043e\u0439 \u043e\u0442\u043c\u0435\u043d\u044b.
// \u0414\u0443\u0433\u0430 \u0446\u0435\u043b\u0438\u0442\u0441\u044f \u0432 (secondsLeft - 1)/total \u0438 \u043f\u043e\u0442\u043e\u043c\u0443 \u0434\u043e\u0433\u043e\u0440\u0430\u0435\u0442 \u0440\u043e\u0432\u043d\u043e \u043a \u0441\u043a\u0440\u044b\u0442\u0438\u044e
// \u0442\u043e\u0441\u0442\u0430, \u0430 \u043d\u0435 \u043a \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0439 \u0446\u0438\u0444\u0440\u0435; \u043d\u0430 \u043f\u0435\u0440\u0432\u043e\u043c \u043a\u0430\u0434\u0440\u0435 \u0440\u0438\u0441\u0443\u0435\u0442\u0441\u044f \u043f\u043e\u043b\u043d\u043e\u0439 \u0438 \u0441\u0442\u0430\u0440\u0442\u0443\u0435\u0442
// \u0441\u043e \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u0433\u043e \u043a\u0430\u0434\u0440\u0430 (armed), \u0438\u043d\u0430\u0447\u0435 transition \u043d\u0435 \u0441\u044b\u0433\u0440\u0430\u0435\u0442 \u043d\u0430 initial render.
// 24×24 — как кружок-знак слева: два круглых элемента тоста одного размера.
const RING_SIZE = 24;
const RING_STROKE = 2;

const CountdownRing: React.FC<{ secondsLeft: number; total: number; color: string; style?: React.CSSProperties }> = ({
  secondsLeft, total, color, style: styleProp,
}) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const r = (RING_SIZE - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const fraction = Math.max(0, (armed ? secondsLeft - 1 : secondsLeft) / total);

  return (
    <div style={{ position: 'relative', width: RING_SIZE, height: RING_SIZE, flexShrink: 0, ...styleProp }}>
      <svg width={RING_SIZE} height={RING_SIZE} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle
          cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={r}
          fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={RING_STROKE}
        />
        <circle
          cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={r}
          fill="none" stroke={color} strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - fraction)}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <span style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        fontWeight: 700,
        color,
        fontVariantNumeric: 'tabular-nums',
      }}>
        <span
          key={secondsLeft}
          style={{ display: 'inline-block', animation: 'toast-digit-in 0.25s ease-out' }}
        >
          {secondsLeft}
        </span>
      </span>
    </div>
  );
};

// SVG-\u0437\u043d\u0430\u043a \u0432 \u043a\u0440\u0443\u0436\u043a\u0435 \u0442\u043e\u0441\u0442\u0430: \u00ab!\u00bb \u0443 error/warning, \u0433\u0430\u043b\u043e\u0447\u043a\u0430 \u0443 success. \u0422\u0435\u043a\u0441\u0442\u043e\u0432\u044b\u0435
// \u0433\u043b\u0438\u0444\u044b (!, \u2713) \u0440\u0438\u0441\u043e\u0432\u0430\u043b\u0438\u0441\u044c \u0444\u043e\u043b\u0431\u044d\u043a-\u0448\u0440\u0438\u0444\u0442\u0430\u043c\u0438 \u0438 \u043f\u043b\u044b\u043b\u0438 \u043f\u043e \u0431\u0430\u0437\u043e\u0432\u043e\u0439 \u043b\u0438\u043d\u0438\u0438.
// \u0422\u043e\u0447\u043a\u0430 \u00ab!\u00bb \u2014 \u043b\u0438\u043d\u0438\u044f \u043d\u0443\u043b\u0435\u0432\u043e\u0439 \u0434\u043b\u0438\u043d\u044b \u0441 \u043a\u0440\u0443\u0433\u043b\u044b\u043c \u043a\u043e\u043d\u0447\u0438\u043a\u043e\u043c.
const TypeIcon: React.FC<{ type: ToastType }> = ({ type }) => (
  <svg
    width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}
  >
    {type === 'success' ? (
      <polyline points="20 7 9 18 4 13" />
    ) : (
      <>
        <line x1="12" y1="4" x2="12" y2="14" />
        <line x1="12" y1="20" x2="12" y2="20.01" />
      </>
    )}
  </svg>
);

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
  const style = typeStyles[toast.type];
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const prompt = toast.prompt;
  const [secondsLeft, setSecondsLeft] = useState(prompt?.seconds ?? 0);
  // Гарантия «ровно один исход»: согласие, отказ или тихое угасание.
  const firedRef = useRef(false);

  const dismissAnimated = () => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  };

  // Обычный тост — стандартное время жизни.
  useEffect(() => {
    if (prompt) return;
    timerRef.current = setTimeout(dismissAnimated, TOAST_DURATION);
    return () => clearTimeout(timerRef.current);
  }, [toast.id]);

  // Промпт-тост — цепочка секундных тиков: N → … → 1 → тихое угасание
  // (действие НЕ совершается: предложением просто не воспользовались).
  // Внешний dismissToast(id) размонтирует тост, cleanup снимет таймер.
  useEffect(() => {
    if (!prompt || firedRef.current) return;
    const t = setTimeout(() => {
      if (secondsLeft > 1) {
        setSecondsLeft(secondsLeft - 1);
      } else {
        firedRef.current = true;
        dismissAnimated();
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const handleAccept = () => {
    if (!prompt || firedRef.current) return;
    firedRef.current = true;
    prompt.onAccept();
    dismissAnimated();
  };

  const handleDecline = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    dismissAnimated();
  };

  const handleDismiss = () => {
    clearTimeout(timerRef.current);
    dismissAnimated();
  };

  return (
    <div
      style={{
        background: colors.white,
        border: `1px solid ${style.border}`,
        borderRadius: radii.md,
        padding: '14px 16px',
        boxShadow: shadows.panel,
        display: 'flex',
        gap: '12px',
        // Промпт-тост — одна строка (текст | кольцо | дивайдер | кнопки), всё
        // по центру; у обычного тоста иконка и крестик сидят на первой строке.
        // Ширина промпта — по содержимому (fit-content + нерастяжимый текст),
        // иначе колонка текста растягивалась и между ней и кольцом отсчёта
        // повисала пустота. Потолок 535 замерен headless-Chrome: колонке
        // достаётся ~194px — заголовок «Все привязки проверены» (178px) живёт
        // в одну строку с запасом на платформенные шрифты, вопрос переносится.
        alignItems: prompt ? 'center' : 'flex-start',
        maxWidth: prompt ? '535px' : '420px',
        width: prompt ? 'fit-content' : '100%',
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateX(40px)' : 'translateX(0)',
        transition: 'opacity 0.3s, transform 0.3s',
        animation: 'toast-in 0.3s ease-out',
      }}
    >
      {/* Icon — кружок 24px, заголовок выровнен на его высоту (line-height 24) */}
      <div style={{
        width: '24px',
        height: '24px',
        borderRadius: '50%',
        background: style.bg,
        border: `1.5px solid ${style.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: style.titleColor,
        flexShrink: 0,
      }}>
        <TypeIcon type={toast.type} />
      </div>

      {/* Content. У промпта текст не тянется на свободное место (см. width
          корня) — только ужимается с переносом, когда упёрся в потолок. */}
      <div style={{ flex: prompt ? '0 1 auto' : 1, minWidth: 0 }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          lineHeight: '24px',
          color: style.titleColor,
          marginBottom: toast.message ? '2px' : 0,
        }}>
          {toast.title}
        </div>
        {toast.message && (
          <div style={{
            fontSize: '12px',
            color: colors.textSecondary,
            lineHeight: 1.5,
            wordBreak: 'break-word',
          }}>
            {toast.message}
          </div>
        )}

      </div>

      {/* Правый кластер промпт-тоста: кольцо отсчёта | дивайдер | «отказ» |
          «согласие» — одна группа, выровнена по центру строки. Согласие —
          залитая зелёная кнопка (как «Добавить» в панели), отказ — нейтральная
          пилюля. Крестика нет: явный отказ — это кнопка. */}
      {prompt && (
        <>
          <CountdownRing
            secondsLeft={secondsLeft}
            total={prompt.seconds}
            color={style.titleColor}
          />
          <div style={{
            width: '1px',
            height: '28px',
            background: colors.border,
            flexShrink: 0,
          }} />
          <button
            onClick={handleDecline}
            style={{
              padding: '6px 16px',
              borderRadius: radii.pill,
              border: `1px solid ${colors.border}`,
              background: 'transparent',
              color: colors.textSecondary,
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              flexShrink: 0,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
              e.currentTarget.style.borderColor = colors.borderHover;
              e.currentTarget.style.color = colors.textPrimary;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = colors.border;
              e.currentTarget.style.color = colors.textSecondary;
            }}
            onMouseDown={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
            onMouseUp={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
          >
            {prompt.declineLabel}
          </button>
          <button
            onClick={handleAccept}
            style={{
              padding: '6px 16px',
              borderRadius: radii.pill,
              border: 'none',
              background: colors.greenAccent,
              color: '#fff',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              flexShrink: 0,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = colors.greenDark; }}
            onMouseLeave={e => { e.currentTarget.style.background = colors.greenAccent; }}
            onMouseDown={e => { e.currentTarget.style.background = '#3F9E27'; }}
            onMouseUp={e => { e.currentTarget.style.background = colors.greenDark; }}
          >
            {prompt.acceptLabel}
          </button>
        </>
      )}
      {!prompt && (
        <button
          onClick={handleDismiss}
          title="Закрыть"
          style={{
            width: '26px',
            height: '26px',
            marginTop: '-1px',
            marginRight: '-4px',
            borderRadius: radii.sm,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: colors.textTertiary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'all 0.15s',
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
      )}
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((type: ToastType, title: string, message?: string) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, type, title, message }]);
  }, []);

  const showPromptToast = useCallback((
    type: ToastType, title: string, opts: ToastPrompt & { message?: string },
  ) => {
    const id = nextId.current++;
    const { message, ...prompt } = opts;
    setToasts(prev => [...prev, { id, type, title, message, prompt }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, showPromptToast, dismissToast }}>
      {children}

      {/* Toast container */}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          // К правому краю: промпт-тост уже обычных, и при дефолтном stretch
          // одновременно видимые тосты разной ширины расползались бы от него.
          alignItems: 'flex-end',
          gap: '8px',
          pointerEvents: 'auto',
        }}>
          <style>{`
            @keyframes toast-in {
              from { opacity: 0; transform: translateX(40px); }
              to { opacity: 1; transform: translateX(0); }
            }
            @keyframes toast-digit-in {
              from { opacity: 0; transform: translateY(-6px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
          {toasts.map(t => (
            <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
};
