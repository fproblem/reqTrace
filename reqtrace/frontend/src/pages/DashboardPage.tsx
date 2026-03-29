import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { PageListItem } from '../types';
import { useToast } from '../components/Toast';
import { colors, radii, shadows } from '../styles/tokens';

interface DashboardPageProps {
  userId: string;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ userId }) => {
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { showToast } = useToast();

  const loadPages = useCallback(async () => {
    try {
      const data = await api.listPages();
      setPages(data);
    } catch (e: any) {
      showToast('error', 'Не удалось загрузить страницы', e.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadPages(); }, [loadPages]);

  const handleAddPage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    setAdding(true);
    setError('');
    try {
      await api.addPage(newUrl.trim(), userId);
      setNewUrl('');
      setShowAddForm(false);
      await loadPages();
    } catch (e: any) {
      const msg = e.message || 'Ошибка при добавлении';
      setError(msg);
      showToast('error', 'Не удалось добавить страницу', msg);
    } finally {
      setAdding(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1100px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '28px',
      }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: colors.textPrimary }}>
          Отслеживаемые страницы
        </h1>
        <button
          onClick={() => setShowAddForm(true)}
          style={{
            padding: '10px 20px',
            borderRadius: radii.pill,
            border: 'none',
            background: colors.greenAccent,
            color: '#fff',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'transform 0.1s',
          }}
          onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
          onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          + Добавить страницу
        </button>
      </div>

      {showAddForm && (
        <div style={{
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(20px)',
          border: `1px solid ${colors.border}`,
          borderRadius: radii.lg,
          padding: '24px',
          marginBottom: '24px',
          boxShadow: shadows.card,
        }}>
          <form onSubmit={handleAddPage} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '13px', fontWeight: 500, color: colors.textSecondary, display: 'block', marginBottom: '6px' }}>
                URL страницы Confluence
              </label>
              <input
                type="text"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                placeholder="https://confluence.example.com/pages/viewpage.action?pageId=12345"
                autoFocus
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: radii.md,
                  border: `1px solid ${colors.border}`,
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <button
              type="submit"
              disabled={!newUrl.trim() || adding}
              style={{
                padding: '10px 24px',
                borderRadius: radii.md,
                border: 'none',
                background: colors.greenAccent,
                color: '#fff',
                fontWeight: 600,
                fontSize: '14px',
                cursor: newUrl.trim() ? 'pointer' : 'default',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {adding ? 'Загрузка...' : 'Добавить'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setNewUrl(''); setError(''); }}
              style={{
                padding: '10px 16px',
                borderRadius: radii.md,
                border: `1px solid ${colors.border}`,
                background: 'transparent',
                color: colors.textSecondary,
                fontSize: '14px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Отмена
            </button>
          </form>
          {error && (
            <div style={{ color: colors.statusLost, fontSize: '13px', marginTop: '10px' }}>
              {error}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', color: colors.textSecondary, padding: '60px 0' }}>
          Загрузка...
        </div>
      ) : pages.length === 0 ? (
        <div style={{
          textAlign: 'center',
          color: colors.textSecondary,
          padding: '80px 0',
          fontSize: '15px',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '16px', opacity: 0.4 }}>📄</div>
          Нет отслеживаемых страниц.
          <br />Добавьте первую страницу Confluence для начала работы.
          <div style={{ marginTop: '24px' }}>
            <button
              onClick={async () => {
                try {
                  await api.addDemoPage(userId);
                  await loadPages();
                } catch (e: any) {
                  showToast('error', 'Не удалось добавить демо-страницу', e.message);
                }
              }}
              style={{
                padding: '10px 24px',
                borderRadius: radii.pill,
                border: `1px solid ${colors.border}`,
                background: colors.white,
                color: colors.textPrimary,
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Добавить демо-страницу
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {pages.map(page => (
            <div
              key={page.id}
              onClick={() => navigate(`/pages/${page.id}`)}
              style={{
                background: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(20px)',
                border: `1px solid ${colors.border}`,
                borderRadius: radii.lg,
                padding: '20px 24px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: shadows.card,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.boxShadow = shadows.cardHover;
                e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.boxShadow = shadows.card;
                e.currentTarget.style.borderColor = 'rgba(0,0,0,0.07)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: colors.textPrimary,
                    marginBottom: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}>
                    {page.title}
                    {page.has_updates && (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: colors.statusOutdated,
                        background: 'rgba(245,158,11,0.1)',
                        padding: '2px 8px',
                        borderRadius: radii.pill,
                      }}>
                        Обновлено в Confluence
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '13px', color: colors.textSecondary }}>
                    Снимок: {formatDate(page.last_snapshot_at)}
                    {' · '}
                    Baseline: {formatDate(page.baseline_at)}
                  </div>
                </div>
                <CoverageIndicator percent={page.coverage_percent} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const CoverageIndicator: React.FC<{ percent: number }> = ({ percent }) => {
  const displayPercent = Math.round(percent);
  const barColor = percent >= 70 ? colors.statusActive
    : percent >= 30 ? colors.statusOutdated
    : colors.statusLost;

  return (
    <div style={{ textAlign: 'right', minWidth: '80px' }}>
      <div style={{ fontSize: '18px', fontWeight: 700, color: barColor }}>
        {displayPercent}%
      </div>
      <div style={{
        width: '80px',
        height: '4px',
        borderRadius: '2px',
        background: 'rgba(0,0,0,0.06)',
        marginTop: '6px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${displayPercent}%`,
          height: '100%',
          borderRadius: '2px',
          background: barColor,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
};

export default DashboardPage;
