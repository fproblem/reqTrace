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
            <Route path="/" element={
              // Заглушка — тоже остров (v1.8.0): пустой экран не выбивается
              // из общего языка «карточки на полотне».
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: colors.textTertiary,
                fontSize: '15px',
                background: island.background,
                border: island.border,
                borderRadius: island.radius,
                boxShadow: island.boxShadow,
              }}>
                Выберите страницу в боковой панели
              </div>
            } />
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
