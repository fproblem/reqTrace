import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { colors, radii, shadows } from '../styles/tokens';

export const SettingsPage: React.FC = () => {
  const [confluenceUrl, setConfluenceUrl] = useState('');
  const [confluenceUser, setConfluenceUser] = useState('');
  const [confluencePass, setConfluencePass] = useState('');
  const [jiraUrl, setJiraUrl] = useState('');
  const [passwordSet, setPasswordSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getSettings();
        setConfluenceUrl(data.confluence_base_url);
        setConfluenceUser(data.confluence_username);
        setPasswordSet(data.confluence_password_set);
        setJiraUrl(data.jira_base_url);
      } catch (e: any) {
        showToast('error', 'Не удалось загрузить настройки', e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const result = await api.updateSettings({
        confluence_base_url: confluenceUrl.trim(),
        confluence_username: confluenceUser.trim(),
        confluence_password: confluencePass,
        jira_base_url: jiraUrl.trim(),
      });
      setPasswordSet(result.confluence_password_set);
      setConfluencePass('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      const msg = e.message || 'Ошибка при сохранении';
      setError(msg);
      showToast('error', 'Не удалось сохранить настройки', msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: colors.textSecondary }}>
        Загрузка...
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: radii.md,
    border: `1px solid ${colors.border}`,
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box' as const,
    background: colors.white,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '13px',
    fontWeight: 500,
    color: colors.textSecondary,
    marginBottom: '6px',
  };

  return (
    <div style={{ padding: '32px 40px', maxWidth: '700px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: colors.textPrimary, marginBottom: '8px' }}>
        Настройки
      </h1>
      <p style={{ fontSize: '14px', color: colors.textSecondary, marginBottom: '32px' }}>
        Параметры подключения к Confluence и Jira. Используются при добавлении и обновлении страниц.
      </p>

      {/* Confluence */}
      <div style={{
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(20px)',
        border: `1px solid ${colors.border}`,
        borderRadius: radii.lg,
        padding: '24px',
        marginBottom: '20px',
        boxShadow: shadows.card,
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: colors.textPrimary, marginBottom: '20px' }}>
          Confluence Server
        </h2>

        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>URL сервера</label>
          <input
            type="text"
            value={confluenceUrl}
            onChange={e => setConfluenceUrl(e.target.value)}
            placeholder="https://confluence.company.com"
            style={inputStyle}
          />
          <div style={{ fontSize: '12px', color: colors.textTertiary, marginTop: '4px' }}>
            Базовый URL вашего Confluence Server без завершающего слэша
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Логин</label>
            <input
              type="text"
              value={confluenceUser}
              onChange={e => setConfluenceUser(e.target.value)}
              placeholder="username"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>
              Пароль
              {passwordSet && (
                <span style={{ color: colors.statusActive, fontWeight: 400, marginLeft: '8px' }}>
                  (установлен)
                </span>
              )}
            </label>
            <input
              type="password"
              value={confluencePass}
              onChange={e => setConfluencePass(e.target.value)}
              placeholder={passwordSet ? '••••••••' : 'password'}
              style={inputStyle}
            />
            {passwordSet && (
              <div style={{ fontSize: '12px', color: colors.textTertiary, marginTop: '4px' }}>
                Оставьте пустым, чтобы сохранить текущий пароль
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Jira */}
      <div style={{
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(20px)',
        border: `1px solid ${colors.border}`,
        borderRadius: radii.lg,
        padding: '24px',
        marginBottom: '28px',
        boxShadow: shadows.card,
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: colors.textPrimary, marginBottom: '20px' }}>
          Jira
        </h2>

        <div>
          <label style={labelStyle}>URL сервера</label>
          <input
            type="text"
            value={jiraUrl}
            onChange={e => setJiraUrl(e.target.value)}
            placeholder="https://jira.company.com"
            style={inputStyle}
          />
          <div style={{ fontSize: '12px', color: colors.textTertiary, marginTop: '4px' }}>
            Используется для формирования ссылок на тест-кейсы (формат: URL/browse/PROJECT-123)
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 28px',
            borderRadius: radii.pill,
            border: 'none',
            background: colors.greenAccent,
            color: '#fff',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>

        {saved && (
          <span style={{ fontSize: '14px', color: colors.statusActive, fontWeight: 500 }}>
            Настройки сохранены
          </span>
        )}

        {error && (
          <span style={{ fontSize: '14px', color: colors.statusLost }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
