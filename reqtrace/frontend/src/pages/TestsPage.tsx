// Экран «Тесты», ярус 1 (v1.6.1): выбор проекта. Карточки говорят на языке
// «Моих проектов» из профиля (та же стеклянная карточка, заголовок, ховер) —
// пользователь видит знакомый проект, но со сводкой покрытия; клик ведёт на
// ярус 2, к реверс-индексу тестов проекта.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ProjectTestsStats } from '../types';
import { FadeIn } from '../components/fadePresence';
import { SkeletonBar, useDelayedFlag } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import {
  ChevronRightIcon, ClipboardCheckIcon, DocumentIcon, PlusIcon,
  StatusAlertIcon,
} from '../components/icons';
import { useReviewQueue } from '../components/reviewQueue';
import { colors, radii, shadows } from '../styles/tokens';
import { IslandScreen, IslandBarTitle } from '../components/common/IslandScreen';

// Свежесть автообновления: человеческий формат «когда проверено».
export function formatCheckedAt(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return `сегодня в ${time}`;
  if (days === 1) return `вчера в ${time}`;
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} в ${time}`;
}

// Склонения счётчиков: «1 тест, 2 теста, 5 тестов».
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

// Мини-пилюля счётчика статуса — общий вид для яруса 1 и строк яруса 2.
// label — необязательная словесная подпись («19 требуют проверки»): на
// крупных карточках яруса 1 (v1.8.2) место есть, и подпись честнее голой
// цифры; строки яруса 2 остаются с компактными цифрами.
export const StatusCountPill: React.FC<{
  color: string; count: number; title: string; label?: string;
}> = ({ color, count, title, label }) => (
  <span
    title={title}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '2px 8px', borderRadius: radii.pill,
      background: `${color}15`, border: `1px solid ${color}33`,
      color, fontSize: '11px', fontWeight: 700, lineHeight: 1.5,
      flexShrink: 0,
    }}
  >
    <span style={{
      width: '7px', height: '7px', borderRadius: '50%', background: color, flexShrink: 0,
    }} />
    {count}{label ? ` ${label}` : ''}
  </span>
);

// Плашка состояния автообновления — зеркало статус-плашки подключения на
// карточках профиля (statusPlaqueStyle в SettingsPage): заливка 15, рамка 33,
// жирный 13px, иконка-кружок. flex: 1 — плашка забирает свободное место
// карточки, и низы соседок в ряду закрываются ровно (грид тянет карточки
// на одну высоту).
const freshPlaqueStyle = (color: string): React.CSSProperties => ({
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

// Скелетон карточки проекта — каркас в габаритах настоящей крупной карточки
// (шапка, три колонки цифр, плашка свежести); точные высоты придут только
// с данными, несовпадение прощает FadeIn контента.
const ProjectCardSkeleton: React.FC = () => (
  <div style={{
    background: colors.cardBgSolid,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    padding: '20px 26px',
    boxShadow: shadows.card,
    display: 'flex', flexDirection: 'column', gap: '18px',
  }}>
    <SkeletonBar width="30%" height={16} />
    <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
      <SkeletonBar width="44px" height={44} radius={14} />
      <SkeletonBar width="22%" height={22} />
      <SkeletonBar width="34%" height={14} />
      <SkeletonBar width="18%" height={14} />
    </div>
    <SkeletonBar width="100%" height={40} radius={14} />
  </div>
);

export const TestsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { start: startReviewQueue } = useReviewQueue();
  const [stats, setStats] = useState<ProjectTestsStats[] | null>(null);
  // Каркас — только если ответ не мгновенный: мигание хуже его отсутствия.
  const showSkeleton = useDelayedFlag(stats === null);

  const loadStats = useCallback(() => {
    api.getProjectsStats()
      .then(data => setStats(data))
      .catch((e: any) => {
        setStats(prev => prev ?? []);
        showToast('error', 'Не удалось загрузить сводку проектов', e.message);
      });
  }, [showToast]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Прогон завершился (событие от колокольчика) — свежесть и предупреждения
  // на карточках перечитываются сами, без перезахода на экран.
  useEffect(() => {
    const onRunFinished = () => loadStats();
    window.addEventListener('reqtrace:refresh-run-finished', onRunFinished);
    return () => window.removeEventListener('reqtrace:refresh-run-finished', onRunFinished);
  }, [loadStats]);

  // Заголовок и пояснение живут в баре-острове (v1.8.0): каркас всех экранов
  // единый — «бар + контент», как у страницы; бар стоит с первого кадра
  // настоящим, скелетоны занимают только место карточек.
  const bar = (
    <IslandBarTitle meta="Обратный взгляд на покрытие: выберите проект — внутри по каждому тесту видно, какие требования он держит и в каком они статусе.">
      Тесты
    </IslandBarTitle>
  );

  if (stats === null) {
    return (
      <IslandScreen barLeft={bar} contentMaxWidth="1060px" surface="canvas">
        {showSkeleton && (
          <FadeIn>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <ProjectCardSkeleton />
              <ProjectCardSkeleton />
            </div>
          </FadeIn>
        )}
      </IslandScreen>
    );
  }

  return (
    // Скроллит контент-остров IslandScreen (v1.8.0), main не скроллится.
    // Ширина колонки — как у яруса 2 (1060): ярусы одного экрана не должны
    // «дышать» при переходе между ними.
    <IslandScreen barLeft={bar} contentMaxWidth="1060px" surface="canvas">
      {/* Мягкое появление данных (v1.7.1): и при переходе на экран, и после
          скелетона контент проявляется теми же 160мс, что модалки. */}
      <FadeIn>
      {/* Крупные карточки во всю колонку (v1.8.2, концепт пользователя):
          прежняя сетка minmax(380) на широком экране оставляла груду пустого
          места вокруг тесных карточек. Теперь карточка — строка-сводка:
          шапка с действиями, три колонки цифр (тесты / покрытие / объём),
          плашка свежести во всю ширину. */}
      {stats.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {stats.map(s => {
            const coverage = s.highlights > 0 ? Math.round((s.covered / s.highlights) * 100) : 0;
            // Свежесть автообновления (v1.6.2): янтарь — последняя попытка
            // не удалась (VPN/сеть/креды, v1.6.4) или прогона не было дольше
            // двух суток. ⚠ Точка-индикатор у названия ОТКЛОНЕНА повторно
            // (v1.8.2, как и в v1.8.0): на профиле точка про подключение,
            // здесь читалась бы иначе — не добавлять.
            const failing = s.last_attempt_reason;
            const stale = !s.last_auto_refresh_at
              || Date.now() - new Date(s.last_auto_refresh_at).getTime() > 48 * 3600 * 1000;
            const warn = !!failing || stale;
            const plaqueColor = warn ? colors.statusOutdated : colors.statusActive;
            const labelStyle: React.CSSProperties = {
              fontSize: '12px', fontWeight: 600, color: colors.textSecondary,
            };
            return (
              <div
                key={s.project_id}
                onClick={() => navigate(`/tests/${s.project_id}`)}
                title={`Открыть тесты проекта «${s.project_name}»`}
                style={{
                  background: colors.cardBgSolid,
                  border: `1px solid ${colors.border}`,
                  borderRadius: radii.lg,
                  padding: '20px 26px',
                  boxShadow: shadows.card,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '18px',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
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
                {/* Шапка: имя + «Проверить» + шеврон. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{
                    fontSize: '20px', fontWeight: 700, color: colors.textPrimary,
                    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {s.project_name}
                  </span>
                  {s.is_demo && (
                    <span
                      title="Личный демо-проект для знакомства с ReqTrace — с Confluence не связан"
                      style={{
                        padding: '2px 8px', borderRadius: radii.pill,
                        background: 'rgba(0,0,0,0.05)', color: colors.textSecondary,
                        fontSize: '11px', fontWeight: 600, flexShrink: 0,
                      }}
                    >
                      демо
                    </span>
                  )}
                  {/* Очередь проверки — постоянное место в шапке (v1.8.2).
                      Кнопка НЕЙТРАЛЬНАЯ (ревью: янтарь — «слишком цветасто»,
                      акцент не нужен; сигнал «есть работа» несут чипы и
                      плашка) и БЕЗ шеврона (следом шеврон самой карточки).
                      При нуле — приглушена, охрана в onClick (урок v1.6.0:
                      с disabled-атрибутом не живут title и курсор).
                      stopPropagation — карточка кликабельна целиком. */}
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (s.outdated > 0) void startReviewQueue(s.project_id, s.project_name);
                    }}
                    aria-disabled={s.outdated === 0}
                    title={s.outdated > 0
                      ? 'Пройти все привязки «Требует проверки» потоком: страница за страницей, с прогрессом'
                      : 'Привязок «Требует проверки» нет — очередь проверки пуста'}
                    style={{
                      display: 'inline-flex', alignItems: 'center',
                      height: '34px', padding: '0 14px', borderRadius: radii.pill,
                      background: colors.white,
                      border: `1px solid ${colors.border}`,
                      color: s.outdated > 0 ? colors.textSecondary : colors.textTertiary,
                      fontSize: '13px', fontWeight: 600, fontFamily: 'inherit',
                      cursor: s.outdated > 0 ? 'pointer' : 'default',
                      flexShrink: 0, transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      if (s.outdated === 0) return;
                      e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                      e.currentTarget.style.borderColor = colors.borderHover;
                      e.currentTarget.style.color = colors.textPrimary;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = colors.white;
                      e.currentTarget.style.borderColor = colors.border;
                      e.currentTarget.style.color = s.outdated > 0 ? colors.textSecondary : colors.textTertiary;
                    }}
                  >
                    Очередь проверки
                  </button>
                  <ChevronRightIcon size={16} style={{ color: colors.textTertiary }} />
                </div>

                {/* Три колонки сводки: тесты / покрытие / объём — с
                    вертикальными дивайдерами. Боковые колонки РАВНЫЕ, центру
                    больше всех (ревью v1.8.2): чипы статусов обязаны
                    помещаться в одну строку. */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1.9fr 1fr',
                  columnGap: '24px',
                  alignItems: 'center',
                }}>
                  {/* Тесты — главная цифра экрана; иконка без подложки
                      (ревью v1.8.2: плитку-бейдж убрали). */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <ClipboardCheckIcon size={26} style={{ color: colors.greenDark }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                        <span style={{ fontSize: '32px', fontWeight: 700, color: colors.textPrimary, lineHeight: 1.1 }}>
                          {s.tests}
                        </span>
                        <span style={{ fontSize: '14px', color: colors.textSecondary }}>
                          {plural(s.tests, ['тест', 'теста', 'тестов'])}
                        </span>
                      </div>
                      <div style={{ fontSize: '13px', color: colors.textSecondary, marginTop: '2px' }}>
                        покрыто {s.covered} из {s.highlights}{' '}
                        {plural(s.highlights, ['привязки', 'привязок', 'привязок'])}
                      </div>
                    </div>
                  </div>

                  {/* Покрытие: шкала с процентом + пилюли всех трёх статусов
                      со словесными подписями (место есть — нулевые тоже
                      видны, ноль тут хорошая новость). */}
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: '9px', minWidth: 0,
                    borderLeft: `1px solid ${colors.border}`, paddingLeft: '24px',
                    alignSelf: 'stretch', justifyContent: 'center',
                  }}>
                    <span style={labelStyle}>Покрытие</span>
                    <div
                      title={`Доля привязок проекта, к которым привязан хотя бы один тест — ${s.covered} из ${s.highlights}`}
                      style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
                    >
                      <div style={{
                        flex: 1, height: '6px', borderRadius: radii.pill,
                        background: 'rgba(0,0,0,0.07)', overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${coverage}%`, height: '100%',
                          borderRadius: radii.pill, background: colors.greenAccent,
                        }} />
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: colors.textPrimary, flexShrink: 0 }}>
                        {coverage}%
                      </span>
                    </div>
                    {/* nowrap: чипы всегда в одну строку (ревью) — ширину
                        гарантирует широкая центральная колонка. */}
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'nowrap' }}>
                      <StatusCountPill
                        color={colors.statusActive} count={s.active} label="актуально"
                        title="Привязок в статусе «Актуально»"
                      />
                      <StatusCountPill
                        color={colors.statusOutdated} count={s.outdated}
                        label={plural(s.outdated, ['требует проверки', 'требуют проверки', 'требуют проверки'])}
                        title="Привязок в статусе «Требует проверки»"
                      />
                      <StatusCountPill
                        color={colors.statusLost} count={s.lost} label="утрачено"
                        title="Привязок в статусе «Утрачено»"
                      />
                    </div>
                  </div>

                  {/* Объём проекта в страницах (подстрока «всего в проекте»
                      убрана по ревью — смысл несёт title). */}
                  <div
                    title="Страниц в проекте всего"
                    style={{
                      display: 'flex', flexDirection: 'column', gap: '9px', minWidth: 0,
                      borderLeft: `1px solid ${colors.border}`, paddingLeft: '24px',
                      alignSelf: 'stretch', justifyContent: 'center',
                    }}
                  >
                    <span style={labelStyle}>Объём</span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                      <DocumentIcon size={16} style={{ color: colors.textSecondary, alignSelf: 'center' }} />
                      <span style={{ fontSize: '17px', fontWeight: 700, color: colors.textPrimary }}>
                        {s.pages}
                      </span>
                      <span style={{ fontSize: '13px', color: colors.textSecondary }}>
                        {plural(s.pages, ['страница', 'страницы', 'страниц'])}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Свежесть автообновления — плашкой во всю ширину (язык
                    карточек профиля): статусы экрана ровно настолько
                    актуальны, насколько свеж последний прогон. */}
                {!s.is_demo && (
                  <div
                    title={failing
                      ? `Последняя попытка обновления (${s.last_attempt_at
                          ? formatCheckedAt(s.last_attempt_at) : '—'}) не удалась — `
                        + 'показаны данные последнего успешного прогона'
                      : 'Когда автообновление в последний раз проверяло страницы проекта'}
                    style={freshPlaqueStyle(plaqueColor)}
                  >
                    <StatusAlertIcon kind={warn ? 'warning' : 'ok'} size={16} />
                    <span style={{ minWidth: 0 }}>
                      {failing
                        ? (s.last_auto_refresh_at
                          ? `${failing === 'no_valid_credentials' ? 'Нет работающих подключений' : 'Confluence недоступен'} — данные от ${formatCheckedAt(s.last_auto_refresh_at)}`
                          : `${failing === 'no_valid_credentials' ? 'Нет работающих подключений' : 'Confluence недоступен'} — страницы ещё не проверялись`)
                        : (s.last_auto_refresh_at
                          ? `Страницы проверены ${formatCheckedAt(s.last_auto_refresh_at)}`
                          : 'Автообновление ещё не проверяло проект')}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Приглашение подключить проект (концепт v1.8.2) — пунктирная карточка
          под списком; она же — пустое состояние экрана. Подключение живёт в
          профиле (личные креды), поэтому ведём туда. */}
      <div
        onClick={() => navigate('/settings')}
        title="Открыть профиль — подключение проекта (личные креды Confluence, опционально Jira) настраивается там"
        style={{
          marginTop: stats.length > 0 ? '14px' : 0,
          padding: '30px',
          border: '2px dashed rgba(0,0,0,0.12)',
          borderRadius: radii.lg,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
          cursor: 'pointer',
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'rgba(0,0,0,0.22)';
          e.currentTarget.style.background = 'rgba(255,255,255,0.55)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <PlusIcon size={20} style={{ color: colors.textTertiary }} />
        <span style={{ fontSize: '15px', fontWeight: 600, color: colors.textPrimary, marginTop: '4px' }}>
          Подключить проект
        </span>
        <span style={{ fontSize: '13px', color: colors.textSecondary }}>
          Добавьте Confluence и Jira для начала работы
        </span>
      </div>
      </FadeIn>
    </IslandScreen>
  );
};

export default TestsPage;
