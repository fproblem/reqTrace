import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { useCurrentVersion } from '../components/ChangelogModal';
import { colors, radii, shadows, fonts } from '../styles/tokens';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GIS_TIMEOUT_MS = 8000;

/** Загрузка скрипта Google Identity Services с таймаутом (может быть заблокирован/офлайн). */
function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const fail = () => reject(new Error('gis-unavailable'));
    const timer = window.setTimeout(fail, GIS_TIMEOUT_MS);

    let script = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => {
      window.clearTimeout(timer);
      if (window.google?.accounts?.id) {
        resolve();
      } else {
        fail();
      }
    });
    script.addEventListener('error', () => {
      window.clearTimeout(timer);
      fail();
    });
  });
}

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const { showToast } = useToast();
  const currentVersion = useCurrentVersion();

  // gisState — доступность самой кнопки Google; loginError — отказ уже при входе
  // (не тот домен, невалидный токен), кнопка при этом остаётся рабочей.
  const [gisState, setGisState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [gisError, setGisError] = useState('');
  const [loginError, setLoginError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const buttonRef = useRef<HTMLDivElement>(null);

  const handleCredential = useCallback(async (credential: string) => {
    setSubmitting(true);
    setLoginError('');
    try {
      await login(credential); // AuthContext переключит приложение на рабочий экран
    } catch (e) {
      const message = e instanceof ApiError && e.message
        ? e.message
        : 'Не удалось войти. Попробуйте ещё раз';
      setLoginError(message);
      showToast('error', 'Не удалось войти', message);
    } finally {
      setSubmitting(false);
    }
  }, [login, showToast]);

  useEffect(() => {
    let cancelled = false;
    setGisState('loading');
    setGisError('');

    (async () => {
      try {
        const { google_client_id } = await api.getAuthConfig();
        if (!google_client_id) {
          throw new Error('Авторизация не настроена на сервере: не задан GOOGLE_CLIENT_ID');
        }
        await loadGisScript();
        if (cancelled || !buttonRef.current) return;

        const gis = window.google!.accounts.id;
        gis.initialize({
          client_id: google_client_id,
          callback: response => { void handleCredential(response.credential); },
        });
        buttonRef.current.innerHTML = '';
        gis.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          width: 300,
          locale: 'ru',
          text: 'signin_with',
        });
        setGisState('ready');
      } catch (e) {
        if (cancelled) return;
        setGisState('error');
        setGisError(
          e instanceof Error && e.message !== 'gis-unavailable'
            ? e.message
            : 'Не удалось загрузить вход через Google. Проверьте доступ к accounts.google.com и попробуйте ещё раз',
        );
      }
    })();

    return () => { cancelled = true; };
  }, [attempt, handleCredential]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: fonts.body,
      background: colors.background,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background blobs */}
      <div style={{
        position: 'absolute', top: '-15%', left: '-10%',
        width: '500px', height: '500px', borderRadius: '50%',
        background: colors.blobLilac, filter: 'blur(80px)',
      }} />
      <div style={{
        position: 'absolute', bottom: '-20%', right: '-10%',
        width: '600px', height: '600px', borderRadius: '50%',
        background: colors.blobGreen, filter: 'blur(80px)',
      }} />
      <div style={{
        position: 'absolute', top: '50%', left: '60%',
        width: '400px', height: '400px', borderRadius: '50%',
        background: colors.blobYellow, filter: 'blur(80px)',
      }} />

      <div style={{
        background: 'rgba(255,255,255,0.8)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: '48px 40px',
        width: '100%',
        maxWidth: '400px',
        boxShadow: shadows.panel,
        position: 'relative',
        zIndex: 1,
      }}>
        <img
          src={`${process.env.PUBLIC_URL}/logo.svg?v=${currentVersion}`}
          alt="ReqTrace — Требования, Тесты, Покрытие"
          style={{ height: '58px', display: 'block', marginBottom: '12px' }}
        />
        <div style={{
          fontSize: '14px',
          color: colors.textSecondary,
          marginBottom: '28px',
        }}>
          Трассировка покрытия требований
        </div>

        {/* Контейнер кнопки Google — GIS отрисовывает её сюда сам */}
        <div style={{ display: 'flex', justifyContent: 'center', minHeight: '44px', marginBottom: '16px' }}>
          {gisState === 'error' ? (
            <div style={{ width: '100%' }}>
              <div style={{
                padding: '12px 14px', borderRadius: radii.md,
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: colors.textSecondary, fontSize: '13px', lineHeight: 1.5,
              }}>
                {gisError}
              </div>
              <button
                onClick={() => setAttempt(a => a + 1)}
                style={{
                  width: '100%', marginTop: '12px', padding: '10px',
                  borderRadius: radii.md, border: `1px solid ${colors.border}`,
                  background: colors.white, color: colors.textPrimary,
                  fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Повторить
              </button>
            </div>
          ) : (
            <div>
              <div ref={buttonRef} style={{ display: 'flex', justifyContent: 'center' }} />
              {gisState === 'loading' && (
                <div style={{ fontSize: '13px', color: colors.textTertiary, textAlign: 'center' }}>
                  Загрузка входа через Google…
                </div>
              )}
              {submitting && (
                <div style={{ fontSize: '13px', color: colors.textSecondary, textAlign: 'center', marginTop: '8px' }}>
                  Входим…
                </div>
              )}
            </div>
          )}
        </div>

        {loginError && (
          <div style={{
            padding: '12px 14px', marginBottom: '16px', borderRadius: radii.md,
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            color: '#B91C1C', fontSize: '13px', lineHeight: 1.5,
          }}>
            {loginError}
          </div>
        )}

        <div style={{
          padding: '12px 14px', borderRadius: radii.md,
          background: 'rgba(122, 224, 90, 0.10)',
          border: '1px solid rgba(122, 224, 90, 0.25)',
          fontSize: '12px', color: colors.textSecondary, lineHeight: 1.6,
        }}>
          Вход через корпоративный Google-аккаунт{' '}
          <span style={{ color: colors.greenDark, fontWeight: 600 }}>@surf.dev</span>.
          Доступ только для сотрудников Surf.
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
