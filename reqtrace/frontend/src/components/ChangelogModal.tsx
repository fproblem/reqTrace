import React, { useState, useEffect } from 'react';
import { Modal, modalTextStyle } from './Modal';
import { colors, radii } from '../styles/tokens';

interface ChangelogEntry {
  version: string;
  title?: string;
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
    fetch('/changelog.json', { cache: 'no-cache' })
      .then(r => r.json())
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [open]);

  if (!open) return null;

  return (
    <Modal title="История изменений" width="520px" onClose={onClose}>
      <div>
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
                  {/* Version header: номер + заголовок релиза слева, дата справа */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: '12px',
                    marginBottom: '12px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 }}>
                      <span style={{
                        fontSize: '15px',
                        fontWeight: 700,
                        color: colors.textPrimary,
                        fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        flexShrink: 0,
                      }}>
                        v{entry.version}
                      </span>
                      {entry.title && (
                        <span style={{
                          fontSize: '13.5px',
                          fontWeight: 600,
                          color: colors.textPrimary,
                        }}>
                          {entry.title}
                        </span>
                      )}
                    </div>
                    <span style={{
                      fontSize: '13px',
                      color: colors.textTertiary,
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
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
                      <li key={ci} style={{ ...modalTextStyle, marginBottom: 0 }}>
                        {change}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
      </div>
    </Modal>
  );
};

export function useCurrentVersion(): string {
  const [version, setVersion] = useState('');

  useEffect(() => {
    fetch('/changelog.json', { cache: 'no-cache' })
      .then(r => r.json())
      .then((data: ChangelogEntry[]) => {
        if (data.length > 0) setVersion(data[0].version);
      })
      .catch(() => {});
  }, []);

  return version;
}

export default ChangelogModal;
