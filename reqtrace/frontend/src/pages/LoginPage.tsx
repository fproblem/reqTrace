import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { useCurrentVersion } from '../components/ChangelogModal';
import { ChartIcon, IconBadge, ShieldIcon, TargetIcon } from '../components/icons';
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

/** Три тезиса о продукте в презентационной панели. */
const FEATURES = [
  {
    Icon: TargetIcon,
    title: 'Полная прослеживаемость',
    text: 'Связывайте фрагменты требований с тестами в единую картину покрытия.',
  },
  {
    Icon: ShieldIcon,
    title: 'Контроль покрытия',
    text: 'Следите за покрытием с учётом изменений на страницах Confluence.',
  },
  {
    Icon: ChartIcon,
    title: 'Прозрачность процессов',
    text: 'Принимайте решения на основе актуальных данных.',
  },
];

const NARROW_QUERY = '(max-width: 880px)';

/** Узкое окно: презентационная панель прячется, остаётся компактная карточка входа. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(NARROW_QUERY);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const { showToast } = useToast();
  const currentVersion = useCurrentVersion();
  const narrow = useIsNarrow();

  // gisState — доступность самой кнопки Google; loginError — отказ уже при входе
  // (не тот домен, невалидный токен), кнопка при этом остаётся рабочей.
  const [gisState, setGisState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [gisError, setGisError] = useState('');
  const [loginError, setLoginError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const buttonRef = useRef<HTMLDivElement>(null);
  const panelContentRef = useRef<HTMLDivElement>(null);

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
        // Кнопка на всю ширину колонки входа (GIS принимает только фиксированную
        // ширину в px, максимум 400) — с запасом под самые узкие экраны.
        const width = Math.max(240, Math.min(360, panelContentRef.current?.clientWidth || 360));
        buttonRef.current.innerHTML = '';
        gis.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          width,
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
  }, [attempt, handleCredential, narrow]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      fontFamily: fonts.body,
      background: colors.background,
      position: 'relative',
    }}>
      {/* Background blobs — в отдельном слое, чтобы не ломать прокрутку на низких окнах */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', top: '-15%', left: '-10%',
          width: '500px', height: '500px', borderRadius: '50%',
          background: colors.blobGreen, filter: 'blur(80px)',
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
      </div>

      <div style={{
        margin: 'auto',
        width: '100%',
        boxSizing: 'border-box',
        padding: '36px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '26px',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Шапка: логотип и слоган */}
        <div style={{ textAlign: 'center' }}>
          {/* logo-header.svg — вариант без запечённого слогана: слоган ниже отдельной строкой */}
          <img
            src={`${process.env.PUBLIC_URL}/logo-header.svg?v=${currentVersion}`}
            alt="ReqTrace"
            style={{ height: '52px', display: 'block', margin: '0 auto 8px' }}
          />
          <div style={{ fontSize: '14px', fontWeight: 600, color: colors.textSecondary, letterSpacing: '0.3px' }}>
            Требования · Тесты · Покрытие
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'stretch',
          width: '100%',
          maxWidth: narrow ? '440px' : '960px',
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          boxShadow: shadows.panel,
          overflow: 'hidden',
        }}>
          {/* Презентационная панель: что такое ReqTrace */}
          {!narrow && (
            <div style={{
              flex: '1.1 1 0',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              padding: '44px 44px 0',
              background: 'rgba(122, 224, 90, 0.04)',
              borderRight: `1px solid ${colors.border}`,
            }}>
              <div style={{ fontSize: '26px', lineHeight: 1.3, fontWeight: 700, color: colors.textPrimary, marginBottom: '14px' }}>
                Отслеживайте требования.<br />Покрывайте тестами.
              </div>
              <div style={{ fontSize: '14px', lineHeight: 1.65, color: colors.textSecondary, marginBottom: '28px' }}>
                ReqTrace помогает командам обеспечивать прослеживаемость требований
                и контроль качества на всех этапах разработки.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {FEATURES.map(({ Icon, title, text }) => (
                  <div key={title} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                    <IconBadge tint="green" size={40} radius={20}>
                      <Icon size={18} />
                    </IconBadge>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: colors.textPrimary, marginBottom: '3px' }}>
                        {title}
                      </div>
                      <div style={{ fontSize: '13px', lineHeight: 1.55, color: colors.textSecondary }}>
                        {text}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Иллюстрация прижата к нижнему краю панели и обрезается им */}
              <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
                <img
                  src={`${process.env.PUBLIC_URL}/authChecklists1.svg`}
                  alt=""
                  aria-hidden="true"
                  style={{ display: 'block', width: '82%', maxWidth: '400px', margin: '0 auto' }}
                />
              </div>
            </div>
          )}

          {/* Панель входа */}
          <div style={{
            flex: '1 1 0',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: narrow ? '40px 28px' : '48px 40px',
          }}>
            <div ref={panelContentRef} style={{ width: '100%', maxWidth: '360px' }}>
              <div style={{ fontSize: '22px', fontWeight: 700, color: colors.textPrimary, textAlign: 'center', marginBottom: '8px' }}>
                Добро пожаловать!
              </div>
              <div style={{ fontSize: '14px', color: colors.textSecondary, textAlign: 'center', marginBottom: '28px' }}>
                Войдите в ReqTrace, чтобы продолжить работу
              </div>

              {/* Контейнер кнопки Google — GIS отрисовывает её сюда сам */}
              <div style={{ minHeight: '44px', marginBottom: '16px' }}>
                {gisState === 'error' ? (
                  <div>
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
                  <>
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
                  </>
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
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
