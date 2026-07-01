import React, { useState } from 'react';
import { useToast } from '../components/Toast';
import { useCurrentVersion } from '../components/ChangelogModal';
import { colors, radii, shadows, fonts } from '../styles/tokens';

interface LoginPageProps {
  onLogin: (name: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const currentVersion = useCurrentVersion();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onLogin(name.trim());
    } catch (err: any) {
      showToast('error', 'Не удалось войти', err.message);
    } finally {
      setLoading(false);
    }
  };

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
          marginBottom: '32px',
        }}>
          Трассировка покрытия требований
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{
            display: 'block',
            fontSize: '13px',
            fontWeight: 500,
            color: colors.textSecondary,
            marginBottom: '6px',
          }}>
            Ваше имя
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Введите имя..."
            autoFocus
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: radii.md,
              border: `1px solid ${colors.border}`,
              fontSize: '15px',
              fontFamily: 'inherit',
              outline: 'none',
              transition: 'border-color 0.15s',
              background: colors.white,
              boxSizing: 'border-box',
            }}
            onFocus={e => e.target.style.borderColor = colors.greenAccent}
            onBlur={e => e.target.style.borderColor = 'rgba(0,0,0,0.07)'}
          />
          <button
            type="submit"
            disabled={!name.trim() || loading}
            style={{
              width: '100%',
              marginTop: '20px',
              padding: '12px',
              borderRadius: radii.md,
              border: 'none',
              background: name.trim() ? colors.greenAccent : '#E5E7EB',
              color: name.trim() ? '#fff' : colors.textTertiary,
              fontSize: '15px',
              fontWeight: 600,
              cursor: name.trim() ? 'pointer' : 'default',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
