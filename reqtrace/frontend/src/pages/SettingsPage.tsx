import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { Project } from '../types';
import { useToast } from '../components/Toast';
import { colors, radii, shadows } from '../styles/tokens';

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

const secondaryButtonStyle: React.CSSProperties = {
  padding: '9px 18px',
  borderRadius: radii.pill,
  border: `1px solid ${colors.border}`,
  background: 'transparent',
  color: colors.textSecondary,
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
};

const modalStyle: React.CSSProperties = {
  background: colors.white,
  borderRadius: radii.lg,
  boxShadow: shadows.card,
  padding: '24px',
  width: '440px',
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'calc(100vh - 48px)',
  overflowY: 'auto',
};

function formatCheckedAt(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// --- Модал-обёртка ---

// Портал в body обязателен: внутри карточки с backdrop-filter position:fixed
// отсчитывается от карточки (containing block), а не от вьюпорта — оверлей
// затемнял только карточку, а окно пряталось под соседними карточками.
const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title, onClose, children,
}) => createPortal(
  <div style={overlayStyle} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div style={modalStyle}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px',
      }}>
        <h2 style={{ fontSize: '17px', fontWeight: 600, color: colors.textPrimary, margin: 0 }}>
          {title}
        </h2>
        <button
          onClick={onClose}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: '16px', color: colors.textTertiary, padding: '2px 6px',
          }}
        >
          ✕
        </button>
      </div>
      {children}
    </div>
  </div>,
  document.body,
);

// --- Модал «Подключить проект»: присоединиться / создать новый ---

interface ConnectModalProps {
  available: Project[];          // чужие проекты, к которым можно присоединиться
  onClose: () => void;
  onDone: () => void;
}

const ConnectProjectModal: React.FC<ConnectModalProps> = ({ available, onClose, onDone }) => {
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

  const joinDisabled = !joinProjectId || !joinUser.trim() || !joinPass;
  const createDisabled = !name.trim() || !confUrl.trim() || !createUser.trim() || !createPass;

  return (
    <Modal title="Подключить проект" onClose={onClose}>
      <div style={{ display: 'flex', marginBottom: '18px', borderBottom: `1px solid ${colors.border}` }}>
        {tabButton('join', 'Присоединиться')}
        {tabButton('create', 'Создать новый')}
      </div>

      <form onSubmit={handleSubmit}>
        {tab === 'join' ? (
          available.length === 0 ? (
            <p style={{ fontSize: '13px', color: colors.textSecondary }}>
              Нет проектов, к которым можно присоединиться. Создайте новый на соседней вкладке.
            </p>
          ) : (
            <>
              <div style={fieldStyle}>
                <label style={labelStyle}>Проект</label>
                <select
                  value={joinProjectId}
                  onChange={e => setJoinProjectId(e.target.value)}
                  style={{ ...inputStyle, appearance: 'auto' }}
                >
                  {available.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.confluence_base_url}
                    </option>
                  ))}
                </select>
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
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>Отмена</button>
          <button
            type="submit"
            disabled={busy || (tab === 'join' ? joinDisabled : createDisabled)}
            style={{
              ...primaryButtonStyle,
              opacity: busy || (tab === 'join' ? joinDisabled : createDisabled) ? 0.5 : 1,
            }}
          >
            {busy ? 'Проверка подключения…' : tab === 'join' ? 'Присоединиться' : 'Создать проект'}
          </button>
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
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>Отмена</button>
          <button type="submit" disabled={busy || !username.trim()}
                  style={{ ...primaryButtonStyle, opacity: busy || !username.trim() ? 0.5 : 1 }}>
            {busy ? 'Проверка подключения…' : 'Сохранить'}
          </button>
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
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>Отмена</button>
          <button type="submit" disabled={busy || !name.trim()}
                  style={{ ...primaryButtonStyle, opacity: busy || !name.trim() ? 0.5 : 1 }}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
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
      <p style={{ fontSize: '14px', color: colors.textSecondary, marginTop: 0, marginBottom: '18px' }}>
        Ваши креды для проекта «{project.name}» будут удалены, его страницы исчезнут из вашего
        дерева. Сам проект, страницы и привязки останутся у других участников. Вернуться можно
        в любой момент — через «Подключить проект → Присоединиться».
      </p>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose} style={secondaryButtonStyle}>Отмена</button>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={busy}
          style={{ ...primaryButtonStyle, background: colors.statusLost, opacity: busy ? 0.5 : 1 }}
        >
          {busy ? 'Отключение…' : 'Отключиться'}
        </button>
      </div>
    </Modal>
  );
};

// --- Карточка проекта ---

const ProjectCard: React.FC<{ project: Project; onChanged: () => void }> = ({ project, onChanged }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [modal, setModal] = useState<'creds' | 'edit' | 'disconnect' | null>(null);
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

  const menuItemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '8px 14px',
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
    fontSize: '13px',
    color: colors.textPrimary,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{
      background: 'rgba(255,255,255,0.85)',
      backdropFilter: 'blur(20px)',
      border: `1px solid ${colors.border}`,
      borderRadius: radii.lg,
      padding: '18px 22px',
      marginBottom: '14px',
      boxShadow: shadows.card,
      // Каждая карточка — stacking context (backdrop-filter): без подъёма
      // открытое меню пряталось бы под следующей по DOM карточкой.
      position: 'relative',
      zIndex: menuOpen ? 20 : 'auto',
    }}>
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
          style={{ ...secondaryButtonStyle, padding: '6px 14px', fontSize: '13px', opacity: checking ? 0.6 : 1 }}
        >
          {checking ? 'Проверка…' : 'Проверить'}
        </button>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            title="Действия"
            style={{
              width: '30px', height: '30px', borderRadius: radii.sm,
              border: `1px solid ${colors.border}`, background: 'transparent',
              color: colors.textSecondary, fontSize: '16px', cursor: 'pointer',
            }}
          >
            ⋮
          </button>
          {menuOpen && (
            <div style={{
              position: 'absolute', right: 0, top: '34px', zIndex: 11,
              background: colors.white, border: `1px solid ${colors.border}`,
              borderRadius: radii.md, boxShadow: shadows.card, padding: '4px 0', minWidth: '180px',
            }}>
              <button style={menuItemStyle} onClick={() => { setMenuOpen(false); setModal('creds'); }}>
                Изменить креды
              </button>
              <button style={menuItemStyle} onClick={() => { setMenuOpen(false); setModal('edit'); }}>
                Изменить проект
              </button>
              <button
                style={{ ...menuItemStyle, color: colors.statusLost }}
                onClick={() => { setMenuOpen(false); setModal('disconnect'); }}
              >
                Отключиться
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

      {/* Статусная строка */}
      <div style={{ marginTop: '8px', fontSize: '13px' }}>
        {status === 'ok' && (
          unreachable ? (
            <span style={{ color: colors.statusOutdated }}>
              ⚠ Confluence был недоступен при проверке
              {project.last_check_at ? ` ${formatCheckedAt(project.last_check_at)}` : ''} — проверьте
              VPN или сеть
            </span>
          ) : (
            <span style={{ color: colors.statusActive }}>
              ● Подключено{project.last_check_at ? ` · проверено ${formatCheckedAt(project.last_check_at)}` : ''}
            </span>
          )
        )}
        {status === 'invalid' && (
          <span style={{ color: colors.statusLost }}>
            ✖ Нет доступа — Confluence отклонил логин/пароль.{' '}
            <button
              onClick={() => setModal('creds')}
              style={{
                border: 'none', background: 'transparent', color: colors.statusLost,
                textDecoration: 'underline', cursor: 'pointer', fontSize: '13px',
                padding: 0, fontFamily: 'inherit',
              }}
            >
              Обновить креды
            </button>
          </span>
        )}
        {status === 'unchecked' && (
          <span style={{ color: colors.textTertiary }}>○ Подключение не проверено</span>
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
    </div>
  );
};

// --- Экран настроек ---

export const SettingsPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const { showToast } = useToast();

  const load = async () => {
    try {
      setProjects(await api.listProjects());
    } catch (e: any) {
      showToast('error', 'Не удалось загрузить проекты', e.message);
    } finally {
      setLoading(false);
    }
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
    <div style={{ padding: '32px 40px', maxWidth: '700px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: colors.textPrimary, marginBottom: '8px' }}>
        Настройки
      </h1>
      <p style={{ fontSize: '14px', color: colors.textSecondary, marginBottom: '28px' }}>
        Проекты объединяют страницы одного Confluence. Каждый участник ходит в Confluence
        своими логином и паролем — они хранятся зашифрованными и никому не видны.
      </p>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px',
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: colors.textPrimary, margin: 0 }}>
          Мои проекты
        </h2>
        <button onClick={() => setShowConnect(true)} style={{ ...primaryButtonStyle, padding: '8px 18px' }}>
          + Подключить проект
        </button>
      </div>

      {joined.length === 0 ? (
        <div style={{
          background: 'rgba(255,255,255,0.85)',
          border: `1px dashed ${colors.borderHover}`,
          borderRadius: radii.lg,
          padding: '32px 24px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '14px', color: colors.textSecondary, marginBottom: '4px' }}>
            Вы пока не подключены ни к одному проекту
          </div>
          <div style={{ fontSize: '13px', color: colors.textTertiary }}>
            Подключите существующий проект своими кредами или создайте новый
          </div>
        </div>
      ) : (
        joined.map(project => (
          <ProjectCard key={project.id} project={project} onChanged={load} />
        ))
      )}

      {showConnect && (
        <ConnectProjectModal
          available={available}
          onClose={() => setShowConnect(false)}
          onDone={load}
        />
      )}
    </div>
  );
};

export default SettingsPage;
