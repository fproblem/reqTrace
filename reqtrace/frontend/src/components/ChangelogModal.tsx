import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { colors, radii } from '../styles/tokens';

// Запись изменения: новые версии ведут объекты с заголовком и иконкой
// (рендерятся «линией времени» с цветными значками), старые — просто строки
// (компактный пункт с точкой на той же линии). Оба формата живут вместе.
interface ChangeItem {
  icon?: string;
  title?: string;
  text: string;
}
type Change = string | ChangeItem;

interface ChangelogEntry {
  version: string;
  title?: string;
  date: string;
  changes: Change[];
}

const asItem = (c: Change): ChangeItem => (typeof c === 'string' ? { text: c } : c);

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

// --- Значки изменений: пастельная плашка + цветная иконка ---

const ICON_TINTS = {
  green: { bg: 'rgba(122, 224, 90, 0.10)', border: 'rgba(122, 224, 90, 0.45)', fg: colors.greenDark },
  blue: { bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.35)', fg: '#2563EB' },
  purple: { bg: 'rgba(147, 102, 255, 0.08)', border: 'rgba(147, 102, 255, 0.35)', fg: '#7C3AED' },
  amber: { bg: 'rgba(245, 158, 11, 0.10)', border: 'rgba(245, 158, 11, 0.40)', fg: '#B45309' },
} as const;

const svgProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  style: { display: 'block' },
};

const CHANGE_ICONS: Record<string, { tint: keyof typeof ICON_TINTS; svg: React.ReactNode }> = {
  highlight: {
    tint: 'green',
    svg: <svg {...svgProps}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>,
  },
  link: {
    tint: 'blue',
    svg: <svg {...svgProps}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>,
  },
  tree: {
    tint: 'purple',
    svg: <svg {...svgProps}><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" /></svg>,
  },
  layout: {
    tint: 'amber',
    svg: <svg {...svgProps}><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /></svg>,
  },
  search: {
    tint: 'blue',
    svg: <svg {...svgProps}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>,
  },
  plus: {
    tint: 'green',
    svg: <svg {...svgProps}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  },
  paint: {
    tint: 'purple',
    svg: <svg {...svgProps}><path d="M12 2.7s6.5 7 6.5 11.3a6.5 6.5 0 11-13 0C5.5 9.7 12 2.7 12 2.7z" /></svg>,
  },
  timer: {
    tint: 'amber',
    svg: <svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  },
  sparkle: {
    tint: 'green',
    svg: <svg {...svgProps}><path d="M12 3l2.1 5.9L20 11l-5.9 2.1L12 19l-2.1-5.9L4 11l5.9-2.1L12 3z" /></svg>,
  },
};

// Одна запись на линии времени. Записи с иконкой/заголовком получают цветной
// значок и жирный заголовок; строковые (старые версии) — компактную точку.
// Соединительная линия рисуется между значками, у последней записи её нет.
const ChangeRow: React.FC<{ item: ChangeItem; isLast: boolean }> = ({ item, isLast }) => {
  const iconDef = item.icon ? CHANGE_ICONS[item.icon] : undefined;
  const tint = iconDef ? ICON_TINTS[iconDef.tint] : undefined;

  return (
    <div style={{ display: 'flex', gap: '14px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '30px' }}>
        {iconDef && tint ? (
          <div style={{
            width: '30px',
            height: '30px',
            borderRadius: radii.md,
            background: tint.bg,
            border: `1px solid ${tint.border}`,
            color: tint.fg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            {iconDef.svg}
          </div>
        ) : (
          <div style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: colors.textTertiary,
            opacity: 0.55,
            marginTop: '6px',
            flexShrink: 0,
          }} />
        )}
        {!isLast && (
          <div style={{ width: '1px', flex: 1, background: colors.border, marginTop: '6px' }} />
        )}
      </div>
      <div style={{ minWidth: 0, paddingBottom: isLast ? 0 : (item.title ? '16px' : '10px') }}>
        {item.title && (
          <div style={{
            fontSize: '13.5px',
            fontWeight: 600,
            color: colors.textPrimary,
            marginBottom: '4px',
            lineHeight: 1.4,
          }}>
            {item.title}
          </div>
        )}
        <div style={{ fontSize: '13px', lineHeight: 1.5, color: colors.textSecondary, textWrap: 'pretty' }}>
          {item.text}
        </div>
      </div>
    </div>
  );
};

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

  const [current, ...older] = entries;

  return (
    <Modal title="История изменений" width="560px" onClose={onClose}>
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
          <>
            {/* Текущая версия — карточкой: номер, бейдж, заголовок релиза, дата */}
            <div style={{
              border: `1px solid rgba(122, 224, 90, 0.45)`,
              borderRadius: radii.lg,
              padding: '14px 18px',
              background: 'rgba(122, 224, 90, 0.05)',
              marginBottom: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  color: colors.textPrimary,
                  fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                }}>
                  v{current.version}
                </span>
                <span style={{
                  padding: '2px 9px',
                  borderRadius: radii.pill,
                  background: colors.greenLight,
                  color: colors.greenDark,
                  fontSize: '11px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>
                  Текущая версия
                </span>
                <span style={{
                  marginLeft: 'auto',
                  fontSize: '12.5px',
                  color: colors.textTertiary,
                  whiteSpace: 'nowrap',
                }}>
                  {formatDate(current.date)}
                </span>
              </div>
              {current.title && (
                <div style={{
                  marginTop: '7px',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: colors.textPrimary,
                }}>
                  {current.title}
                </div>
              )}
            </div>

            {/* Изменения текущей версии — линией времени */}
            <div>
              {current.changes.map((c, ci) => (
                <ChangeRow key={ci} item={asItem(c)} isLast={ci === current.changes.length - 1} />
              ))}
            </div>

            {/* Прошлые версии — компактнее, той же линией времени */}
            {older.map(entry => (
              <div key={entry.version} style={{
                marginTop: '22px',
                paddingTop: '18px',
                borderTop: `1px solid ${colors.border}`,
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '10px',
                  marginBottom: '12px',
                }}>
                  <span style={{
                    fontSize: '13.5px',
                    fontWeight: 700,
                    color: colors.textPrimary,
                    fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  }}>
                    v{entry.version}
                  </span>
                  {entry.title && (
                    <span style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: colors.textSecondary,
                      minWidth: 0,
                    }}>
                      {entry.title}
                    </span>
                  )}
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: '12px',
                    color: colors.textTertiary,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}>
                    {formatDate(entry.date)}
                  </span>
                </div>
                <div>
                  {entry.changes.map((c, ci) => (
                    <ChangeRow key={ci} item={asItem(c)} isLast={ci === entry.changes.length - 1} />
                  ))}
                </div>
              </div>
            ))}
          </>
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
