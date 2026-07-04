import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { colors, radii, shadows } from '../styles/tokens';

type ToastType = 'error' | 'success' | 'warning';

/** Тост с обратным отсчётом и кнопкой отмены (отложенные действия).
 *  Живёт ровно `seconds` секунд с анимированным таймером и прогресс-баром:
 *  дотикал до конца — onExpire (действие совершается), нажали кнопку —
 *  onAction (действие отменяется). Обычного крестика у такого тоста нет:
 *  закрытие было бы неоднозначным (совершить или отменить?). */
interface ToastUndo {
  seconds: number;
  actionLabel: string;
  onAction: () => void;
  onExpire: () => void;
}

interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  undo?: ToastUndo;
}

interface ToastContextValue {
  showToast: (type: ToastType, title: string, message?: string) => void;
  /** Возвращает id — им можно снять тост досрочно через dismissToast
   *  (onExpire при этом НЕ вызывается — вызывающий сам решает судьбу действия). */
  showUndoToast: (type: ToastType, title: string, opts: ToastUndo & { message?: string }) => number;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

const TOAST_DURATION = 6000;

const typeStyles: Record<ToastType, { bg: string; border: string; icon: string; titleColor: string }> = {
  error: {
    bg: 'rgba(239, 68, 68, 0.06)',
    border: 'rgba(239, 68, 68, 0.25)',
    icon: '!',
    titleColor: colors.statusLost,
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.06)',
    border: 'rgba(245, 158, 11, 0.25)',
    icon: '!',
    titleColor: colors.statusOutdated,
  },
  success: {
    bg: 'rgba(77, 184, 48, 0.06)',
    border: 'rgba(77, 184, 48, 0.25)',
    icon: '\u2713',
    titleColor: colors.statusActive,
  },
};

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
  const style = typeStyles[toast.type];
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const undo = toast.undo;
  const [secondsLeft, setSecondsLeft] = useState(undo?.seconds ?? 0);
  // Гарантия «ровно один исход»: либо onExpire, либо onAction.
  const firedRef = useRef(false);

  const dismissAnimated = () => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  };

  // Обычный тост — стандартное время жизни.
  useEffect(() => {
    if (undo) return;
    timerRef.current = setTimeout(dismissAnimated, TOAST_DURATION);
    return () => clearTimeout(timerRef.current);
  }, [toast.id]);

  // Undo-тост — цепочка секундных тиков: 7 → … → 1 → onExpire.
  // Внешний dismissToast(id) размонтирует тост, cleanup снимет таймер и
  // onExpire не сработает — досрочную судьбу действия решает вызывающий.
  useEffect(() => {
    if (!undo || firedRef.current) return;
    const t = setTimeout(() => {
      if (secondsLeft > 1) {
        setSecondsLeft(secondsLeft - 1);
      } else {
        firedRef.current = true;
        undo.onExpire();
        dismissAnimated();
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const handleUndo = () => {
    if (!undo || firedRef.current) return;
    firedRef.current = true;
    undo.onAction();
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
        alignItems: 'flex-start',
        maxWidth: '420px',
        width: '100%',
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateX(40px)' : 'translateX(0)',
        transition: 'opacity 0.3s, transform 0.3s',
        animation: 'toast-in 0.3s ease-out',
      }}
    >
      {/* Icon */}
      <div style={{
        width: '22px',
        height: '22px',
        borderRadius: '50%',
        background: style.bg,
        border: `1.5px solid ${style.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: 700,
        color: style.titleColor,
        flexShrink: 0,
      }}>
        {style.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 600,
          color: style.titleColor,
          marginBottom: toast.message ? '4px' : 0,
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

        {/* Обратный отсчёт: прогресс-бар тает к следующей цифре, цифра
            сменяется с лёгким въездом сверху, справа — кнопка отмены */}
        {undo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
            <div style={{
              flex: 1,
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(0,0,0,0.08)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                borderRadius: '2px',
                background: style.titleColor,
                width: `${(secondsLeft / undo.seconds) * 100}%`,
                transition: 'width 1s linear',
              }} />
            </div>
            <span style={{
              width: '14px',
              textAlign: 'center',
              fontSize: '12px',
              fontWeight: 700,
              color: style.titleColor,
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
            }}>
              <span
                key={secondsLeft}
                style={{ display: 'inline-block', animation: 'toast-digit-in 0.25s ease-out' }}
              >
                {secondsLeft}
              </span>
            </span>
            <button
              onClick={handleUndo}
              style={{
                padding: '4px 12px',
                borderRadius: radii.pill,
                border: `1px solid ${colors.border}`,
                background: 'transparent',
                color: colors.textSecondary,
                fontSize: '12px',
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
              {undo.actionLabel}
            </button>
          </div>
        )}
      </div>

      {/* Close — у undo-тоста крестика нет: закрытие было бы неоднозначным */}
      {!undo && (
        <button
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: colors.textTertiary,
            fontSize: '16px',
            padding: 0,
            flexShrink: 0,
            lineHeight: '22px',
            height: '22px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          ✕
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

  const showUndoToast = useCallback((
    type: ToastType, title: string, opts: ToastUndo & { message?: string },
  ) => {
    const id = nextId.current++;
    const { message, ...undo } = opts;
    setToasts(prev => [...prev, { id, type, title, message, undo }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, showUndoToast, dismissToast }}>
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
