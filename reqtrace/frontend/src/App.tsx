import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './api/client';
import { User } from './types';
import { LoginPage } from './pages/LoginPage';
import { PageDetailPage } from './pages/PageDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { Layout } from './components/Layout/Layout';
import { ToastProvider } from './components/Toast';
import { colors } from './styles/tokens';

const USER_STORAGE_KEY = 'reqtrace_user';

function App() {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem(USER_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const handleLogin = async (name: string) => {
    const userData = await api.loginUser(name);
    setUser(userData);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem(USER_STORAGE_KEY);
  };

  if (!user) {
    return (
      <ToastProvider>
        <LoginPage onLogin={handleLogin} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
    <BrowserRouter>
      <Layout userName={user.name} userId={user.id} onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: colors.textTertiary,
              fontSize: '15px',
            }}>
              Выберите страницу в боковой панели
            </div>
          } />
          <Route
            path="/pages/:pageId"
            element={<PageDetailPage userId={user.id} />}
          />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
