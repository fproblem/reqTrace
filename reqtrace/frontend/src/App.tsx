import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { PageDetailPage } from './pages/PageDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { TestsPage } from './pages/TestsPage';
import { ProjectTestsPage } from './pages/ProjectTestsPage';
import { Layout } from './components/Layout/Layout';
import { ToastProvider } from './components/Toast';
import { ReviewQueueProvider } from './components/reviewQueue';
import { TreeRefreshProvider } from './hooks/useTreeRefresh';
import { colors, fonts, island } from './styles/tokens';
import { ModalButton } from './components/Modal';
import { DocumentIcon } from './components/icons';
import { listRecentPages } from './components/recentPages';

// Пустое состояние «/» — в языке экрана виртуальной страницы (заголовок +
// строка сути + явное действие; ревью: тусклая строка «выберите страницу»
// на фоне громкой виртуальной выглядела бедной родственницей). Кнопка
// открывает модалку добавления через событие — она живёт внутри PageTree.
// Недавние страницы (v1.8.1) — продолжение истории Cmd+K: рабочий день
// обычно начинается со вчерашней страницы, пусть она будет в один клик.
const HomeScreen: React.FC = () => {
  const navigate = useNavigate();
  // История читается один раз на маунте: пока экран открыт, ей не с чего
  // меняться (визиты страниц размонтируют «/»).
  const [recent] = React.useState(() => listRecentPages().slice(0, 5));
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: island.background,
      border: island.border,
      borderRadius: island.radius,
      boxShadow: island.boxShadowRaised,
    }}>
      <div style={{
        textAlign: 'center',
        maxWidth: '460px',
        padding: '40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
      }}>
        <div style={{ fontSize: '20px', fontWeight: 600, color: colors.textPrimary }}>
          Страница не выбрана
        </div>
        <div style={{ fontSize: '15px', color: colors.textSecondary, lineHeight: 1.55 }}>
          Выберите страницу в дереве слева — или добавьте новую
          из Confluence, чтобы начать отслеживать требования.
        </div>
        <ModalButton
          variant="primary"
          onClick={() => window.dispatchEvent(new CustomEvent('reqtrace:open-add-page'))}
          style={{ padding: '10px 28px' }}
        >
          Добавить страницу
        </ModalButton>
        {recent.length > 0 && (
          <div style={{ width: '100%', marginTop: '10px', textAlign: 'left' }}>
            <div style={{
              fontSize: '11px',
              fontWeight: 600,
              color: colors.textTertiary,
              marginBottom: '6px',
            }}>
              Недавние страницы
            </div>
            {recent.map(p => (
              <button
                key={p.id}
                onClick={() => navigate(`/pages/${p.id}`)}
                title={p.title}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '7px 10px',
                  border: 'none',
                  borderRadius: '8px',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <DocumentIcon size={14} style={{ color: colors.textTertiary, flexShrink: 0 }} />
                <span style={{
                  fontSize: '13px',
                  color: colors.textPrimary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}>
                  {p.title}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: fonts.body,
        background: colors.background,
        color: colors.textTertiary,
        fontSize: '14px',
      }}>
        Загрузка…
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <BrowserRouter>
      <TreeRefreshProvider>
        {/* Очередь проверки живёт над экранами: её плавающий бар переживает
            переходы между страницами, «Проверить» доступно ярусу «Тестов». */}
        <ReviewQueueProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<HomeScreen />} />
              <Route path="/pages/:pageId" element={<PageDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/tests" element={<TestsPage />} />
              <Route path="/tests/:projectId" element={<ProjectTestsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </ReviewQueueProvider>
      </TreeRefreshProvider>
    </BrowserRouter>
  );
}

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
