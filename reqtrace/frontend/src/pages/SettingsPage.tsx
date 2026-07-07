import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Project } from '../types';
import { Modal, ModalButton, modalTextStyle } from '../components/Modal';
import { RefreshIcon } from '../components/RefreshIcon';
import { Select } from '../components/Select';
import { useToast } from '../components/Toast';
import { useTreeRefresh } from '../hooks/useTreeRefresh';
import { useAuth } from '../auth/AuthContext';
import {
  ICON_TINTS,
  LockIcon,
  PlusIcon,
  SparkleIcon,
  StatusAlertIcon,
} from '../components/icons';
import { colors, radii, shadows } from '../styles/tokens';
import { normalizeBaseUrl } from '../utils/baseUrl';

// --- Общие стили форм и модалок ---

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: radii.md,
  border: `1px solid ${colors.border}`,
  fontSize: '14px',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  background: colors.white,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 500,
  color: colors.textSecondary,
  marginBottom: '6px',
};

const fieldStyle: React.CSSProperties = { marginBottom: '14px' };

// --- Онбординг пустого состояния: три шага до первого покрытого требования ---
// Показывается только пока пользователь не подключён ни к одному проекту.
// У каждого шага — мини-иллюстрация сути действия (чистый CSS/SVG, фирменные
// зелёный и серый): окно браузера с адресом Confluence, список страниц с «+»,
// выделенное «требование» с ключом теста.

// Серая скелетон-полоска «текста».
const artBar = (width: string, background?: string): React.CSSProperties => ({
  height: '6px',
  width,
  borderRadius: '4px',
  background: background ?? 'rgba(0, 0, 0, 0.07)',
});

// Все три иллюстрации растягиваются на высоту общего бокса (см. рендер):
// картинки занимают одинаковое пространство в каждой карточке.
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
      height: '18px',
      flexShrink: 0,
      background: `linear-gradient(90deg, ${colors.greenAccent}, ${colors.greenDark})`,
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '0 8px',
    }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '5px', height: '5px', borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.65)',
        }} />
      ))}
    </div>
    <div style={{
      flex: 1, padding: '9px 10px',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        background: colors.white,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.pill,
        padding: '5px 10px',
        color: colors.textTertiary,
      }}>
        <LockIcon size={11} />
        <span style={{
          fontSize: '10.5px',
          color: colors.textSecondary,
          fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          https://confluence.company.ru
        </span>
      </div>
      <span style={{ ...artBar('52%'), marginLeft: '4px' }} />
    </div>
  </div>
);

// Шаг 2: дерево страниц (скелетон) с зелёной кнопкой «+».
const ArtAddPage: React.FC = () => (
  <div style={{
    ...artRootStyle,
    position: 'relative',
    background: colors.white,
    padding: '12px',
    justifyContent: 'center',
    gap: '8px',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: colors.greenAccent, flexShrink: 0,
      }} />
      <span style={artBar('58%')} />
    </div>
    <div style={{ display: 'flex', gap: '6px', paddingLeft: '12px' }}>
      <span style={artBar('64%')} />
    </div>
    <div style={{ display: 'flex', gap: '6px', paddingLeft: '12px' }}>
      <span style={artBar('48%')} />
    </div>
    <div style={{ display: 'flex', gap: '6px', paddingLeft: '12px' }}>
      <span style={artBar('56%')} />
    </div>
    <span style={{
      position: 'absolute', top: '10px', right: '10px',
      width: '24px', height: '24px', borderRadius: '50%',
      background: colors.greenAccent, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <PlusIcon size={13} strokeWidth={2.6} />
    </span>
  </div>
);

// Шаг 3: «требование» с зелёной подсветкой выделения и ключом теста.
const ArtLinkTest: React.FC = () => (
  <div style={{
    ...artRootStyle,
    background: colors.white,
    padding: '12px',
    justifyContent: 'center',
    gap: '8px',
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
        fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      }}>
        SI-1284
      </span>
      <span style={{ color: colors.statusActive, display: 'flex' }}>
        <StatusAlertIcon kind="ok" size={14} />
      </span>
    </div>
  </div>
);

const ONBOARDING_STEPS: {
  title: string;
  text: string;
  art: React.ReactNode;
}[] = [
  {
    title: 'Подключите проект',
    text: 'Адрес Confluence и ваши рабочие логин/пароль: присоединитесь к существующему проекту команды или создайте новый.',
    art: <ArtConnect />,
  },
  {
    title: 'Добавьте страницу',
    text: 'Вставьте ссылку на страницу требований — кнопка «+» над деревом слева. Раздел подтянется целиком.',
    art: <ArtAddPage />,
  },
  {
    title: 'Привяжите тесты',
    text: 'Выделите фрагмент требования и укажите ключ теста из Jira. ReqTrace проследит, чтобы покрытие не устаревало.',
    art: <ArtLinkTest />,
  },
];

// Плашка статуса подключения — один в один со статус-плашкой привязки в
// панели выделения (SidePanel): заливка 8%, рамка 20%, жирный 13px, иконка
// StatusAlertIcon. Цвет — hex из tokens, суффиксы 15/33 — hex-альфа.
const statusPlaqueStyle = (color: string): React.CSSProperties => ({
  // Заполняет обёртку целиком: у соседних карточек одной высоты плашки
  // тоже выходят одной высоты, даже если текст в одной из них длиннее.
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px 12px',
  borderRadius: radii.md,
  background: `${color}15`,
  border: `1px solid ${color}33`,
  color,
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: 1.35,
});

const primaryButtonStyle: React.CSSProperties = {
  padding: '9px 22px',
  borderRadius: radii.pill,
  border: 'none',
  background: colors.greenAccent,
  color: '#fff',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

// Кнопки-иконки — один в один с кнопками верхнего бара страницы (PageDetailPage):
// 34×34, рамка, hover перекрашивает фон/рамку/иконку, «нажатое» = открытое меню.
const iconButtonStyle: React.CSSProperties = {
  width: '34px',
  height: '34px',
  borderRadius: radii.md,
  border: `1px solid ${colors.border}`,
  background: colors.white,
  color: colors.textSecondary,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'all 0.15s',
};

const iconButtonHoverOn = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
  e.currentTarget.style.borderColor = colors.borderHover;
  e.currentTarget.style.color = colors.textPrimary;
};

const iconButtonHoverOff = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = colors.white;
  e.currentTarget.style.borderColor = colors.border;
  e.currentTarget.style.color = colors.textSecondary;
};

// --- Иконки (feather-стиль, повторяют иконки верхнего бара страницы) ---

const featherProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

// Та же иконка, что у меню «⋮» страницы.
const DotsIcon: React.FC = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}>
    <circle cx="12" cy="5" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="12" cy="19" r="1.6" />
  </svg>
);

const KeyIcon: React.FC = () => (
  <svg {...featherProps} style={{ display: 'block', flexShrink: 0, color: colors.textSecondary }}>
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

const PencilIcon: React.FC = () => (
  <svg {...featherProps} style={{ display: 'block', flexShrink: 0, color: colors.textSecondary }}>
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);

const LogoutIcon: React.FC = () => (
  <svg {...featherProps} style={{ display: 'block', flexShrink: 0 }}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

// Та же корзина, что у «Удалить» в меню действий страницы.
const TrashIcon: React.FC = () => (
  <svg {...featherProps} style={{ display: 'block', flexShrink: 0 }}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

function formatCheckedAt(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// --- Модал «Подключить проект»: присоединиться / создать новый ---

interface ConnectModalProps {
  available: Project[];          // чужие проекты, к которым можно присоединиться
  existing: Project[];           // все проекты — для предупреждения о дубле Confluence URL
  onClose: () => void;
  onDone: () => void;
}

const ConnectProjectModal: React.FC<ConnectModalProps> = ({ available, existing, onClose, onDone }) => {
  const [tab, setTab] = useState<'join' | 'create'>(available.length > 0 ? 'join' : 'create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  // «Присоединиться»
  const [joinProjectId, setJoinProjectId] = useState(available[0]?.id || '');
  const [joinUser, setJoinUser] = useState('');
  const [joinPass, setJoinPass] = useState('');

  // «Создать новый»
  const [name, setName] = useState('');
  const [confUrl, setConfUrl] = useState('');
  const [jiraUrl, setJiraUrl] = useState('');
  const [createUser, setCreateUser] = useState('');
  const [createPass, setCreatePass] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (tab === 'join') {
        const project = available.find(p => p.id === joinProjectId);
        await api.saveProjectCredentials(joinProjectId, {
          confluence_username: joinUser.trim(),
          confluence_password: joinPass,
        });
        showToast('success', 'Проект подключён', `Вы присоединились к проекту «${project?.name ?? ''}»`);
      } else {
        const created = await api.createProject({
          name: name.trim(),
          confluence_base_url: confUrl.trim(),
          jira_base_url: jiraUrl.trim() || undefined,
          confluence_username: createUser.trim(),
          confluence_password: createPass,
        });
        showToast('success', 'Проект создан', `Проект «${created.name}» подключён, креды проверены`);
      }
      onDone();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Не удалось подключить проект');
    } finally {
      setBusy(false);
    }
  };

  const tabButton = (key: 'join' | 'create', label: string): React.ReactNode => (
    <button
      type="button"
      onClick={() => { setTab(key); setError(''); }}
      style={{
        flex: 1,
        padding: '8px 0',
        border: 'none',
        borderBottom: tab === key ? `2px solid ${colors.greenDark}` : '2px solid transparent',
        background: 'transparent',
        color: tab === key ? colors.textPrimary : colors.textSecondary,
        fontSize: '14px',
        fontWeight: tab === key ? 600 : 400,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );

  // Дубль Confluence URL запрещён (бэкенд ответит 409): проекты-двойники вели
  // бы одинаковые страницы с раздельным покрытием. Подсказка и блокировка
  // кнопки — ещё до сабмита.
  const normalizedNewUrl = normalizeBaseUrl(confUrl);
  const sameServer = normalizedNewUrl
    ? existing.filter(p => normalizeBaseUrl(p.confluence_base_url) === normalizedNewUrl)
    : [];

  const joinDisabled = !joinProjectId || !joinUser.trim() || !joinPass;
  const createDisabled = !name.trim() || !confUrl.trim() || !createUser.trim() || !createPass
    || sameServer.length > 0;

  return (
    <Modal title="Подключить проект" onClose={onClose}>
      <div style={{ display: 'flex', marginBottom: '18px', borderBottom: `1px solid ${colors.border}` }}>
        {tabButton('join', 'Присоединиться')}
        {tabButton('create', 'Создать новый')}
      </div>

      <form onSubmit={handleSubmit}>
        {tab === 'join' ? (
          available.length === 0 ? (
            <p style={modalTextStyle}>
              Нет проектов, к которым можно присоединиться. Создайте новый на соседней вкладке.
            </p>
          ) : (
            <>
              <div style={fieldStyle}>
                <label style={labelStyle}>Проект</label>
                <Select
                  value={joinProjectId}
                  onChange={setJoinProjectId}
                  options={available.map(p => ({
                    value: p.id,
                    label: `${p.name} — ${p.confluence_base_url}`,
                  }))}
                />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Логин Confluence</label>
                <input type="text" value={joinUser} onChange={e => setJoinUser(e.target.value)}
                       placeholder="i.ivanov" autoFocus style={inputStyle} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Пароль Confluence</label>
                <input type="password" value={joinPass} onChange={e => setJoinPass(e.target.value)}
                       placeholder="password" style={inputStyle} />
                <div style={{ fontSize: '12px', color: colors.textTertiary, marginTop: '4px' }}>
                  Подключение проверяется сразу — присоединиться без работающих кред нельзя
                </div>
              </div>
            </>
          )
        ) : (
          <>
            <div style={fieldStyle}>
              <label style={labelStyle}>Название проекта</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                     placeholder="Банк X" autoFocus style={inputStyle} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Confluence URL</label>
              <input type="text" value={confUrl} onChange={e => setConfUrl(e.target.value)}
                     placeholder="https://confluence.company.com" style={inputStyle} />
              {sameServer.length > 0 && (
                <div style={{ fontSize: '12px', color: colors.statusLost, marginTop: '4px', lineHeight: 1.5 }}>
                  Этот Confluence уже подключён: {sameServer.map(p => `«${p.name}»`).join(', ')}.
                  Создать проект-дубль нельзя — присоединитесь к существующему на вкладке «Присоединиться»
                </div>
              )}
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>
                Jira URL <span style={{ fontWeight: 400, color: colors.textTertiary }}>(необязательно)</span>
              </label>
              <input type="text" value={jiraUrl} onChange={e => setJiraUrl(e.target.value)}
                     placeholder="https://jira.company.com" style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', ...fieldStyle }}>
              <div>
                <label style={labelStyle}>Мой логин</label>
                <input type="text" value={createUser} onChange={e => setCreateUser(e.target.value)}
                       placeholder="i.ivanov" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Мой пароль</label>
                <input type="password" value={createPass} onChange={e => setCreatePass(e.target.value)}
                       placeholder="password" style={inputStyle} />
              </div>
            </div>
          </>
        )}

        {error && (
          <div style={{ color: colors.statusLost, fontSize: '13px', marginBottom: '12px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <ModalButton type="button" onClick={onClose}>Отмена</ModalButton>
          <ModalButton
            type="submit"
            variant="primary"
            disabled={busy || (tab === 'join' ? joinDisabled : createDisabled)}
          >
            {busy ? 'Проверка подключения…' : tab === 'join' ? 'Присоединиться' : 'Создать проект'}
          </ModalButton>
        </div>
      </form>
    </Modal>
  );
};

// --- Модал «Изменить креды» ---

const CredsModal: React.FC<{ project: Project; onClose: () => void; onDone: () => void }> = ({
  project, onClose, onDone,
}) => {
  const [username, setUsername] = useState(project.my_username || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.saveProjectCredentials(project.id, {
        confluence_username: username.trim(),
        confluence_password: password || undefined,
      });
      showToast('success', 'Креды обновлены', `Подключение к «${project.name}» проверено`);
      onDone();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Не удалось сохранить креды');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Креды — ${project.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Логин Confluence</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                 autoFocus style={inputStyle} />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>
            Пароль
            {project.my_status === 'invalid' ? (
              <span style={{ color: colors.statusLost, fontWeight: 400, marginLeft: '8px' }}>
                (установлен, но подключение не работает)
              </span>
            ) : (
              <span style={{ color: colors.statusActive, fontWeight: 400, marginLeft: '8px' }}>
                (установлен)
              </span>
            )}
          </label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                 placeholder="••••••••" style={inputStyle} />
          <div style={{ fontSize: '12px', color: colors.textTertiary, marginTop: '4px' }}>
            Оставьте пустым, чтобы сохранить текущий пароль
          </div>
        </div>

        {error && (
          <div style={{ color: colors.statusLost, fontSize: '13px', marginBottom: '12px' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <ModalButton type="button" onClick={onClose}>Отмена</ModalButton>
          <ModalButton type="submit" variant="primary" disabled={busy || !username.trim()}>
            {busy ? 'Проверка подключения…' : 'Сохранить'}
          </ModalButton>
        </div>
      </form>
    </Modal>
  );
};

// --- Модал «Изменить проект» (имя / Jira URL) ---

const EditProjectModal: React.FC<{ project: Project; onClose: () => void; onDone: () => void }> = ({
  project, onClose, onDone,
}) => {
  const [name, setName] = useState(project.name);
  const [jiraUrl, setJiraUrl] = useState(project.jira_base_url || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.updateProject(project.id, { name: name.trim(), jira_base_url: jiraUrl.trim() });
      showToast('success', 'Проект обновлён');
      onDone();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Не удалось сохранить проект');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Проект — ${project.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Название</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus style={inputStyle} />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Jira URL</label>
          <input type="text" value={jiraUrl} onChange={e => setJiraUrl(e.target.value)}
                 placeholder="https://jira.company.com" style={inputStyle} />
          <div style={{ fontSize: '12px', color: colors.textTertiary, marginTop: '4px' }}>
            Общий для всех участников проекта; из него строятся ссылки на тест-кейсы
          </div>
        </div>

        {error && (
          <div style={{ color: colors.statusLost, fontSize: '13px', marginBottom: '12px' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <ModalButton type="button" onClick={onClose}>Отмена</ModalButton>
          <ModalButton type="submit" variant="primary" disabled={busy || !name.trim()}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </ModalButton>
        </div>
      </form>
    </Modal>
  );
};

// --- Модал подтверждения отключения ---

const DisconnectModal: React.FC<{ project: Project; onClose: () => void; onDone: () => void }> = ({
  project, onClose, onDone,
}) => {
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await api.disconnectProject(project.id);
      showToast('success', 'Вы отключились от проекта', `Проект «${project.name}» больше не виден в дереве`);
      onDone();
      onClose();
    } catch (e: any) {
      showToast('error', 'Не удалось отключиться', e.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Отключиться от проекта?" onClose={onClose}>
      <p style={{ ...modalTextStyle, marginBottom: '18px' }}>
        Ваши креды для проекта «{project.name}» будут удалены, его страницы исчезнут из вашего
        дерева. Сам проект, страницы и привязки останутся у других участников. Вернуться можно
        в любой момент: «Подключить проект», вкладка «Присоединиться».
      </p>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <ModalButton type="button" onClick={onClose}>Отмена</ModalButton>
        <ModalButton type="button" variant="danger" onClick={handleDisconnect} disabled={busy}>
          {busy ? 'Отключение…' : 'Отключиться'}
        </ModalButton>
      </div>
    </Modal>
  );
};

// --- Модал удаления проекта (подтверждение словом, как у удаления страницы) ---

const DeleteProjectModal: React.FC<{ project: Project; onClose: () => void; onDone: () => void }> = ({
  project, onClose, onDone,
}) => {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const confirmed = confirmText === 'Удалить';

  const handleDelete = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      await api.deleteProject(project.id);
      showToast('success', 'Проект удалён', `Проект «${project.name}» и все его страницы удалены у всех участников`);
      onDone();
      onClose();
    } catch (e: any) {
      showToast('error', 'Не удалось удалить проект', e.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Удаление проекта" onClose={onClose}>
      <p style={{ ...modalTextStyle, marginBottom: '6px' }}>
        Вы собираетесь удалить проект <strong style={{ color: colors.textPrimary }}>«{project.name}»</strong>{' '}
        целиком — у всех участников. Это действие необратимо: все страницы проекта, их снимки,
        baseline и привязки к тестам будут удалены. Если хотите убрать проект только у себя —
        используйте «Отключиться».
      </p>
      <p style={{ ...modalTextStyle, marginBottom: '16px' }}>
        Для подтверждения введите слово <strong style={{ color: colors.statusLost }}>Удалить</strong>
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={e => setConfirmText(e.target.value)}
        placeholder="Введите «Удалить»"
        autoFocus
        style={{
          ...inputStyle,
          border: `1.5px solid ${confirmed ? colors.statusLost : colors.border}`,
          transition: 'border-color 0.15s',
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && confirmed) handleDelete();
        }}
      />
      <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
        <ModalButton type="button" onClick={onClose}>Отмена</ModalButton>
        <ModalButton type="button" variant="danger" onClick={handleDelete} disabled={!confirmed || busy}>
          {busy ? 'Удаление…' : 'Удалить проект'}
        </ModalButton>
      </div>
    </Modal>
  );
};

// --- Карточка проекта ---

const ProjectCard: React.FC<{ project: Project; onChanged: () => void }> = ({ project, onChanged }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [modal, setModal] = useState<'creds' | 'edit' | 'disconnect' | 'delete' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  // Меню закрывается кликом в любом месте документа. Fixed-«ловец кликов»
  // внутри карточки не работает: backdrop-filter делает карточку containing
  // block для position:fixed, и ловец покрывал только саму карточку.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const status = project.my_status;
  // Сервер был недоступен при последней проверке — креды не виноваты, но и не
  // подтверждены: жёлтая индикация вместо зелёного «Подключено».
  const unreachable = status === 'ok' && project.my_last_check_result === 'unreachable';
  const statusColor = status === 'invalid' ? colors.statusLost
    : unreachable ? colors.statusOutdated
    : status === 'ok' ? colors.statusActive
    : colors.textTertiary;

  const handleCheck = async () => {
    setChecking(true);
    try {
      const result = await api.checkProjectCredentials(project.id);
      if (result.status === 'ok') {
        showToast('success', 'Подключение работает', `Confluence принял ваши креды для «${project.name}»`);
      } else {
        showToast('error', 'Нет доступа', `Confluence отклонил ваши логин/пароль для «${project.name}»`);
      }
      onChanged();
    } catch (e: any) {
      if (e?.status === 502) {
        // Недоступность сервера — не ошибка кред и не поломка reqtrace:
        // некритичное жёлтое предупреждение вместо красной ошибки.
        showToast('warning', 'Confluence недоступен', e.message);
      } else {
        showToast('error', 'Не удалось проверить подключение', e.message);
      }
      // Неудачная попытка тоже фиксируется на бэке (unreachable) — подтянуть её на карточку.
      onChanged();
    } finally {
      setChecking(false);
    }
  };

  // Пункты меню — как в меню действий страницы (иконка + текст, скругление, ховер).
  const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '9px 10px',
    border: 'none',
    background: 'transparent',
    color: colors.textPrimary,
    fontSize: '13px',
    fontWeight: 500,
    fontFamily: 'inherit',
    textAlign: 'left',
    borderRadius: radii.sm,
    cursor: 'pointer',
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(20px)',
        border: `1px solid ${colors.border}`,
        borderRadius: radii.lg,
        padding: '18px 22px',
        boxShadow: shadows.card,
        // Колонка: грид тянет соседние карточки на одну высоту, а свободное
        // место внутри забирает статус-плашка (flex: 1 у её обёртки) — плашки
        // соседних карточек выравниваются по высоте, ряд закрывается ровно.
        display: 'flex',
        flexDirection: 'column',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        // Каждая карточка — stacking context (backdrop-filter): без подъёма
        // открытое меню пряталось бы под следующей по DOM карточкой.
        position: 'relative',
        zIndex: menuOpen ? 20 : 'auto',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = colors.borderHover;
        e.currentTarget.style.boxShadow = shadows.cardHover;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.boxShadow = shadows.card;
      }}
    >
      {/* Заголовок карточки: индикатор + имя + действия */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{
          width: '9px', height: '9px', borderRadius: '50%',
          background: statusColor, flexShrink: 0,
        }} />
        <span style={{
          fontSize: '16px', fontWeight: 600, color: colors.textPrimary,
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {project.name}
        </span>
        <button
          onClick={handleCheck}
          disabled={checking}
          title="Проверить подключение к Confluence"
          style={{
            ...iconButtonStyle,
            width: 'auto',
            padding: '0 12px',
            gap: '8px',
            fontSize: '13px',
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: checking ? 'default' : 'pointer',
          }}
          onMouseEnter={e => { if (!checking) iconButtonHoverOn(e); }}
          onMouseLeave={iconButtonHoverOff}
        >
          <RefreshIcon spinning={checking} />
          Проверить
        </button>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            title="Действия"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={{
              ...iconButtonStyle,
              border: `1px solid ${menuOpen ? colors.borderHover : colors.border}`,
              background: menuOpen ? 'rgba(0,0,0,0.03)' : colors.white,
              color: menuOpen ? colors.textPrimary : colors.textSecondary,
            }}
            onMouseEnter={e => { if (!menuOpen) iconButtonHoverOn(e); }}
            onMouseLeave={e => { if (!menuOpen) iconButtonHoverOff(e); }}
          >
            <DotsIcon />
          </button>
          {menuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 11,
                minWidth: '212px', padding: '6px',
                background: colors.cardBgSolid, border: `1px solid ${colors.border}`,
                borderRadius: radii.md, boxShadow: shadows.panel,
                display: 'flex', flexDirection: 'column', gap: '2px',
              }}
            >
              <button
                role="menuitem"
                style={menuItemStyle}
                onClick={() => { setMenuOpen(false); setModal('creds'); }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <KeyIcon />
                Изменить креды
              </button>
              <button
                role="menuitem"
                style={menuItemStyle}
                onClick={() => { setMenuOpen(false); setModal('edit'); }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <PencilIcon />
                Изменить проект
              </button>
              <button
                role="menuitem"
                style={{ ...menuItemStyle, color: colors.statusLost }}
                onClick={() => { setMenuOpen(false); setModal('disconnect'); }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <LogoutIcon />
                Отключиться
              </button>
              <button
                role="menuitem"
                title="Удалить проект со всеми страницами и привязками — у всех участников, необратимо"
                style={{ ...menuItemStyle, color: colors.statusLost }}
                onClick={() => { setMenuOpen(false); setModal('delete'); }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <TrashIcon />
                Удалить проект
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Детали */}
      <div style={{ marginTop: '10px', fontSize: '13px', color: colors.textSecondary, lineHeight: 1.7 }}>
        <div>Confluence: {project.confluence_base_url}</div>
        {project.jira_base_url && <div>Jira: {project.jira_base_url}</div>}
        <div>
          Мой логин: {project.my_username}
          <span style={{ color: colors.textTertiary }}> · пароль (установлен)</span>
        </div>
      </div>

      {/* Статус подключения — алерт-плашка, как статус привязки в панели
          выделения: единая стилистика статусов на разных экранах. Плашка
          «нет доступа» кликабельна и ведёт к обновлению кред (шеврон-намёк). */}
      <div style={{ flex: 1, display: 'flex', marginTop: '12px' }}>
        {status === 'ok' && !unreachable && (
          <div style={statusPlaqueStyle(colors.statusActive)}>
            <StatusAlertIcon kind="ok" />
            <span style={{ minWidth: 0 }}>
              Подключено{project.last_check_at ? ` · проверено ${formatCheckedAt(project.last_check_at)}` : ''}
            </span>
          </div>
        )}
        {status === 'ok' && unreachable && (
          <div style={statusPlaqueStyle(colors.statusOutdated)}>
            <StatusAlertIcon kind="warning" />
            <span style={{ minWidth: 0 }}>
              Confluence был недоступен
              {project.last_check_at ? ` при проверке ${formatCheckedAt(project.last_check_at)}` : ''} —
              проверьте VPN или сеть
            </span>
          </div>
        )}
        {status === 'invalid' && (
          <button
            onClick={() => setModal('creds')}
            title="Открыть обновление кред"
            style={{
              ...statusPlaqueStyle(colors.statusLost),
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${colors.statusLost}26`; }}
            onMouseLeave={e => { e.currentTarget.style.background = `${colors.statusLost}15`; }}
            onMouseDown={e => { e.currentTarget.style.background = `${colors.statusLost}33`; }}
            onMouseUp={e => { e.currentTarget.style.background = `${colors.statusLost}26`; }}
          >
            <StatusAlertIcon kind="error" />
            <span style={{ minWidth: 0 }}>Нет доступа — Confluence отклонил логин/пароль</span>
            <span style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '12px', fontWeight: 500, opacity: 0.85, flexShrink: 0,
            }}>
              Обновить креды
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth={2.2}
                strokeLinecap="round" strokeLinejoin="round"
                style={{ display: 'block' }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          </button>
        )}
        {status === 'unchecked' && (
          <div style={statusPlaqueStyle(colors.textTertiary)}>
            <svg width={16} height={16} viewBox="0 0 24 24" style={{ display: 'block', flexShrink: 0 }}>
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth={2} />
            </svg>
            Подключение не проверено
          </div>
        )}
      </div>

      {modal === 'creds' && (
        <CredsModal project={project} onClose={() => setModal(null)} onDone={onChanged} />
      )}
      {modal === 'edit' && (
        <EditProjectModal project={project} onClose={() => setModal(null)} onDone={onChanged} />
      )}
      {modal === 'disconnect' && (
        <DisconnectModal project={project} onClose={() => setModal(null)} onDone={onChanged} />
      )}
      {modal === 'delete' && (
        <DeleteProjectModal project={project} onClose={() => setModal(null)} onDone={onChanged} />
      )}
    </div>
  );
};

// --- Экран настроек ---

export const SettingsPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const { showToast } = useToast();
  const { refreshTree } = useTreeRefresh();
  const { user } = useAuth();

  const load = async () => {
    try {
      setProjects(await api.listProjects());
    } catch (e: any) {
      showToast('error', 'Не удалось загрузить проекты', e.message);
    } finally {
      setLoading(false);
    }
  };

  // Любое изменение проектов (подключение, креды, переименование, отключение,
  // удаление, результат проверки) меняет и дерево страниц в сайдбаре —
  // обновляем его сразу, не дожидаясь смены маршрута.
  const handleProjectsChanged = () => {
    void load();
    refreshTree();
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: colors.textSecondary }}>
        Загрузка...
      </div>
    );
  }

  const joined = projects.filter(p => p.joined);
  const available = projects.filter(p => !p.joined);

  return (
    <div style={{ padding: '32px 40px', maxWidth: '960px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: colors.textPrimary, marginBottom: '16px' }}>
        Профиль и проекты
      </h1>

      {/* Карточка профиля: экран называется «Профиль и проекты» — профиль
          должен быть виден первым. Данные сессии Google (имя, почта, аватар). */}
      {user && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          background: colors.cardBg,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.lg,
          padding: '16px 20px',
          marginBottom: '28px',
        }}>
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              referrerPolicy="no-referrer"
              style={{
                width: '44px', height: '44px', borderRadius: '50%',
                display: 'block', flexShrink: 0,
                border: `1px solid ${colors.border}`,
              }}
            />
          ) : (
            <span style={{
              width: '44px', height: '44px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, background: colors.greenLight,
              color: colors.greenDark, fontSize: '18px', fontWeight: 700,
            }}>
              {(user.name || '?').charAt(0).toUpperCase()}
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '15px', fontWeight: 700, color: colors.textPrimary,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user.name}
            </div>
            {user.email && (
              <div style={{
                fontSize: '13px', color: colors.textSecondary, marginTop: '2px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {user.email}
              </div>
            )}
          </div>
          <span style={{
            marginLeft: 'auto', flexShrink: 0,
            fontSize: '12px', color: colors.textTertiary,
          }}>
            Вход через Google
          </span>
        </div>
      )}

      {/* Заголовок секции с подводкой слева и действием справа: подводка
          прижата к своему разделу, а не болтается под заголовком страницы. */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: '16px', marginBottom: '16px',
      }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: colors.textPrimary, margin: 0 }}>
            Мои проекты
          </h2>
          <p style={{ fontSize: '13px', color: colors.textSecondary, margin: '4px 0 0' }}>
            Проект объединяет страницы одного Confluence. В него вы ходите своими логином
            и паролем — они хранятся зашифрованными и никому не видны.
          </p>
        </div>
        <button
          onClick={() => setShowConnect(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '9px 20px', borderRadius: radii.pill, border: 'none',
            background: colors.greenAccent, color: '#fff',
            fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit', flexShrink: 0,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = colors.greenDark; }}
          onMouseLeave={e => { e.currentTarget.style.background = colors.greenAccent; }}
          onMouseDown={e => { e.currentTarget.style.background = '#3F9E27'; }}
          onMouseUp={e => { e.currentTarget.style.background = colors.greenDark; }}
        >
          <PlusIcon size={15} strokeWidth={2.4} />
          Подключить проект
        </button>
      </div>

      {joined.length === 0 ? (
        /* Онбординг пустого состояния. Кнопок здесь сознательно нет
           («Подключить проект» уже над разделом, демо — в пустом дереве);
           крестика-закрытия тоже: блок и есть пустое состояние раздела,
           прятать его некуда. */
        <div style={{
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(20px)',
          border: `1px solid ${colors.border}`,
          borderRadius: radii.lg,
          boxShadow: shadows.card,
          padding: '24px 26px',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            marginBottom: '4px', color: colors.greenDark,
          }}>
            <SparkleIcon size={18} />
            <span style={{ fontSize: '16px', fontWeight: 700, color: colors.textPrimary }}>
              Начните за 3 простых шага
            </span>
          </div>
          <div style={{ fontSize: '13px', color: colors.textSecondary, marginBottom: '18px' }}>
            Мы поможем быстро настроить отслеживание покрытия требований тестами.
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '14px',
          }}>
            {ONBOARDING_STEPS.map((step, i) => (
              <div key={step.title} style={{
                background: colors.white,
                border: `1px solid ${colors.border}`,
                borderRadius: radii.md,
                padding: '18px 20px 16px',
                display: 'flex',
                flexDirection: 'column',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '9px',
                }}>
                  <span style={{
                    width: '24px', height: '24px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, background: ICON_TINTS.green.bg,
                    color: ICON_TINTS.green.fg, fontSize: '12.5px', fontWeight: 700,
                  }}>
                    {i + 1}
                  </span>
                  <span style={{
                    fontSize: '14.5px', fontWeight: 600, color: colors.textPrimary,
                    lineHeight: 1.4,
                  }}>
                    {step.title}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: colors.textSecondary, lineHeight: 1.55 }}>
                  {step.text}
                </div>
                {/* Иллюстрация прижата к низу, а её бокс фиксированной высоты:
                    картинки во всех трёх карточках занимают одинаковое
                    пространство и заканчиваются в одну линию. */}
                <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                  <div style={{ height: '96px' }}>
                    {step.art}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          // auto-fill вместо жёстких двух колонок: на узком окне карточки
          // складываются в одну колонку, не сжимаясь до нечитаемых.
          gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
          gap: '14px',
        }}>
          {joined.map(project => (
            <ProjectCard key={project.id} project={project} onChanged={handleProjectsChanged} />
          ))}
        </div>
      )}

      {showConnect && (
        <ConnectProjectModal
          available={available}
          existing={projects}
          onClose={() => setShowConnect(false)}
          onDone={handleProjectsChanged}
        />
      )}
    </div>
  );
};

export default SettingsPage;
