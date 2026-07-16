// Экран «Тесты», ярус 1 (v1.6.1): выбор проекта. Карточки говорят на языке
// «Моих проектов» из профиля (та же стеклянная карточка, заголовок, ховер) —
// пользователь видит знакомый проект, но со сводкой покрытия; клик ведёт на
// ярус 2, к реверс-индексу тестов проекта.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ProjectTestsStats } from '../types';
import { useToast } from '../components/Toast';
import { ChevronRightIcon, ClipboardCheckIcon } from '../components/icons';
import { colors, radii, shadows } from '../styles/tokens';

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
export const StatusCountPill: React.FC<{ color: string; count: number; title: string }> = ({
  color, count, title,
}) => (
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
    {count}
  </span>
);

export const TestsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [stats, setStats] = useState<ProjectTestsStats[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getProjectsStats()
      .then(data => { if (!cancelled) setStats(data); })
      .catch((e: any) => {
        if (!cancelled) {
          setStats([]);
          showToast('error', 'Не удалось загрузить сводку проектов', e.message);
        }
      });
    return () => { cancelled = true; };
  }, [showToast]);

  if (stats === null) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: colors.textSecondary }}>
        Загрузка...
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '960px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: colors.textPrimary, marginBottom: '6px' }}>
        Тесты
      </h1>
      <p style={{ fontSize: '13px', color: colors.textSecondary, margin: '0 0 20px', lineHeight: 1.5 }}>
        Обратный взгляд на покрытие: выберите проект — внутри по каждому тесту
        видно, какие требования он держит и в каком они статусе.
      </p>

      {stats.length === 0 ? (
        <div style={{
          padding: '28px', borderRadius: radii.lg,
          border: `1px solid ${colors.border}`, background: 'rgba(255,255,255,0.85)',
          color: colors.textSecondary, fontSize: '13px', lineHeight: 1.55,
        }}>
          Пока нет ни одного проекта. Подключитесь к проекту в{' '}
          <span
            onClick={() => navigate('/settings')}
            style={{ color: colors.greenDark, fontWeight: 600, cursor: 'pointer' }}
          >
            профиле
          </span>
          {' '}— и здесь появится сводка его тестов.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: '16px',
        }}>
          {stats.map(s => {
            const coverage = s.highlights > 0 ? Math.round((s.covered / s.highlights) * 100) : 0;
            return (
              <div
                key={s.project_id}
                onClick={() => navigate(`/tests/${s.project_id}`)}
                title={`Открыть тесты проекта «${s.project_name}»`}
                style={{
                  background: 'rgba(255,255,255,0.85)',
                  backdropFilter: 'blur(20px)',
                  border: `1px solid ${colors.border}`,
                  borderRadius: radii.lg,
                  padding: '18px 22px',
                  boxShadow: shadows.card,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    fontSize: '16px', fontWeight: 600, color: colors.textPrimary,
                    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {s.project_name}
                  </span>
                  {s.is_demo && (
                    <span style={{
                      padding: '2px 8px', borderRadius: radii.pill,
                      background: 'rgba(0,0,0,0.05)', color: colors.textSecondary,
                      fontSize: '11px', fontWeight: 600, flexShrink: 0,
                    }}>
                      демо
                    </span>
                  )}
                  <ChevronRightIcon size={14} style={{ color: colors.textTertiary }} />
                </div>

                {/* Главная цифра карточки — тесты: экран-то про них. */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <ClipboardCheckIcon size={16} style={{ color: colors.greenDark, alignSelf: 'center' }} />
                  <span style={{ fontSize: '20px', fontWeight: 700, color: colors.textPrimary }}>
                    {s.tests}
                  </span>
                  <span style={{ fontSize: '13px', color: colors.textSecondary }}>
                    {plural(s.tests, ['тест', 'теста', 'тестов'])} · покрыто {s.covered} из {s.highlights}{' '}
                    {plural(s.highlights, ['привязки', 'привязок', 'привязок'])} ({coverage}%)
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {s.active > 0 && (
                    <StatusCountPill color={colors.statusActive} count={s.active} title="Привязок в статусе «Актуально»" />
                  )}
                  {s.outdated > 0 && (
                    <StatusCountPill color={colors.statusOutdated} count={s.outdated} title="Привязок в статусе «Требует проверки»" />
                  )}
                  {s.lost > 0 && (
                    <StatusCountPill color={colors.statusLost} count={s.lost} title="Привязок в статусе «Утрачено»" />
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: '12px', color: colors.textTertiary }}>
                    {s.pages} {plural(s.pages, ['страница', 'страницы', 'страниц'])}
                  </span>
                </div>

                {/* Свежесть ночного автообновления (v1.6.2). Статусы на этом
                    экране ровно настолько актуальны, насколько свеж последний
                    прогон — дата отвечает на вопрос «можно ли им верить с утра».
                    Янтарь — прогона не было дольше двух суток (или вовсе). */}
                {!s.is_demo && (
                  <div
                    title="Когда ночное автообновление в последний раз проверяло страницы проекта"
                    style={{
                      fontSize: '12px',
                      color: !s.last_auto_refresh_at
                          || Date.now() - new Date(s.last_auto_refresh_at).getTime() > 48 * 3600 * 1000
                        ? colors.statusOutdated
                        : colors.textTertiary,
                    }}
                  >
                    {s.last_auto_refresh_at
                      ? `Страницы проверены ${formatCheckedAt(s.last_auto_refresh_at)}`
                      : 'Автообновление ещё не проверяло проект'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TestsPage;
