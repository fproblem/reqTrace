// Колокольчик уведомлений (v1.6.3): бейдж непрочитанного + панель дайджестов
// ночных прогонов. Заглушка стояла в шапке с v1.6.1 — теперь она живая.
// Данные — представление журнала refresh_runs по членству (GET /notifications);
// открытие панели ставит отметку «прочитано» (бейдж гаснет, пометки «новое»
// в списке доживают до закрытия).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import {
  FinishedRunSummary, NotificationEntry, NotificationsResponse, RunningRun,
} from '../types';
import { colors, radii, shadows } from '../styles/tokens';
import { BellIcon, ClockIcon, IconBadge, IconProps, LockIcon, ShieldIcon, SyncIcon } from './icons';
import { useFadeToggle } from './fadePresence';
import { XIcon } from './Modal';
import { RefreshIcon } from './RefreshIcon';
import {
  notificationBody, notificationDayLabel, notificationLink, notificationTint,
  notificationTitle, runResultText,
} from './notificationText';

// Время записи внутри дневного блока: день называет ярлык группы,
// у самой записи остаются только часы и минуты.
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// Ночной цикл событий — бейдж меняется раз в сутки; интервал нужен только
// вкладкам-долгожителям, чтобы утренний дайджест появился без перезагрузки.
const POLL_MS = 10 * 60 * 1000;
// Живой статус прогонов (пилюля-индикатор): в покое изредка, во время
// прогона — часто, чтобы завершение и итог показались за секунды.
const STATUS_POLL_IDLE_MS = 30_000;
const STATUS_POLL_ACTIVE_MS = 5_000;
// Сколько держать итог прогона в пилюле после завершения.
const RESULT_SHOW_MS = 6_000;

// Индикатор увидит каждый участник проекта с открытым ReqTrace — появление
// и исчезновение должны быть спокойными; уважение к reduced-motion как у
// каскада дерева (TreeReveal).
const REDUCED_MOTION = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const KIND_ICONS: Record<NotificationEntry['kind'], React.FC<IconProps>> = {
  digest: SyncIcon,
  cred_invalid: LockIcon,
  run_skipped: ClockIcon,
  // Подтверждение тишины (v1.6.5): слежение живо, изменений нет.
  run_quiet: ShieldIcon,
};

export const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [open, setOpen] = useState(false);
  // Мягкое появление/гашение панели дайджеста (v1.6.6).
  const { mounted: panelMounted, fadeStyle: panelFade } = useFadeToggle(open);
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

  // Живой статус прогонов (v1.6.4): пилюля «Обновляем…» слева от колокольчика.
  // Показывает ЛЮБОЙ идущий прогон моих проектов — ночной, почасовой добор,
  // ручной (свой или коллеги), — а после завершения на несколько секунд
  // отдаёт итог, даже когда бейджу загораться не от чего («изменений нет»,
  // «Confluence недоступен»).
  const [running, setRunning] = useState<RunningRun[]>([]);
  const [result, setResult] = useState<FinishedRunSummary | null>(null);
  const runningIdsRef = useRef<string[]>([]);
  const watchedRef = useRef<Set<string>>(new Set());
  const resultTimerRef = useRef<number | undefined>(undefined);
  const lastStatusRef = useRef<React.ReactNode>(null);
  const prevFinishedRef = useRef<string | null | undefined>(undefined);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.getRefreshStatus();
      const ids = s.running.map(r => r.id);
      ids.forEach(id => watchedRef.current.add(id));
      const finished = s.last_finished ?? null;
      // Переход «крутилось → закончилось». Молниеносный прогон (мгновенная
      // ошибка сети) мог не попасть ни в один опрос running — его ловим по
      // смене «последнего завершённого» (undefined = первый опрос, база).
      const watchedDone = runningIdsRef.current.some(id => !ids.includes(id));
      const lastChanged = prevFinishedRef.current !== undefined
        && finished !== null && finished.id !== prevFinishedRef.current;
      if (watchedDone || lastChanged) {
        void load();
        // Карточки профиля и «Тестов» перечитывают свои данные сами — статус
        // подключений и свежесть не должны отставать от уведомления.
        window.dispatchEvent(new Event('reqtrace:refresh-run-finished'));
        if (finished && (lastChanged || watchedRef.current.has(finished.id))) {
          setResult(finished);
          window.clearTimeout(resultTimerRef.current);
          resultTimerRef.current = window.setTimeout(() => setResult(null), RESULT_SHOW_MS);
        }
      }
      prevFinishedRef.current = finished ? finished.id : null;
      runningIdsRef.current = ids;
      setRunning(s.running);
    } catch {
      // Индикатор не шумит: сетевые сбои молча, 401 обработает AuthContext.
    }
  }, [load]);

  useEffect(() => {
    void loadStatus();
    const timer = setInterval(
      () => { void loadStatus(); },
      running.length > 0 ? STATUS_POLL_ACTIVE_MS : STATUS_POLL_IDLE_MS,
    );
    return () => clearInterval(timer);
  }, [loadStatus, running.length]);

  useEffect(() => () => window.clearTimeout(resultTimerRef.current), []);

  // Ручной прогон (v1.6.4): после «Обновить страницы сейчас» с карточки
  // проекта опрашиваем чаще, чтобы готовый дайджест пришёл за секунды.
  const fastUntilRef = useRef(0);
  useEffect(() => {
    const onManualRun = () => {
      fastUntilRef.current = Date.now() + 20 * 60 * 1000;
      void load();
      void loadStatus();
    };
    window.addEventListener('reqtrace:refresh-run', onManualRun);
    return () => window.removeEventListener('reqtrace:refresh-run', onManualRun);
  }, [load, loadStatus]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() < fastUntilRef.current) void load();
    }, 20_000);
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

  // Группировка списка по дням (v1.7.2): события одного дня — один блок,
  // между блоками дивайдер — приём «Истории изменений», где так отделяются
  // версии. Записи приходят отсортированными по времени, поэтому достаточно
  // склеивать соседей с одинаковым ярлыком дня.
  const dayGroups: { label: string; entries: NotificationEntry[] }[] = [];
  for (const e of data?.entries ?? []) {
    const label = notificationDayLabel(e.happened_at);
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.label === label) last.entries.push(e);
    else dayGroups.push({ label, entries: [e] });
  }
  const badgeColor = unseenEntries.some(e => notificationTint(e) === 'red')
    ? colors.statusLost
    : colors.statusOutdated;

  const resultInfo = result ? runResultText(result) : null;
  const statusVisible = running.length > 0 || resultInfo !== null;

  // Содержимое статуса запоминается: при сворачивании старый текст должен
  // спокойно погаснуть под закрывающейся шириной, а не исчезнуть скачком,
  // оставив капсулу схлопываться пустой.
  const statusContent = running.length > 0 ? (
    <>
      <RefreshIcon size={14} spinning />
      <span style={{
        fontSize: '12px', fontWeight: 500,
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {running.length === 1
          ? `Обновляем «${running[0].project_name}»…`
          : `Обновляем проекты: ${running.length}…`}
      </span>
    </>
  ) : resultInfo ? (
    <span style={{
      fontSize: '12px', fontWeight: 600,
      overflow: 'hidden', textOverflow: 'ellipsis',
      color: resultInfo.tone === 'warn' ? colors.statusOutdated
        : resultInfo.tone === 'ok' ? colors.statusActive
        : colors.textSecondary,
    }}>
      {resultInfo.text}
    </span>
  ) : null;
  if (statusContent !== null) {
    lastStatusRef.current = statusContent;
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      {/* Одна кнопка-капсула: статус прогона раскрывает КОЛОКОЛЬЧИК влево —
          происходящее принадлежит дайджесту, а не выглядит отдельным
          случайным уведомлением. В покое капсула сложена в квадрат 34px,
          неотличимый от прежней кнопки. */}
      <button
        onClick={toggle}
        title={running.length > 0
          ? 'Идёт прогон обновления — открыть уведомления'
          : resultInfo
            ? 'Итог прогона — открыть уведомления'
            : 'Уведомления: дайджест обновлений ваших проектов'}
        aria-expanded={open}
        style={{
          height: '34px', padding: '0 8px', boxSizing: 'border-box',
          borderRadius: radii.md,
          border: `1px solid ${open ? 'rgba(122, 224, 90, 0.55)' : colors.border}`,
          background: open ? colors.greenLight : colors.white,
          color: open ? colors.greenDark : colors.textSecondary,
          cursor: 'pointer', fontFamily: 'inherit',
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
        {/* Спокойное раскрытие: grid-колонка 0fr↔1fr (как TreeReveal в
            дереве, только горизонтально) анимируется ровно к фактической
            ширине содержимого — без обрыва движения, который давал max-width.
            Текст проявляется чуть позже ширины, а гаснуть начинает первым. */}
        <span style={{
          display: 'grid',
          gridTemplateColumns: statusVisible ? '1fr' : '0fr',
          transition: REDUCED_MOTION ? undefined : 'grid-template-columns 0.5s ease-in-out',
        }}>
          <span style={{
            overflow: 'hidden', minWidth: 0,
            display: 'flex', alignItems: 'center',
          }}>
            <span style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              paddingRight: '8px', whiteSpace: 'nowrap', maxWidth: '240px',
              opacity: statusVisible ? 1 : 0,
              transition: REDUCED_MOTION ? undefined
                : statusVisible
                  ? 'opacity 0.3s ease 0.15s'
                  : 'opacity 0.25s ease',
            }}>
              {statusContent ?? lastStatusRef.current}
            </span>
          </span>
        </span>
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

      {panelMounted && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: '400px', maxHeight: '520px',
            display: 'flex', flexDirection: 'column',
            // Скроллится только список ниже шапки — как в модалках (Modal,
            // «История изменений»): скроллбар на самой панели вылезал сбоку
            // от скруглённого угла и увозил заголовок вместе со списком.
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)',
            border: `1px solid ${colors.border}`, borderRadius: radii.lg,
            boxShadow: shadows.cardHover,
            boxSizing: 'border-box',
            zIndex: 30,
            ...panelFade,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '8px',
            padding: '16px 16px 10px 20px',
            borderBottom: `1px solid ${colors.border}`,
            flexShrink: 0,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: colors.textPrimary }}>
                Уведомления
              </div>
              <div style={{ fontSize: '12px', color: colors.textTertiary, marginTop: '2px' }}>
                Дайджест обновлений ваших проектов
              </div>
            </div>
            {/* Крестик закрытия — хороший тон всех модалок ReqTrace. */}
            <button
              onClick={() => setOpen(false)}
              title="Закрыть"
              style={{
                width: '28px', height: '28px', padding: 0,
                border: 'none', borderRadius: radii.sm,
                background: 'transparent', color: colors.textTertiary,
                cursor: 'pointer', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(0,0,0,0.05)';
                e.currentTarget.style.color = colors.textPrimary;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = colors.textTertiary;
              }}
            >
              <XIcon />
            </button>
          </div>

          {/* Скролл-зона списка: minHeight 0 разрешает флекс-ребёнку ужаться
              под maxHeight панели, прежние отступы панели (10px) переехали
              сюда. */}
          <div style={{ overflowY: 'auto', minHeight: 0, padding: '6px 10px 10px' }}>
          {data === null ? (
            <div style={{ padding: '16px 10px', fontSize: '13px', color: colors.textSecondary }}>
              Загрузка…
            </div>
          ) : data.entries.length === 0 ? (
            <div style={{
              padding: '16px 10px', fontSize: '13px',
              color: colors.textSecondary, lineHeight: 1.55,
            }}>
              {/* Тишина теперь видима строкой-подтверждением (v1.6.5) —
                  сюда попадают только те, по чьим проектам прогонов ещё
                  не было вовсе. */}
              Плановые прогоны ещё не отчитывались по вашим проектам.
              Как только первый пройдёт, его итог появится здесь
            </div>
          ) : (
            dayGroups.map((group, gi) => (
              <div
                key={group.label}
                style={gi > 0 ? {
                  borderTop: `1px solid ${colors.border}`,
                  marginTop: '8px',
                  paddingTop: '8px',
                } : undefined}
              >
                <div style={{
                  padding: '4px 10px 2px',
                  fontSize: '11px', fontWeight: 600,
                  color: colors.textTertiary,
                }}>
                  {group.label}
                </div>
                {group.entries.map(entry => {
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
                        {timeOf(entry.happened_at)}
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
                })}
              </div>
            ))
          )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
