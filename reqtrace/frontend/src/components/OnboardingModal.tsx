import React, { useEffect, useState } from 'react';
import { Modal, ModalButton, modalTextStyle } from './Modal';
import { colors, radii, shadows } from '../styles/tokens';
import { BellIcon, ICON_TINTS, LockIcon, PlusIcon, StatusAlertIcon } from './icons';

// Инструкция «Как работает ReqTrace» (v1.6.5) — широкая модалка со степпером.
// Единственный носитель онбординга: сюда переехали три иллюстрации из блока
// «Начните за 3 простых шага» (SettingsPage, v1.5.7) и добавились шаги про
// фичи, появившиеся позже, — автообновление с дайджестом и экран «Тесты».
// Пополняется с каждым релизом, который меняет путь пользователя.
//
// Шаги листаются кнопками, кликом по степперу и стрелками ←/→; переключение
// мгновенное (fade при листании читается как переинициализация — отклонён
// на ревью v1.6.0). Автопоказ пользователю без проектов — см.
// onboardingAutoShow.ts; сам компонент про это ничего не знает.

const MONO = 'SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// --- Иллюстрации шагов: чистый CSS/SVG, только фирменные цвета ---

// Серая скелетон-полоска «текста».
const artBar = (width: string, background?: string): React.CSSProperties => ({
  height: '6px',
  width,
  borderRadius: '4px',
  background: background ?? 'rgba(0, 0, 0, 0.07)',
});

// Иллюстрации растягиваются на высоту общего бокса (см. рендер шага):
// картинка занимает одинаковое пространство на каждом шаге.
const artRootStyle: React.CSSProperties = {
  height: '100%',
  boxSizing: 'border-box',
  borderRadius: '10px',
  border: `1px solid ${colors.border}`,
  display: 'flex',
  flexDirection: 'column',
};

// Шаг 1: окно браузера с зелёной шапкой и адресной строкой Confluence.
const ArtConnect: React.FC = () => (
  <div style={{ ...artRootStyle, background: colors.background, overflow: 'hidden' }}>
    <div style={{
      height: '22px',
      flexShrink: 0,
      background: `linear-gradient(90deg, ${colors.greenAccent}, ${colors.greenDark})`,
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '0 10px',
    }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '5px', height: '5px', borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.65)',
        }} />
      ))}
    </div>
    <div style={{
      flex: 1, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '10px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        background: colors.white,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.pill,
        padding: '6px 12px',
        color: colors.textTertiary,
      }}>
        <LockIcon size={11} />
        <span style={{
          fontSize: '10.5px',
          color: colors.textSecondary,
          fontFamily: MONO,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          https://confluence.company.ru
        </span>
      </div>
      <span style={{ ...artBar('52%'), marginLeft: '4px' }} />
    </div>
  </div>
);

// Шаг 2: белый «лист» дерева страниц на бледно-зелёной подложке, обрезанный
// нижним краем (как будто список продолжается), с кнопкой «+» поверх.
// Строка дерева: маркер (точка статуса у первой, квадратики-листы у прочих) + текст.
const artTreeRow = (marker: React.ReactNode, width: string) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
    {marker}
    <span style={artBar(width)} />
  </div>
);

const artLeafSquare = (
  <span style={{
    width: '8px', height: '8px', borderRadius: '2.5px',
    background: 'rgba(0, 0, 0, 0.08)', flexShrink: 0,
  }} />
);

const ArtAddPage: React.FC = () => (
  <div style={{
    ...artRootStyle,
    position: 'relative',
    background: ICON_TINTS.green.bg,
    border: `1px solid ${ICON_TINTS.green.border}`,
    padding: '12px 14px 0',
    overflow: 'hidden',
  }}>
    <div style={{
      flex: 1,
      background: colors.white,
      border: `1px solid ${colors.border}`,
      borderBottom: 'none',
      borderRadius: '8px 8px 0 0',
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    }}>
      {artTreeRow(
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: colors.statusOutdated, flexShrink: 0,
        }} />,
        '46%',
      )}
      {artTreeRow(artLeafSquare, '62%')}
      {artTreeRow(artLeafSquare, '54%')}
      {artTreeRow(artLeafSquare, '66%')}
      {artTreeRow(artLeafSquare, '44%')}
    </div>
    {/* Мини-копия настоящей кнопки «Добавить страницу» из шапки дерева. */}
    <span style={{
      position: 'absolute', top: '16px', right: '18px',
      width: '26px', height: '26px', borderRadius: '10px',
      background: colors.white,
      border: `1px solid ${colors.border}`,
      color: colors.textSecondary,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: shadows.card,
    }}>
      <PlusIcon size={13} />
    </span>
  </div>
);

// Шаг 3: «требование» с зелёной подсветкой выделения и ключом теста.
const ArtLinkTest: React.FC = () => (
  <div style={{
    ...artRootStyle,
    background: colors.white,
    padding: '14px',
    justifyContent: 'center',
    gap: '10px',
  }}>
    <span style={artBar('82%')} />
    <span style={{ ...artBar('64%', colors.greenLight), height: '8px' }} />
    <span style={artBar('72%')} />
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
      <span style={{
        padding: '2px 8px', borderRadius: '5px',
        background: ICON_TINTS.green.bg,
        border: `1px solid ${ICON_TINTS.green.border}`,
        color: ICON_TINTS.green.fg,
        fontSize: '10.5px', fontWeight: 600,
        fontFamily: MONO,
      }}>
        TEST-123
      </span>
      <span style={{ color: colors.statusActive, display: 'flex' }}>
        <StatusAlertIcon kind="ok" size={14} />
      </span>
    </div>
  </div>
);

// Шаг 4: колокольчик с бейджем и строки утреннего дайджеста под ним.
const artDigestRow = (dotColor: string, width: string) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: '8px',
    background: colors.white,
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    padding: '8px 10px',
  }}>
    <span style={{
      width: '7px', height: '7px', borderRadius: '50%',
      background: dotColor, flexShrink: 0,
    }} />
    <span style={artBar(width)} />
  </div>
);

const ArtDigest: React.FC = () => (
  <div style={{
    ...artRootStyle,
    background: colors.background,
    padding: '14px',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '10px',
  }}>
    <span style={{
      position: 'relative',
      width: '30px', height: '30px', borderRadius: '10px',
      background: colors.white,
      border: `1px solid ${colors.border}`,
      color: colors.textSecondary,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: shadows.card,
    }}>
      <BellIcon size={15} />
      <span style={{
        position: 'absolute', top: '-5px', right: '-5px',
        minWidth: '14px', height: '14px', borderRadius: '7px',
        background: colors.statusOutdated, color: '#fff',
        fontSize: '9px', fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 3px', boxSizing: 'border-box',
      }}>
        2
      </span>
    </span>
    <div style={{ width: '84%', display: 'flex', flexDirection: 'column', gap: '7px' }}>
      {artDigestRow(colors.statusOutdated, '78%')}
      {artDigestRow(colors.statusActive, '58%')}
    </div>
  </div>
);

// Шаг 5: строка реверс-индекса «Тестов» — ключ и счётчики статусов его привязок.
const artCountPill = (color: string, count: number) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '1px 7px', borderRadius: radii.pill,
    background: `${color}15`, border: `1px solid ${color}33`,
    color, fontSize: '10px', fontWeight: 700,
  }}>
    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color }} />
    {count}
  </span>
);

const ArtTests: React.FC = () => (
  <div style={{
    ...artRootStyle,
    background: colors.white,
    padding: '14px',
    justifyContent: 'center',
    gap: '10px',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{
        padding: '2px 8px', borderRadius: '5px',
        background: ICON_TINTS.green.bg,
        border: `1px solid ${ICON_TINTS.green.border}`,
        color: ICON_TINTS.green.fg,
        fontSize: '10.5px', fontWeight: 600,
        fontFamily: MONO,
      }}>
        TEST-123
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
        {artCountPill(colors.statusActive, 3)}
        {artCountPill(colors.statusOutdated, 1)}
      </span>
    </div>
    <span style={artBar('74%')} />
    <span style={artBar('58%')} />
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
      <span style={{
        padding: '2px 8px', borderRadius: '5px',
        background: 'rgba(0,0,0,0.04)',
        border: `1px solid ${colors.border}`,
        color: colors.textSecondary,
        fontSize: '10.5px', fontWeight: 600,
        fontFamily: MONO,
      }}>
        TEST-207
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
        {artCountPill(colors.statusLost, 2)}
      </span>
    </div>
  </div>
);

// --- Шаги инструкции ---

const STEPS: {
  label: string;       // короткое имя в степпере
  title: string;       // заголовок шага
  paragraphs: string[];
  art: React.ReactNode;
}[] = [
  {
    label: 'Подключение',
    title: 'Подключитесь к проекту',
    paragraphs: [
      'Проект в ReqTrace — это страницы требований одного Confluence и команда, которая с ними работает. Присоединитесь к проекту коллег, указав свои логин и пароль от Confluence, — или создайте новый по адресу вашего сервера.',
      'Подключение личное: страницы проекта видят только его участники, и все обращения к Confluence идут от вашего имени. Если пароль устареет, карточка проекта и замок в дереве подскажут, что подключение пора проверить.',
    ],
    art: <ArtConnect />,
  },
  {
    label: 'Страницы',
    title: 'Добавьте страницы требований',
    paragraphs: [
      'Вставьте ссылку на страницу требований — кнопка «плюс» над деревом слева. Раздел подтянется целиком, вместе с вложенными страницами, и дерево повторит структуру Confluence.',
      'Дальше структура следит за собой сама: перемещения и новые страницы подтягиваются при синхронизации, вручную вести ничего не нужно.',
    ],
    art: <ArtAddPage />,
  },
  {
    label: 'Привязки',
    title: 'Привяжите тесты к требованиям',
    paragraphs: [
      'Выделите фрагмент требования, нажмите «Привязать тесты» и укажите ключ тест-кейса из Jira. Выделение станет привязкой — маркером, закреплённым ровно за этим местом страницы.',
      'Процент покрытия страницы виден в её шапке, а клик по привязке открывает боковую панель: цитата требования, статус и список тестов.',
    ],
    art: <ArtLinkTest />,
  },
  {
    label: 'Обновления',
    title: 'Доверьте изменения ReqTrace',
    paragraphs: [
      'Раз в день ReqTrace сам перечитывает страницы ваших проектов. Если текст под привязкой изменился, она получает статус «Требует проверки»: в панели видно, что именно поменялось, и вы решаете — подтвердить новую редакцию или обновить тесты. Если требование исчезло совсем, привязка помечается как «Утрачено».',
      'Итоги приходят утренним дайджестом в колокольчик; там же виден идущий прогон. Обновить проект вручную можно в любой момент — из меню его карточки в профиле.',
    ],
    art: <ArtDigest />,
  },
  {
    label: 'Тесты',
    title: 'Смотрите на покрытие со стороны тестов',
    paragraphs: [
      'Экран «Тесты» разворачивает картину: по каждому тест-кейсу видно, какие требования он проверяет и в каком они статусе. Так легко находить тесты, которым пора на ревизию, — например, если их требования устарели или утрачены.',
      'У каждой привязки есть постоянная ссылка — кнопка в шапке панели. Вставьте её в тест-кейс или задачу Jira, и коллеги попадут точно на нужное требование.',
    ],
    art: <ArtTests />,
  },
];

// --- Степпер: номера и имена всех шагов видны сразу, клик переходит к шагу ---

const StepperItem: React.FC<{
  index: number;
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ index, label, active, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: '8px',
      padding: '5px 10px 5px 6px', borderRadius: radii.pill,
      border: 'none', background: 'transparent',
      cursor: active ? 'default' : 'pointer',
      fontFamily: 'inherit',
      transition: 'background 0.15s',
      flexShrink: 0,
    }}
    onMouseEnter={e => {
      if (!active) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
    }}
    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
  >
    <span style={{
      width: '22px', height: '22px', borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      background: active ? colors.greenAccent : 'rgba(0,0,0,0.05)',
      color: active ? '#fff' : colors.textSecondary,
      fontSize: '11.5px', fontWeight: 700,
      transition: 'background 0.15s, color 0.15s',
    }}>
      {index + 1}
    </span>
    <span style={{
      fontSize: '13px',
      fontWeight: active ? 600 : 500,
      color: active ? colors.textPrimary : colors.textSecondary,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  </button>
);

export const OnboardingModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [step, setStep] = useState(0);
  const last = STEPS.length - 1;

  // Стрелки ←/→ листают шаги. Полей ввода в модалке нет, но на всякий случай
  // не перехватываем клавиши у интерактивных элементов вне неё.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight') setStep(s => Math.min(s + 1, last));
      if (e.key === 'ArrowLeft') setStep(s => Math.max(s - 1, 0));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [last]);

  const current = STEPS[step];

  return (
    <Modal title="Как работает ReqTrace" width="820px" onClose={onClose}>
      <div style={{
        display: 'flex', alignItems: 'center',
        marginBottom: '20px',
      }}>
        {STEPS.map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && (
              <span style={{
                flex: 1, height: '1px', background: colors.border, minWidth: '10px',
              }} />
            )}
            <StepperItem index={i} label={s.label} active={i === step} onClick={() => setStep(i)} />
          </React.Fragment>
        ))}
      </div>

      {/* Фиксированная высота: модалка не «дышит» при листании шагов с
          текстами разной длины. */}
      <div style={{ display: 'flex', gap: '24px', height: '220px', marginBottom: '20px' }}>
        <div style={{ width: '280px', flexShrink: 0 }}>
          {current.art}
        </div>
        <div className="island-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          <h3 style={{
            fontSize: '15px', fontWeight: 700, color: colors.textPrimary,
            margin: '0 0 10px',
          }}>
            {current.title}
          </h3>
          {current.paragraphs.map((p, i) => (
            <p key={i} style={{
              ...modalTextStyle,
              marginBottom: i === current.paragraphs.length - 1 ? 0 : '10px',
            }}>
              {p}
            </p>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <ModalButton
          variant="secondary"
          disabled={step === 0}
          onClick={() => setStep(s => Math.max(s - 1, 0))}
        >
          Назад
        </ModalButton>
        <span style={{ flex: 1 }} />
        <ModalButton
          variant="primary"
          onClick={() => (step === last ? onClose() : setStep(s => Math.min(s + 1, last)))}
        >
          {step === last ? 'Понятно' : 'Далее'}
        </ModalButton>
      </div>
    </Modal>
  );
};
