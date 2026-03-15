import React, { useState, useEffect } from 'react';
import { colors, radii, shadows, fonts } from '../styles/tokens';

interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export const ChangelogModal: React.FC<ChangelogModalProps> = ({ open, onClose }) => {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch('/changelog.json')
      .then(r => r.json())
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.35)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
        fontFamily: fonts.body,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.white,
          borderRadius: radii.lg,
          width: '520px',
          maxWidth: '92vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '22px 28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: '17px',
            fontWeight: 700,
            color: colors.textPrimary,
          }}>
            История изменений
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '20px',
              color: colors.textSecondary,
              padding: '4px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{
          padding: '20px 28px 28px',
          overflowY: 'auto',
          flex: 1,
        }}>
          {entries.length === 0 ? (
            <div style={{
              color: colors.textTertiary,
              fontSize: '14px',
              textAlign: 'center',
              padding: '40px 0',
            }}>
              Нет записей
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {entries.map((entry, idx) => (
                <div
                  key={entry.version}
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderLeft: `3px solid ${idx === 0 ? colors.greenAccent : colors.border}`,
                    borderRadius: radii.md,
                    padding: '18px 20px',
                    background: idx === 0
                      ? 'rgba(122, 224, 90, 0.03)'
                      : colors.white,
                  }}
                >
                  {/* Version header */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: '12px',
                  }}>
                    <span style={{
                      fontSize: '15px',
                      fontWeight: 700,
                      color: colors.textPrimary,
                      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    }}>
                      v{entry.version}
                    </span>
                    <span style={{
                      fontSize: '13px',
                      color: colors.textTertiary,
                    }}>
                      {formatDate(entry.date)}
                    </span>
                  </div>

                  {/* Changes list */}
                  <ul style={{
                    margin: 0,
                    paddingLeft: '18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}>
                    {entry.changes.map((change, ci) => (
                      <li
                        key={ci}
                        style={{
                          fontSize: '13px',
                          lineHeight: '1.5',
                          color: colors.textSecondary,
                        }}
                      >
                        {change}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export function useCurrentVersion(): string {
  const [version, setVersion] = useState('');

  useEffect(() => {
    fetch('/changelog.json')
      .then(r => r.json())
      .then((data: ChangelogEntry[]) => {
        if (data.length > 0) setVersion(data[0].version);
      })
      .catch(() => {});
  }, []);

  return version;
}

export default ChangelogModal;
