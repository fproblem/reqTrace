import React, { useEffect, useRef, useState } from 'react';
import { colors, radii, shadows } from '../styles/tokens';

// Кастомный выпадающий список вместо нативного <select>: нативный рисуется
// системой и выбивается из стиля приложения. Кнопка-триггер повторяет поля
// ввода (inputStyle модалок / формы дерева), список — панель с ховером в
// стиле меню карточек. Клавиатура: Enter/Space/стрелки открывают, стрелки
// ходят по пунктам, Enter выбирает, Escape закрывает только список
// (не модалку), Tab закрывает и идёт дальше.
//
// Список позиционируется absolute внутри relative-обёртки (не fixed и не
// портал): внутри контейнеров с backdrop-filter fixed отсчитывается от
// контейнера (урок v1.5.2), а absolute работает и в модалке, и в сайдбаре.

export interface SelectOption {
  value: string;
  label: string;
}

const SIZES = {
  // md — поля модалок (inputStyle SettingsPage), sm — форма в дереве страниц.
  md: { padding: '10px 14px', fontSize: '14px', radius: radii.md, optionPadding: '8px 10px', chevron: 16 },
  sm: { padding: '6px 8px', fontSize: '12px', radius: radii.sm, optionPadding: '6px 8px', chevron: 13 },
} as const;

const ChevronDown: React.FC<{ size: number; open: boolean }> = ({ size, open }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    style={{
      display: 'block', flexShrink: 0, color: colors.textTertiary,
      transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s',
    }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CheckIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: 'block', color: colors.greenDark }}
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const Select: React.FC<{
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  size?: 'md' | 'sm';
  title?: string;
  style?: React.CSSProperties;
}> = ({ value, options, onChange, size = 'md', title, style }) => {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const s = SIZES[size];
  const selected = options.find(o => o.value === value);

  // Закрытие кликом в любом месте вне компонента (как у меню карточек).
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // При открытии подсветить выбранный пункт и доскроллить список к нему.
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex(o => o.value === value);
    setHighlight(idx >= 0 ? idx : 0);
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    (listRef.current?.children[highlight] as HTMLElement | undefined)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  const choose = (idx: number) => {
    const opt = options[idx];
    if (opt) onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        // Закрыть только список: без stopPropagation document-слушатель
        // модалки закрыл бы заодно и её.
        e.stopPropagation();
        setOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setHighlight(h => Math.min(h + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlight(h => Math.max(h - 1, 0));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(highlight);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <button
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={onKeyDown}
        style={{
          width: '100%',
          padding: s.padding,
          borderRadius: s.radius,
          border: `1px solid ${open ? colors.focusBorder : colors.border}`,
          background: colors.white,
          fontSize: s.fontSize,
          fontFamily: 'inherit',
          color: colors.textPrimary,
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.borderColor = colors.borderHover; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.borderColor = colors.border; }}
        // Единый фокус полей приложения: greenDark + кольцо shadows.focusRing.
        onFocus={e => {
          e.currentTarget.style.borderColor = colors.focusBorder;
          e.currentTarget.style.boxShadow = shadows.focusRing;
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = open ? colors.focusBorder : colors.border;
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected?.label ?? ''}
        </span>
        <ChevronDown size={s.chevron} open={open} />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 20,
            background: colors.white,
            border: `1px solid ${colors.border}`,
            borderRadius: s.radius,
            boxShadow: shadows.panel,
            padding: '4px',
            maxHeight: '240px',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setHighlight(i)}
              // preventDefault: не уводить фокус с кнопки-триггера (иначе
              // мигнёт focus-рамка и сломается клавиатура после выбора).
              onMouseDown={e => e.preventDefault()}
              onClick={() => choose(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: s.optionPadding,
                borderRadius: radii.sm,
                cursor: 'pointer',
                fontSize: s.fontSize,
                color: colors.textPrimary,
                background: i === highlight ? colors.greenLight : 'transparent',
              }}
            >
              <span style={{ width: s.chevron, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                {o.value === value && <CheckIcon size={s.chevron - 2} />}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {o.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Select;
