import React, { useEffect, useState } from 'react';
import { Modal, ModalButton, modalTextStyle } from './Modal';
import { colors, radii, shadows } from '../styles/tokens';
import {
  BellIcon, ICON_TINTS, KeyboardIcon, LockIcon, PlusIcon, SearchIcon, StatusAlertIcon,
} from './icons';

// Инструкция «Как работает ReqTrace» (v1.6.5) — широкая модалка со степпером.
// Единственный носитель онбординга: сюда переехали три иллюстрации из блока
// «Начните за 3 простых шага» (SettingsPage, v1.5.7) и добавились шаги про
// фичи, появившиеся позже, — автообновление с дайджестом и экран «Тесты».
// Пополняется с каждым релизом, который меняет путь пользователя;
// актуализация v1.8.2: добавление страниц — из меню карточки проекта,
// «Тесты» — карточки-сводки + очередь проверки + CSV, новый шаг «Поиск»
// (⌘K, «Недавнее», шпаргалка «?», воронка дерева).
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

// Шаг 2: карточка проекта с кнопкой «⋮» и раскрытым меню — первый пункт
// («Добавить страницу», с плюсом) подсвечен. Добавление живёт в меню
// карточки проекта с v1.8.1 — прежняя иллюстрация с «плюсом» над деревом
// показывала кнопку, которой больше нет.
const artLeafSquare = (
  <span style={{
    width: '8px', height: '8px', borderRadius: '2.5px',
    background: 'rgba(0, 0, 0, 0.08)', flexShrink: 0,
  }} />
);

const artMenuRow = (icon: React.ReactNode, width: string, highlighted?: boolean) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: '7px',
    padding: '6px 8px', borderRadius: '6px',
    background: highlighted ? 'rgba(0,0,0,0.04)' : 'transparent',
  }}>
    {icon}
    <span style={artBar(width)} />
  </div>
);

const ArtAddPage: React.FC = () => (
  <div style={{
    ...artRootStyle,
    position: 'relative',
    background: ICON_TINTS.green.bg,
    border: `1px solid ${ICON_TINTS.green.border}`,
    padding: '14px 16px',
    overflow: 'hidden',
  }}>
    {/* Карточка проекта: точка подключения + название + кнопка «⋮». */}
    <div style={{
      background: colors.white,
      border: `1px solid ${colors.border}`,
      borderRadius: '10px',
      boxShadow: shadows.card,
      padding: '10px 12px',
      display: 'flex', alignItems: 'center', gap: '8px',
    }}>
      <span style={{
        width: '7px', height: '7px', borderRadius: '50%',
        background: colors.statusActive, flexShrink: 0,
      }} />
      <span style={artBar('42%')} />
      <span style={{
        marginLeft: 'auto',
        width: '24px', height: '24px', borderRadius: '8px',
        border: `1px solid ${colors.borderHover}`,
        background: 'rgba(0,0,0,0.03)',
        color: colors.textSecondary,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '2px',
      }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: '2.5px', height: '2.5px', borderRadius: '50%',
            background: 'currentColor',
          }} />
        ))}
      </span>
    </div>
    {/* Вторая карточка — «призрак» у нижнего края (обрезана overflow):
        заполняет низ и читается как продолжение списка проектов. */}
    <div style={{
      position: 'absolute', left: '16px', right: '16px', bottom: '-26px',
      background: colors.white,
      border: `1px solid ${colors.border}`,
      borderRadius: '10px',
      padding: '10px 12px',
      display: 'flex', alignItems: 'center', gap: '8px',
      opacity: 0.55,
    }}>
      <span style={{
        width: '7px', height: '7px', borderRadius: '50%',
        background: 'rgba(0,0,0,0.12)', flexShrink: 0,
      }} />
      <span style={artBar('34%')} />
    </div>
    {/* Меню карточки — повисло под кнопкой «⋮», первый пункт «Добавить
        страницу» подсвечен. Абсолютная привязка к правому краю: меню
        визуально принадлежит кнопке. */}
    <div style={{
      position: 'absolute', top: '62px', right: '24px', width: '62%',
      background: colors.white,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      boxShadow: shadows.panel,
      padding: '5px',
      display: 'flex', flexDirection: 'column', gap: '2px',
    }}>
      {artMenuRow(
        <span style={{ color: colors.textSecondary, display: 'flex' }}><PlusIcon size={12} /></span>,
        '58%',
        true,
      )}
      {artMenuRow(artLeafSquare, '46%')}
      {artMenuRow(artLeafSquare, '52%')}
    </div>
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

// Шаг 6: палитра глобального поиска ⌘K — поле с лупой, подсказка-сочетание,
// выдача с подсвеченной строкой.
const artPaletteRow = (marker: React.ReactNode, width: string, highlighted?: boolean) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: '7px',
    padding: '6px 8px', borderRadius: '6px',
    background: highlighted ? colors.greenLight : 'transparent',
  }}>
    {marker}
    <span style={artBar(width)} />
  </div>
);

const ArtSearch: React.FC = () => (
  <div style={{
    ...artRootStyle,
    background: colors.background,
    padding: '14px 16px',
    justifyContent: 'center',
  }}>
    <div style={{
      background: colors.white,
      border: `1px solid ${colors.border}`,
      borderRadius: '10px',
      boxShadow: shadows.panel,
      padding: '8px',
      display: 'flex', flexDirection: 'column', gap: '4px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '7px',
        padding: '4px 8px 8px',
        borderBottom: `1px solid ${colors.border}`,
        color: colors.textTertiary,
      }}>
        <SearchIcon size={12} />
        <span style={artBar('34%')} />
        <span style={{
          marginLeft: 'auto',
          fontFamily: MONO, fontSize: '9.5px', fontWeight: 600,
          color: colors.textTertiary,
          border: `1px solid ${colors.border}`, borderRadius: '5px',
          padding: '1px 5px',
        }}>
          ⌘K
        </span>
      </div>
      {artPaletteRow(
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: colors.greenAccent, flexShrink: 0,
        }} />,
        '62%',
        true,
      )}
      {artPaletteRow(artLeafSquare, '48%')}
      {artPaletteRow(artLeafSquare, '56%')}
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
      'Откройте меню карточки проекта в профиле и выберите «Добавить страницу» (пока страниц нет, та же кнопка есть прямо на стартовом экране). Вставьте ссылку — раздел подтянется целиком, вместе с вложенными страницами, и дерево слева повторит структуру Confluence.',
      'Дальше структура следит за собой сама: перемещения и новые страницы подтягиваются при синхронизации, вручную вести ничего не нужно.',
    ],
    art: <ArtAddPage />,
  },
  {
    label: 'Привязки',
    title: 'Привяжите тесты к требованиям',
    paragraphs: [
      'Выделите фрагмент требования, нажмите «Привязать тесты» и укажите ключ тест-кейса из Jira. Выделение станет привязкой — маркером, закреплённым ровно за этим местом страницы.',
      'Процент покрытия страницы виден в её шапке, а клик по привязке открывает боковую панель: цитата требования, статус и список тестов. У каждой привязки есть постоянная ссылка — кнопка в шапке панели: вставьте её в тест-кейс, и коллеги попадут точно на нужное требование.',
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
      'Экран «Тесты» встречает карточками-сводками проектов: сколько тестов, какая доля привязок покрыта, статусы и объём в страницах. Кнопка «Очередь проверки» на карточке проведёт по всем привязкам «Требует проверки» потоком — страница за страницей, с прогрессом.',
      'Внутри проекта по каждому тест-кейсу видно, какие требования он проверяет и в каком они статусе, а кнопка «CSV» выгружает срез покрытия файлом — с выбором статусов и диффом изменившихся цитат, для Excel или внешних систем.',
    ],
    art: <ArtTests />,
  },
  {
    label: 'Поиск',
    title: 'Перемещайтесь мгновенно',
    paragraphs: [
      'Сочетание ⌘K (Ctrl+K на Windows) открывает глобальный поиск: страницы по названию, тесты по ключу и названию из Jira, проекты. Пустая строка показывает «Недавнее» — вчерашняя работа продолжается двумя нажатиями, а дерево само раскрывается на выбранной странице.',
      'Клавиши работают повсюду: стрелки листают привязки, Esc закрывает панель, а «?» показывает шпаргалку всех сочетаний. Дерево фильтруется кнопкой-воронкой — оставьте только страницы с «Требует проверки» или «Утрачено».',
    ],
    art: <ArtSearch />,
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
        {/* Тихая подсказка про шпаргалку клавиш (ревью v1.8.2): видна на
            каждом шаге, а не только в тексте шага «Поиск». Про «закройте
            окно» — честно: поверх диалогов «?» сознательно не работает. */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          marginLeft: '6px',
          color: colors.textTertiary, fontSize: '12px',
        }}>
          <KeyboardIcon size={14} />
          Шпаргалка клавиш — по нажатию «?» (когда это окно закрыто)
        </span>
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
