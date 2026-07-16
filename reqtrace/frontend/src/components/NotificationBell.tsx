// Колокольчик уведомлений (v1.6.3): бейдж непрочитанного + панель дайджестов
// ночных прогонов. Заглушка стояла в шапке с v1.6.1 — теперь она живая.
// Данные — представление журнала refresh_runs по членству (GET /notifications);
// открытие панели ставит отметку «прочитано» (бейдж гаснет, пометки «новое»
// в списке доживают до закрытия).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { NotificationEntry, NotificationsResponse } from '../types';
import { colors, radii, shadows } from '../styles/tokens';
import { BellIcon, ClockIcon, IconBadge, IconProps, LockIcon, SyncIcon } from './icons';
import { formatCheckedAt } from '../pages/TestsPage';
import {
  notificationBody, notificationLink, notificationTint, notificationTitle,
} from './notificationText';

// Ночной цикл событий — бейдж меняется раз в сутки; интервал нужен только
// вкладкам-долгожителям, чтобы утренний дайджест появился без перезагрузки.
const POLL_MS = 10 * 60 * 1000;

const KIND_ICONS: Record<NotificationEntry['kind'], React.FC<IconProps>> = {
  digest: SyncIcon,
  cred_invalid: LockIcon,
  run_skipped: ClockIcon,
};

export const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getNotifications());
    } catch {
      // Колокольчик не шумит тостами: сетевая ошибка здесь не мешает работе,
      // а 401 и так обрабатывается глобально (AuthContext).
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Закрытие кликом мимо (паттерн меню карточки проекта) и по Escape.
  // role="menu" на панели — слоистая Escape-логика приложения (SidePanel и др.)
  // уступает обработку верхнему слою.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    void load().then(() => {
      // Показали панель — всё до этого момента прочитано. Флаги unseen из
      // только что полученного ответа остаются для пометок «новое».
      api.markNotificationsSeen()
        .then(() => setData(d => (d ? { ...d, unseen_count: 0 } : d)))
        .catch(() => {});
    });
  };

  const unseenEntries = data?.entries.filter(e => e.unseen) ?? [];
  const badgeCount = data?.unseen_count ?? 0;
  const badgeColor = unseenEntries.some(e => notificationTint(e) === 'red')
    ? colors.statusLost
    : colors.statusOutdated;

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={toggle}
        title="Уведомления: дайджест ночных обновлений"
        aria-expanded={open}
        style={{
          width: '34px', height: '34px', padding: 0,
          borderRadius: radii.md,
          border: `1px solid ${open ? 'rgba(122, 224, 90, 0.55)' : colors.border}`,
          background: open ? colors.greenLight : colors.white,
          color: open ? colors.greenDark : colors.textSecondary,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          if (open) return;
          e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
          e.currentTarget.style.borderColor = colors.borderHover;
          e.currentTarget.style.color = colors.textPrimary;
        }}
        onMouseLeave={e => {
          if (open) return;
          e.currentTarget.style.background = colors.white;
          e.currentTarget.style.borderColor = colors.border;
          e.currentTarget.style.color = colors.textSecondary;
        }}
      >
        <BellIcon size={16} />
        {badgeCount > 0 && (
          <span style={{
            position: 'absolute', top: '-5px', right: '-5px',
            minWidth: '16px', height: '16px', padding: '0 4px',
            borderRadius: radii.pill,
            background: badgeColor,
            border: '2px solid #fff',
            color: '#fff', fontSize: '10px', fontWeight: 700, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxSizing: 'border-box',
          }}>
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: '400px', maxHeight: '520px', overflowY: 'auto',
            background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)',
            border: `1px solid ${colors.border}`, borderRadius: radii.lg,
            boxShadow: shadows.cardHover,
            padding: '10px', boxSizing: 'border-box',
            zIndex: 30,
          }}
        >
          <div style={{
            padding: '6px 10px 10px',
            borderBottom: `1px solid ${colors.border}`,
            marginBottom: '6px',
          }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: colors.textPrimary }}>
              Уведомления
            </div>
            <div style={{ fontSize: '12px', color: colors.textTertiary, marginTop: '2px' }}>
              Дайджест ночных обновлений ваших проектов
            </div>
          </div>

          {data === null ? (
            <div style={{ padding: '16px 10px', fontSize: '13px', color: colors.textSecondary }}>
              Загрузка…
            </div>
          ) : data.entries.length === 0 ? (
            <div style={{
              padding: '16px 10px', fontSize: '13px',
              color: colors.textSecondary, lineHeight: 1.55,
            }}>
              Пока тихо: ночные прогоны не находили изменений в ваших проектах.
              Когда требования изменятся, дайджест появится здесь
            </div>
          ) : (
            data.entries.map(entry => {
              const Icon = KIND_ICONS[entry.kind];
              return (
                <button
                  key={entry.id}
                  role="menuitem"
                  onClick={() => { setOpen(false); navigate(notificationLink(entry)); }}
                  title="Открыть"
                  style={{
                    display: 'flex', gap: '12px', alignItems: 'flex-start',
                    width: '100%', padding: '10px',
                    border: 'none', background: 'transparent',
                    borderRadius: radii.md, cursor: 'pointer',
                    fontFamily: 'inherit', textAlign: 'left',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <IconBadge tint={notificationTint(entry)} size={30} radius={10}>
                    <Icon size={14} />
                  </IconBadge>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                      {entry.unseen && (
                        <span
                          title="Новое с прошлого визита"
                          style={{
                            width: '7px', height: '7px', borderRadius: '50%',
                            background: colors.greenAccent, flexShrink: 0,
                            alignSelf: 'center',
                          }}
                        />
                      )}
                      <span style={{
                        fontSize: '13px', fontWeight: 600, color: colors.textPrimary,
                        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {notificationTitle(entry)}
                      </span>
                      <span style={{
                        marginLeft: 'auto', flexShrink: 0,
                        fontSize: '11px', color: colors.textTertiary,
                      }}>
                        {formatCheckedAt(entry.happened_at)}
                      </span>
                    </div>
                    <div style={{
                      fontSize: '12px', color: colors.textSecondary,
                      lineHeight: 1.5, marginTop: '2px',
                    }}>
                      {notificationBody(entry)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
