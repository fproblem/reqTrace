import React, { useState } from 'react';
import { Highlight, TestLink } from '../../types';
import { colors, radii, shadows } from '../../styles/tokens';

interface SidePanelProps {
  highlight: Highlight | null;
  jiraBaseUrl: string;
  onClose: () => void;
  onAddTest: (highlightId: string, testKey: string) => Promise<void>;
  onRemoveTest: (linkId: string) => Promise<void>;
  onDeleteHighlight: (highlightId: string) => Promise<void>;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  active: { label: 'Актуально', color: colors.statusActive },
  outdated: { label: 'Требует проверки', color: colors.statusOutdated },
  lost: { label: 'Утрачено', color: colors.statusLost },
};

export const SidePanel: React.FC<SidePanelProps> = ({
  highlight, jiraBaseUrl, onClose, onAddTest, onRemoveTest, onDeleteHighlight,
}) => {
  const [testKey, setTestKey] = useState('');
  const [adding, setAdding] = useState(false);

  if (!highlight) return null;

  const statusInfo = statusLabels[highlight.status] || statusLabels.active;

  const handleAdd = async () => {
    if (!testKey.trim()) return;
    setAdding(true);
    try {
      await onAddTest(highlight.id, testKey.trim().toUpperCase());
      setTestKey('');
    } finally {
      setAdding(false);
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  return (
    <div style={{
      width: '360px',
      borderLeft: `1px solid ${colors.border}`,
      background: 'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(20px)',
      height: '100%',
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontWeight: 600, fontSize: '15px', color: colors.textPrimary }}>
          Выделение
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '18px', color: colors.textSecondary, padding: '4px',
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: '20px', flex: 1 }}>
        {/* Status */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 12px',
          borderRadius: radii.pill,
          background: `${statusInfo.color}15`,
          color: statusInfo.color,
          fontSize: '12px',
          fontWeight: 600,
          marginBottom: '16px',
        }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: statusInfo.color,
          }} />
          {statusInfo.label}
        </div>

        {/* Text excerpt */}
        <div style={{
          background: 'rgba(0,0,0,0.02)',
          borderRadius: radii.md,
          padding: '12px 16px',
          fontSize: '13px',
          lineHeight: '1.5',
          color: colors.textPrimary,
          marginBottom: '20px',
          maxHeight: '150px',
          overflow: 'auto',
          border: `1px solid ${colors.border}`,
        }}>
          {highlight.text_content}
        </div>

        {/* Tests */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{
            fontSize: '13px', fontWeight: 600,
            color: colors.textSecondary, marginBottom: '10px',
          }}>
            Привязанные тесты ({highlight.tests.length})
          </div>

          {highlight.tests.length === 0 ? (
            <div style={{ fontSize: '13px', color: colors.textTertiary, fontStyle: 'italic' }}>
              Нет привязанных тестов
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {highlight.tests.map(test => (
                <div
                  key={test.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: radii.sm,
                    border: `1px solid ${colors.border}`,
                    background: colors.white,
                  }}
                >
                  <a
                    href={`${jiraBaseUrl}/browse/${test.test_key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#2563EB',
                      textDecoration: 'none',
                      fontWeight: 500,
                      fontSize: '13px',
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    {test.test_key}
                  </a>
                  <button
                    onClick={() => onRemoveTest(test.id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: colors.textTertiary, fontSize: '14px', padding: '2px 4px',
                    }}
                    title="Отвязать тест"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add test form */}
        <div style={{
          display: 'flex', gap: '8px', marginBottom: '20px',
        }}>
          <input
            type="text"
            value={testKey}
            onChange={e => setTestKey(e.target.value)}
            placeholder="PROJECT-123"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: radii.sm,
              border: `1px solid ${colors.border}`,
              fontSize: '13px',
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleAdd}
            disabled={!testKey.trim() || adding}
            style={{
              padding: '8px 14px',
              borderRadius: radii.sm,
              border: 'none',
              background: testKey.trim() ? colors.greenAccent : '#E5E7EB',
              color: '#fff',
              fontWeight: 600,
              fontSize: '13px',
              cursor: testKey.trim() ? 'pointer' : 'default',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            {adding ? '...' : 'Добавить'}
          </button>
        </div>

        {/* Meta info */}
        <div style={{
          fontSize: '12px', color: colors.textTertiary, lineHeight: '1.6',
        }}>
          Создано: {formatDate(highlight.created_at)}
        </div>

        {/* Delete button */}
        <button
          onClick={() => onDeleteHighlight(highlight.id)}
          style={{
            marginTop: '20px',
            width: '100%',
            padding: '8px',
            borderRadius: radii.sm,
            border: `1px solid rgba(239,68,68,0.2)`,
            background: 'rgba(239,68,68,0.05)',
            color: colors.statusLost,
            fontSize: '13px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Удалить выделение
        </button>
      </div>
    </div>
  );
};

export default SidePanel;
