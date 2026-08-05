import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { PageDetailPage } from './pages/PageDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { TestsPage } from './pages/TestsPage';
import { ProjectTestsPage } from './pages/ProjectTestsPage';
import { Layout } from './components/Layout/Layout';
import { ToastProvider } from './components/Toast';
import { TreeRefreshProvider } from './hooks/useTreeRefresh';
import { colors, fonts, island } from './styles/tokens';
import { ModalButton } from './components/Modal';
import { useEnterFade } from './components/fadePresence';

// Пустое состояние «/» — в языке экрана виртуальной страницы (заголовок +
// строка сути + явное действие; ревью: тусклая строка «выберите страницу»
// на фоне громкой виртуальной выглядела бедной родственницей). Кнопка
// открывает модалку добавления через событие — она живёт внутри PageTree.
const HomeScreen: React.FC = () => {
  // Хореография входа: одиночный остров — без стаггера, просто мягко.
  const enter = useEnterFade(0);
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
    ...enter,
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
