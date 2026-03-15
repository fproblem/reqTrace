import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { colors, radii, shadows, glassmorphism, fonts } from '../../styles/tokens';
import { ChangelogModal, useCurrentVersion } from '../ChangelogModal';

interface LayoutProps {
  children: React.ReactNode;
  userName?: string;
  onLogout?: () => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, userName, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [changelogOpen, setChangelogOpen] = useState(false);
  const currentVersion = useCurrentVersion();

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      fontFamily: fonts.body,
      background: colors.background,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background blobs */}
      <div style={{
        position: 'fixed', top: '-10%', left: '-5%',
        width: '500px', height: '500px',
        borderRadius: '50%',
        background: colors.blobLilac,
        filter: 'blur(80px)',
        zIndex: 0,
      }} />
      <div style={{
        position: 'fixed', bottom: '-15%', right: '-5%',
        width: '600px', height: '600px',
        borderRadius: '50%',
        background: colors.blobGreen,
        filter: 'blur(80px)',
        zIndex: 0,
      }} />
      <div style={{
        position: 'fixed', top: '40%', right: '20%',
        width: '400px', height: '400px',
        borderRadius: '50%',
        background: colors.blobYellow,
        filter: 'blur(80px)',
        zIndex: 0,
      }} />

      {/* Sidebar */}
      <aside style={{
        width: '240px',
        minHeight: '100vh',
        padding: '24px 16px',
        ...glassmorphism,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ marginBottom: '32px' }}>
          <div
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: colors.greenDark,
              cursor: 'pointer',
              letterSpacing: '-0.5px',
            }}
            onClick={() => navigate('/')}
          >
            ReqTrace
          </div>
          {currentVersion && (
            <button
              onClick={() => setChangelogOpen(true)}
              style={{
                marginTop: '6px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: radii.pill,
                border: `1px solid ${colors.border}`,
                background: 'rgba(122, 224, 90, 0.08)',
                color: colors.textSecondary,
                fontSize: '11px',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = colors.greenAccent;
                e.currentTarget.style.color = colors.greenDark;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.color = colors.textSecondary;
              }}
            >
              v{currentVersion}
            </button>
          )}
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <NavItem
            label="Страницы"
            active={location.pathname === '/'}
            onClick={() => navigate('/')}
          />
          <NavItem
            label="Настройки"
            active={location.pathname === '/settings'}
            onClick={() => navigate('/settings')}
          />
        </nav>

        {userName && (
          <div style={{
            padding: '12px',
            borderTop: `1px solid ${colors.border}`,
            marginTop: '16px',
          }}>
            <div style={{ fontSize: '13px', color: colors.textSecondary }}>
              Пользователь
            </div>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              color: colors.textPrimary,
              marginTop: '4px',
            }}>
              {userName}
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                style={{
                  marginTop: '8px',
                  background: 'none',
                  border: 'none',
                  color: colors.textSecondary,
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                Выйти
              </button>
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <main style={{
        flex: 1,
        position: 'relative',
        zIndex: 1,
        overflow: 'auto',
      }}>
        {children}
      </main>

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
};

const NavItem: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({
  label, active, onClick,
}) => (
  <button
    onClick={onClick}
    style={{
      display: 'block',
      width: '100%',
      padding: '10px 14px',
      borderRadius: radii.md,
      border: 'none',
      background: active ? colors.greenLight : 'transparent',
      color: active ? colors.greenDark : colors.textPrimary,
      fontWeight: active ? 600 : 400,
      fontSize: '14px',
      cursor: 'pointer',
      textAlign: 'left',
      transition: 'all 0.15s ease',
      fontFamily: 'inherit',
    }}
  >
    {label}
  </button>
);

export default Layout;
