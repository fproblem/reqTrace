import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { colors, radii } from '../styles/tokens';
import {
  IconProps, IconTint, ICON_TINTS,
  BellIcon, BranchIcon, ChevronsVerticalIcon, ClockIcon, DocumentIcon,
  DropletIcon, FlagIcon, GearIcon, ImageIcon, KeyboardIcon, LayoutIcon, LinkIcon,
  LockIcon, PanelIcon, PencilIcon, PlusIcon, SearchIcon, ShieldIcon, SparkleIcon,
  SyncIcon, TableIcon, TargetIcon, TrashIcon, UserIcon,
} from './icons';

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
// Оттенки — общий реестр ICON_TINTS (только фирменные цвета ReqTrace):
// зелёный — фичи и позитив, янтарный — внимание/статусы, красный — удаления,
// серый — нейтральные и структурные изменения.
const CHANGE_ICONS: Record<string, { tint: IconTint; Icon: React.FC<IconProps> }> = {
  highlight: { tint: 'green', Icon: PencilIcon },
  link: { tint: 'gray', Icon: LinkIcon },
  tree: { tint: 'gray', Icon: BranchIcon },
  layout: { tint: 'amber', Icon: LayoutIcon },
  search: { tint: 'gray', Icon: SearchIcon },
  plus: { tint: 'green', Icon: PlusIcon },
  paint: { tint: 'gray', Icon: DropletIcon },
  timer: { tint: 'amber', Icon: ClockIcon },
  sparkle: { tint: 'green', Icon: SparkleIcon },
  panel: { tint: 'gray', Icon: PanelIcon },
  table: { tint: 'amber', Icon: TableIcon },
  keyboard: { tint: 'gray', Icon: KeyboardIcon },
  bell: { tint: 'amber', Icon: BellIcon },
  trash: { tint: 'red', Icon: TrashIcon },
  gear: { tint: 'gray', Icon: GearIcon },
  lock: { tint: 'amber', Icon: LockIcon },
  user: { tint: 'green', Icon: UserIcon },
  doc: { tint: 'gray', Icon: DocumentIcon },
  flag: { tint: 'green', Icon: FlagIcon },
  image: { tint: 'gray', Icon: ImageIcon },
  shield: { tint: 'green', Icon: ShieldIcon },
  sync: { tint: 'green', Icon: SyncIcon },
  target: { tint: 'green', Icon: TargetIcon },
  nav: { tint: 'gray', Icon: ChevronsVerticalIcon },
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
            <iconDef.Icon size={15} />
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
