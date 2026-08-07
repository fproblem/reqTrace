// Шпаргалка горячих клавиш (бэклог «UX-пакет»): клавиши в ReqTrace жили и
// раньше (стрелки, Escape, циклы по чипам), но были невидимы — карточка по
// «?» делает их находимыми. Открытие — глобальный слушатель в Layout.
import React from 'react';
import { Modal } from './Modal';
import { colors, radii } from '../styles/tokens';

const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

/** Клавиша-«кейкап»: тихая пилюля с рамкой, как у счётчиков-пилюль. */
const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{
    display: 'inline-block',
    padding: '2px 7px',
    borderRadius: radii.sm,
    border: `1px solid ${colors.border}`,
    background: 'rgba(0,0,0,0.03)',
    color: colors.textSecondary,
    fontSize: '11px',
    fontWeight: 600,
    lineHeight: 1.5,
    whiteSpace: 'nowrap',
  }}>
    {children}
  </span>
);

interface HotkeyRow {
  keys: string[];
  text: string;
}

interface HotkeySection {
  title: string;
  rows: HotkeyRow[];
}

const SECTIONS: HotkeySection[] = [
  {
    title: 'Где угодно',
    rows: [
      { keys: [IS_MAC ? '⌘K' : 'Ctrl+K'], text: 'Глобальный поиск: страницы, тесты, проекты' },
      { keys: ['?'], text: 'Эта шпаргалка' },
      { keys: ['Esc'], text: 'Закрыть окно, меню или панель' },
    ],
  },
  {
    title: 'Страница требований',
    rows: [
      { keys: ['↑', '↓'], text: 'Листать привязки в порядке текста на странице' },
      { keys: ['Enter'], text: 'Привязать введённый тест (курсор в поле ключа)' },
      { keys: ['Esc'], text: 'Закрыть панель привязки; непустое поле теста первая Esc только очищает' },
    ],
  },
];

export const HotkeysModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  if (!open) return null;
  return (
    <Modal title="Горячие клавиши" width="480px" onClose={onClose}>
      {SECTIONS.map(section => (
        <div key={section.title} style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: colors.textTertiary,
            marginBottom: '8px',
          }}>
            {section.title}
          </div>
          {section.rows.map(row => (
            <div
              key={row.text}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '10px',
                padding: '5px 0',
              }}
            >
              {/* Колонка клавиш фиксированной ширины — описания стоят ровно. */}
              <span style={{ display: 'flex', gap: '4px', width: '86px', flexShrink: 0, justifyContent: 'flex-end' }}>
                {row.keys.map(k => <Kbd key={k}>{k}</Kbd>)}
              </span>
              <span style={{ fontSize: '13px', lineHeight: 1.45, color: colors.textSecondary }}>
                {row.text}
              </span>
            </div>
          ))}
        </div>
      ))}
      {/* Не-клавишные циклы — мышью, но о них тоже никто не знал. */}
      <div style={{
        fontSize: '12px',
        lineHeight: 1.5,
        color: colors.textTertiary,
        borderTop: `1px solid ${colors.border}`,
        paddingTop: '12px',
      }}>
        Подсказка: клик по цветной шапке карточки привязки ведёт к следующей
        привязке того же статуса по кругу — удобно обходить только «Требует
        проверки» в день актуализации.
      </div>
    </Modal>
  );
};
