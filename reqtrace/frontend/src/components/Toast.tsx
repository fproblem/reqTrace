import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { colors, radii, shadows } from '../styles/tokens';

type ToastType = 'error' | 'success' | 'warning';

interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextValue {
  showToast: (type: ToastType, title: string, message?: string) => void;
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

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(toast.id), 300);
    }, TOAST_DURATION);
    return () => clearTimeout(timerRef.current);
  }, [toast.id, onDismiss]);

  const handleDismiss = () => {
    clearTimeout(timerRef.current);
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
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
      </div>

      {/* Close */}
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

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
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
          `}</style>
          {toasts.map(t => (
            <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
};
