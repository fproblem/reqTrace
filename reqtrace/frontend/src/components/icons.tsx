import React from 'react';

/** Общая библиотека SVG-иконок приложения (feather-стиль).
 *
 * Все иконки: viewBox 24×24, обводка currentColor — цвет задаётся через
 * `color` родителя (или style), размер — пропом `size`, толщина —
 * `strokeWidth`. Набор появился вместе с новой «Историей изменений»
 * (v1.5.6), но предназначен для переиспользования в любом месте
 * интерфейса — берите отсюда, прежде чем рисовать новую.
 *
 * Иконки с собственным поведением живут отдельно: RefreshIcon (вращение
 * с докруткой), XIcon в Modal (исторически фиксированные 16px).
 *
 * Визуальная галерея всех иконок — frontend/docs/icons.html (самодостаточный
 * html, открывается из файловой системы; пополнили набор — добавьте и туда).
 */

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  style?: React.CSSProperties;
}

function makeIcon(content: React.ReactNode): React.FC<IconProps> {
  return ({ size = 16, strokeWidth = 2, style }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {content}
    </svg>
  );
}

// --- Действия ---

export const PencilIcon = makeIcon(<>
  <path d="M12 20h9" />
  <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
</>);

export const PlusIcon = makeIcon(<>
  <line x1="12" y1="5" x2="12" y2="19" />
  <line x1="5" y1="12" x2="19" y2="12" />
</>);

export const CrossIcon = makeIcon(<>
  <line x1="18" y1="6" x2="6" y2="18" />
  <line x1="6" y1="6" x2="18" y2="18" />
</>);

export const TrashIcon = makeIcon(<>
  <path d="M3 6h18" />
  <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
</>);

export const SearchIcon = makeIcon(<>
  <circle cx="11" cy="11" r="7" />
  <line x1="21" y1="21" x2="16.5" y2="16.5" />
</>);

export const SyncIcon = makeIcon(<>
  <path d="M23 4v6h-6" />
  <path d="M1 20v-6h6" />
  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
</>);

// --- Навигация ---

export const ChevronRightIcon = makeIcon(
  <path d="M9 5.3L15.7 12 9 18.7" />
);

export const ChevronsVerticalIcon = makeIcon(<>
  <path d="M7 8l5-5 5 5" />
  <path d="M7 16l5 5 5-5" />
</>);

export const TargetIcon = makeIcon(<>
  <circle cx="12" cy="12" r="9" />
  <circle cx="12" cy="12" r="3.5" />
</>);

// --- Объекты интерфейса ---

export const PanelIcon = makeIcon(<>
  <rect x="3" y="4" width="18" height="16" rx="2" />
  <line x1="15" y1="4" x2="15" y2="20" />
</>);

export const LayoutIcon = makeIcon(<>
  <rect x="3" y="4" width="18" height="16" rx="2" />
  <line x1="3" y1="9" x2="21" y2="9" />
</>);

export const TableIcon = makeIcon(<>
  <rect x="3" y="4" width="18" height="16" rx="2" />
  <line x1="3" y1="10" x2="21" y2="10" />
  <line x1="12" y1="10" x2="12" y2="20" />
</>);

export const KeyboardIcon = makeIcon(<>
  <rect x="2.5" y="6" width="19" height="12" rx="2" />
  <line x1="7" y1="14.5" x2="17" y2="14.5" />
  <line x1="6.5" y1="10" x2="6.51" y2="10" />
  <line x1="10.2" y1="10" x2="10.21" y2="10" />
  <line x1="13.8" y1="10" x2="13.81" y2="10" />
  <line x1="17.5" y1="10" x2="17.51" y2="10" />
</>);

export const DocumentIcon = makeIcon(<>
  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
  <path d="M14 2v6h6" />
</>);

export const ImageIcon = makeIcon(<>
  <rect x="3" y="3" width="18" height="18" rx="2" />
  <circle cx="8.5" cy="8.5" r="1.5" />
  <path d="M21 15l-5-5L5 21" />
</>);

export const BranchIcon = makeIcon(<>
  <line x1="6" y1="3" x2="6" y2="15" />
  <circle cx="18" cy="6" r="3" />
  <circle cx="6" cy="18" r="3" />
  <path d="M18 9a9 9 0 01-9 9" />
</>);

export const LinkIcon = makeIcon(<>
  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
</>);

// --- Статусы и сущности ---

export const BellIcon = makeIcon(<>
  <path d="M18 8a6 6 0 00-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
  <path d="M13.7 20a2 2 0 01-3.4 0" />
</>);

export const ClockIcon = makeIcon(<>
  <circle cx="12" cy="12" r="9" />
  <path d="M12 7v5l3 2" />
</>);

export const FlagIcon = makeIcon(<>
  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
  <line x1="4" y1="22" x2="4" y2="15" />
</>);

export const GearIcon = makeIcon(<>
  <circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 010-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
</>);

export const LockIcon = makeIcon(<>
  <rect x="4" y="11" width="16" height="10" rx="2" />
  <path d="M8 11V7a4 4 0 018 0v4" />
</>);

export const ShieldIcon = makeIcon(
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
);

export const UserIcon = makeIcon(<>
  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
  <circle cx="12" cy="7" r="4" />
</>);

export const DropletIcon = makeIcon(
  <path d="M12 2.7s6.5 7 6.5 11.3a6.5 6.5 0 11-13 0C5.5 9.7 12 2.7 12 2.7z" />
);

export const SparkleIcon = makeIcon(
  <path d="M12 3l2.1 5.9L20 11l-5.9 2.1L12 19l-2.1-5.9L4 11l5.9-2.1L12 3z" />
);
