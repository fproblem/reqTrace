// Экран «Тесты», ярус 2 (v1.6.1): реверс-индекс проекта — «ключ → какие
// требования он держит». Аккордеон-строки ключей с чипами статусов; раскрытие
// показывает привязки (страница, цитата, статус), стрелка ведёт на страницу
// диплинком ?highlight=<id> (механизм v1.6.0). Правая панель референса
// сознательно не строится (дублировала строку) — read-only витрина.
//
// Поиск и фильтр живут в URL (?q=, ?f=): возврат со страницы привязки и F5
// не сбрасывают контекст.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { ProjectTestIndex, TestIndexEntry } from '../types';
import { useToast } from '../components/Toast';
import { ChevronRightIcon, StatusAlertIcon } from '../components/icons';
import { isLikelyJiraKey } from '../components/PageView/testKeyFormat';
import { compareTestKeys } from '../components/PageView/testOrder';
import { colors, radii, shadows } from '../styles/tokens';
import { plural, StatusCountPill } from './TestsPage';

type FilterKey = 'all' | 'lost' | 'outdated' | 'nonstandard';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'lost', label: 'С утраченными' },
  { key: 'outdated', label: 'С требующими проверки' },
  { key: 'nonstandard', label: 'Нестандартные ключи' },
];

const statusLabel: Record<string, { label: string; color: string }> = {
  active: { label: 'Актуально', color: colors.statusActive },
  outdated: { label: 'Требует проверки', color: colors.statusOutdated },
  lost: { label: 'Утрачено', color: colors.statusLost },
};

// Производные строки ключа: счётчики статусов и признак «мёртвого покрытия»
// (все привязки утрачены — тест формально есть, но не держит ничего живого).
function derive(entry: TestIndexEntry) {
  const counts = { active: 0, outdated: 0, lost: 0 };
  const pages = new Set<string>();
  for (const link of entry.links) {
    if (link.status === 'active') counts.active++;
    else if (link.status === 'outdated') counts.outdated++;
    else if (link.status === 'lost') counts.lost++;
    pages.add(link.page_id);
  }
  return {
    counts,
    pagesCount: pages.size,
    allLost: entry.links.length > 0 && counts.lost === entry.links.length,
    nonstandard: !isLikelyJiraKey(entry.key),
  };
}

export const ProjectTestsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<ProjectTestIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const q = searchParams.get('q') ?? '';
  const filter = (searchParams.get('f') ?? 'all') as FilterKey;

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    setExpanded(new Set());
    api.getProjectTests(projectId)
      .then(d => { if (!cancelled) setData(d); })
      .catch((e: any) => {
        if (!cancelled) {
          setFailed(true);
          showToast('error', 'Не удалось загрузить тесты проекта', e.message);
        }
      });
    return () => { cancelled = true; };
  }, [projectId, showToast]);

  // Порядок строк: несущие больше всего привязок — сверху, внутри равных —
  // натуральный порядок ключей (REQ-9 выше REQ-10, testOrder.ts).
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toUpperCase();
    return data.tests
      .map(entry => ({ entry, ...derive(entry) }))
      .filter(r => !needle || r.entry.key.includes(needle))
      .filter(r => {
        if (filter === 'lost') return r.counts.lost > 0;
        if (filter === 'outdated') return r.counts.outdated > 0;
        if (filter === 'nonstandard') return r.nonstandard;
        return true;
      })
      .sort((a, b) =>
        b.entry.links.length - a.entry.links.length || compareTestKeys(a.entry.key, b.entry.key));
  }, [data, q, filter]);

  const summary = useMemo(() => {
    if (!data) return null;
    const pages = new Set<string>();
    let links = 0;
    for (const t of data.tests) {
      links += t.links.length;
      for (const l of t.links) pages.add(l.page_id);
    }
    return { tests: data.tests.length, links, pages: pages.size };
  }, [data]);

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (failed) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: colors.textSecondary, fontSize: '13px' }}>
        Тесты проекта недоступны.{' '}
        <Link to="/tests" style={{ color: colors.greenDark, fontWeight: 600 }}>К выбору проекта</Link>
      </div>
    );
  }
  if (!data || !summary) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: colors.textSecondary }}>
        Загрузка...
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1060px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {/* Крошка-заголовок: «Тесты» возвращает на ярус выбора проекта. */}
      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 16px', color: colors.textPrimary }}>
        <Link
          to="/tests"
          title="К выбору проекта"
          style={{ color: colors.textTertiary, textDecoration: 'none', transition: 'color 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.color = colors.greenDark; }}
          onMouseLeave={e => { e.currentTarget.style.color = colors.textTertiary; }}
        >
          Тесты
        </Link>
        <span style={{ color: colors.textTertiary, fontWeight: 400 }}> · </span>
        {data.project_name}
      </h1>

      {/* Поиск и фильтры. Фокус поля — общий стандарт (focusBorder + кольцо). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <input
          type="text"
          value={q}
          onChange={e => setParam('q', e.target.value)}
          placeholder="Поиск ключа…"
          style={{
            width: '220px', height: '36px', padding: '0 12px',
            borderRadius: radii.md, border: `1px solid ${colors.border}`,
            fontSize: '13px', fontFamily: 'inherit', outline: 'none',
            boxSizing: 'border-box', background: colors.white,
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = colors.focusBorder;
            e.currentTarget.style.boxShadow = shadows.focusRing;
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        {FILTERS.map(f => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setParam('f', f.key === 'all' ? '' : f.key)}
              style={{
                height: '36px', padding: '0 14px', borderRadius: radii.pill,
                border: `1px solid ${active ? 'rgba(122, 224, 90, 0.55)' : colors.border}`,
                background: active ? colors.greenLight : colors.white,
                color: active ? colors.greenDark : colors.textSecondary,
                fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.15s', flexShrink: 0,
              }}
              onMouseEnter={e => {
                if (active) return;
                e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                e.currentTarget.style.borderColor = colors.borderHover;
              }}
              onMouseLeave={e => {
                if (active) return;
                e.currentTarget.style.background = colors.white;
                e.currentTarget.style.borderColor = colors.border;
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: '13px', color: colors.textSecondary, marginBottom: '16px' }}>
        Всего: {summary.tests} {plural(summary.tests, ['тест', 'теста', 'тестов'])}
        {' · '}покрывают {summary.links} {plural(summary.links, ['привязку', 'привязки', 'привязок'])}
        {' '}на {summary.pages} {plural(summary.pages, ['странице', 'страницах', 'страницах'])}
      </div>

      {data.tests.length === 0 ? (
        <div style={{
          padding: '28px', borderRadius: radii.lg,
          border: `1px solid ${colors.border}`, background: 'rgba(255,255,255,0.85)',
          color: colors.textSecondary, fontSize: '13px', lineHeight: 1.55,
        }}>
          В проекте пока нет привязанных тестов. Откройте страницу, выделите
          текст требования и привяжите к нему ключ теста — он появится здесь.
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '28px 0', color: colors.textTertiary, fontSize: '13px', fontStyle: 'italic' }}>
          Ничего не нашлось — измените запрос или фильтр.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rows.map(({ entry, counts, pagesCount, allLost, nonstandard }) => {
            const isOpen = expanded.has(entry.key);
            const keyIsLink = !!data.jira_base_url && !nonstandard;
            return (
              <div
                key={entry.key}
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: radii.md,
                  background: colors.white,
                  overflow: 'hidden',
                }}
              >
                {/* Строка ключа — клик раскрывает привязки. */}
                <div
                  onClick={() => toggle(entry.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    height: '48px', padding: '0 14px', cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.02)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {nonstandard && (
                    <span
                      title="Ключ не похож на формат Jira (PROJECT-123) — проверьте, нет ли опечатки"
                      style={{ color: colors.statusOutdated, display: 'flex', cursor: 'help', flexShrink: 0 }}
                    >
                      <StatusAlertIcon kind="warning" size={14} />
                    </span>
                  )}
                  {keyIsLink ? (
                    <a
                      href={`${data.jira_base_url}/browse/${entry.key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      title="Открыть тест в Jira"
                      style={{
                        color: colors.greenDark, textDecoration: 'none',
                        fontWeight: 600, fontSize: '14px', flexShrink: 0,
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = '#3F9E27';
                        e.currentTarget.style.textDecoration = 'underline';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = colors.greenDark;
                        e.currentTarget.style.textDecoration = 'none';
                      }}
                    >
                      {entry.key}
                    </a>
                  ) : (
                    <span style={{ color: colors.textPrimary, fontWeight: 600, fontSize: '14px', flexShrink: 0 }}>
                      {entry.key}
                    </span>
                  )}
                  <span style={{ fontSize: '13px', color: colors.textSecondary, flexShrink: 0 }}>
                    {entry.links.length} {plural(entry.links.length, ['привязка', 'привязки', 'привязок'])}
                    {' · '}{pagesCount} {plural(pagesCount, ['страница', 'страницы', 'страниц'])}
                  </span>
                  {/* Красная пометка «мёртвого покрытия»: тест есть, но всё,
                      что он держал, утрачено. */}
                  {allLost && (
                    <span style={{
                      padding: '2px 8px', borderRadius: radii.pill,
                      background: `${colors.statusLost}15`, border: `1px solid ${colors.statusLost}33`,
                      color: colors.statusLost, fontSize: '11px', fontWeight: 700, flexShrink: 0,
                    }}>
                      все утрачены
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {counts.active > 0 && (
                      <StatusCountPill color={colors.statusActive} count={counts.active} title="Актуально" />
                    )}
                    {counts.outdated > 0 && (
                      <StatusCountPill color={colors.statusOutdated} count={counts.outdated} title="Требует проверки" />
                    )}
                    {counts.lost > 0 && (
                      <StatusCountPill color={colors.statusLost} count={counts.lost} title="Утрачено" />
                    )}
                    <ChevronRightIcon
                      size={14}
                      style={{
                        color: colors.textTertiary,
                        transition: 'transform 0.18s ease',
                        transform: isOpen ? 'rotate(90deg)' : 'none',
                      }}
                    />
                  </span>
                </div>

                {isOpen && (
                  <div style={{ borderTop: `1px solid ${colors.border}` }}>
                    {entry.links.map(link => {
                      const st = statusLabel[link.status] ?? statusLabel.active;
                      return (
                        <div
                          key={link.link_id}
                          onClick={() => navigate(`/pages/${link.page_id}?highlight=${link.highlight_id}`)}
                          title="Открыть страницу на этом выделении"
                          style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            minHeight: '44px', padding: '6px 14px',
                            cursor: 'pointer', transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.02)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <span style={{
                            width: '160px', flexShrink: 0, fontSize: '12.5px',
                            color: colors.textSecondary, overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {link.page_title}
                          </span>
                          <span style={{
                            flex: 1, minWidth: 0, fontSize: '13px', color: colors.textPrimary,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            «{link.excerpt}»
                          </span>
                          <span style={{
                            padding: '3px 10px', borderRadius: radii.pill, flexShrink: 0,
                            background: `${st.color}15`, border: `1px solid ${st.color}33`,
                            color: st.color, fontSize: '11px', fontWeight: 600,
                          }}>
                            {st.label}
                          </span>
                          <span style={{ color: colors.textTertiary, display: 'flex', flexShrink: 0 }}>
                            <ChevronRightIcon size={14} />
                          </span>
                        </div>
                      );
                    })}
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

export default ProjectTestsPage;
