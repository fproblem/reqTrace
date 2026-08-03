// Экран «Тесты», ярус 2 (v1.6.1): реверс-индекс проекта — «ключ → какие
// требования он держит». Аккордеон-строки ключей с чипами статусов; раскрытие
// показывает привязки (страница, цитата, статус), стрелка ведёт на страницу
// диплинком ?highlight=<id> (механизм v1.6.0). Правая панель референса
// сознательно не строится (дублировала строку) — read-only витрина.
//
// Поиск и фильтр живут в URL (?q=, ?f=): возврат со страницы привязки и F5
// не сбрасывают контекст.
//
// Производительность (v1.7.3): список приезжает ЛЁГКИМ — ключи, названия и
// счётчики, без цитат; привязки ключа подтягиваются отдельным запросом при
// раскрытии строки и запоминаются до конца визита. Поиск/фильтры остаются
// клиентскими и мгновенными — они и раньше смотрели только на ключ и название.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { ProjectTestIndex, TestIndexEntry, TestLinkRef } from '../types';
import { useToast } from '../components/Toast';
import { ChevronRightIcon, StatusAlertIcon } from '../components/icons';
import { highlightMatch } from '../components/Layout/PageTree';
import { isLikelyJiraKey } from '../components/PageView/testKeyFormat';
import { FadeIn } from '../components/fadePresence';
import { KeyIssueInformer } from '../components/KeyIssueInformer';
import { SkeletonBar, useDelayedFlag } from '../components/Skeleton';
import { TreeReveal } from '../components/TreeReveal';
import { AnimatedHeight } from '../components/AnimatedHeight';
import { RefreshIcon } from '../components/RefreshIcon';
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

// Особая строка «Привязки без тестов» (v1.7.5) живёт в общей механике
// раскрытия/кэша/точки интереса под зарезервированным ключом. Столкновение
// с настоящим ключом исключено: ключи индекса нормализованы в верхний регистр.
const UNCOVERED_KEY = '__uncovered__';

const statusLabel: Record<string, { label: string; color: string }> = {
  active: { label: 'Актуально', color: colors.statusActive },
  outdated: { label: 'Требует проверки', color: colors.statusOutdated },
  lost: { label: 'Утрачено', color: colors.statusLost },
};

// Производные строки ключа: счётчики статусов и признак «мёртвого покрытия»
// (все привязки утрачены — тест формально есть, но не держит ничего живого).
// Счётчики теперь считает бэкенд (лёгкий список v1.7.3) — здесь только форма.
function derive(entry: TestIndexEntry) {
  const total = entry.active + entry.outdated + entry.lost;
  return {
    counts: { active: entry.active, outdated: entry.outdated, lost: entry.lost },
    total,
    pagesCount: entry.pages_count,
    allLost: total > 0 && entry.lost === total,
    nonstandard: !isLikelyJiraKey(entry.key),
  };
}

// Общая геометрия строки привязки: ею живут и настоящие строки, и строка
// ожидания — раскрытие в ожидании ответа держит ровно высоту одной привязки,
// чтобы приход данных не дёргал раскладку (плавный дорост — AnimatedHeight).
// Разделитель от строки ключа несёт только ПЕРВАЯ строка блока (как раньше).
const linkRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px',
  minHeight: '44px', padding: '8px 14px',
};
const linkRowDivider: React.CSSProperties = {
  borderTop: `1px solid ${colors.border}`,
};

// Ожидание привязок раскрытого ключа: первые 200мс — пустая строка (быстрые
// ответы не мигают лоадером, порог v1.7.1), дальше мягко проявляется лоадер
// с подписью. Той же высоты, что строка с одной привязкой.
const LinksPending: React.FC = () => {
  const showLoader = useDelayedFlag(true);
  return (
    <div style={{ ...linkRowStyle, ...linkRowDivider }}>
      {showLoader && (
        <FadeIn style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          color: colors.textSecondary,
        }}>
          <RefreshIcon size={14} spinning />
          <span style={{ fontSize: '13px' }}>Подтягиваем привязки…</span>
        </FadeIn>
      )}
    </div>
  );
};

export const ProjectTestsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<ProjectTestIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Пульс строки-«точки интереса» (?key=): только по ПРИБЫТИИ на экран —
  // переход по ссылке или возврат со страницы привязки. Обычное раскрытие
  // строк не мигает: ключ прибытия фиксируется на монтировании и гасится
  // после первого применения.
  const [pulseKey, setPulseKey] = useState<string | null>(null);
  const arrivalKeyRef = useRef<string | null>(searchParams.get('key'));

  // Каркас — только если ответ не мгновенный: мигание хуже его отсутствия.
  const showSkeleton = useDelayedFlag(data === null && !failed);

  const q = searchParams.get('q') ?? '';
  const filter = (searchParams.get('f') ?? 'all') as FilterKey;

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace: true });
  };

  // Привязки раскрытых ключей (v1.7.3): приезжают отдельным запросом и
  // запоминаются до конца визита — повторное раскрытие мгновенно и без сети.
  const [linksByKey, setLinksByKey] = useState<Record<string, TestLinkRef[]>>({});
  const pendingKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    setExpanded(new Set());
    setLinksByKey({});
    pendingKeysRef.current.clear();
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

  // Единая точка загрузки привязок: срабатывает на любое появление ключа в
  // expanded — клик по строке, ключ прибытия (?key=). Ошибка сворачивает
  // строку обратно: повторный клик — повторная попытка.
  useEffect(() => {
    if (!projectId || !data) return;
    for (const key of Array.from(expanded)) {
      if (linksByKey[key] || pendingKeysRef.current.has(key)) continue;
      pendingKeysRef.current.add(key);
      // Особая строка (v1.7.5) грузится своим эндпоинтом, дальше — та же жизнь:
      // кэш до конца визита, ошибка сворачивает строку.
      const load = key === UNCOVERED_KEY
        ? api.getUncoveredLinks(projectId).then(r => r.links)
        : api.getTestLinks(projectId, key).then(r => r.links);
      load
        .then(links => setLinksByKey(prev => ({ ...prev, [key]: links })))
        .catch((e: any) => {
          showToast('error', key === UNCOVERED_KEY
            ? 'Не удалось загрузить привязки без тестов'
            : `Не удалось загрузить привязки ${key}`, e.message);
          setExpanded(prev => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        })
        .finally(() => pendingKeysRef.current.delete(key));
    }
  }, [expanded, data, projectId, linksByKey, showToast]);

  // Применение ключа прибытия: данные пришли → строка раскрыта, подкручена
  // в центр и коротко пульсирует (той же анимацией, что «Актуализировать»
  // в панели, но в зелени — это точка интереса, а не предупреждение).
  useEffect(() => {
    const key = arrivalKeyRef.current;
    if (!data || !key) return;
    arrivalKeyRef.current = null;
    const hasUncovered =
      data.uncovered.active + data.uncovered.outdated + data.uncovered.lost > 0;
    if (key === UNCOVERED_KEY
      ? !hasUncovered
      : !data.tests.some(t => t.key === key)) return;
    setExpanded(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setPulseKey(key);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-test-key="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const t = setTimeout(() => setPulseKey(null), 1700);
    return () => clearTimeout(t);
  }, [data]);

  const allRows = useMemo(
    () => (data ? data.tests.map(entry => ({ entry, ...derive(entry) })) : []),
    [data],
  );

  // Привязки без тестов (v1.7.5): без особой строки чип «Требует проверки»
  // яруса 1 обещал больше, чем ярус 2 показывал.
  const uncoveredTotal = data
    ? data.uncovered.active + data.uncovered.outdated + data.uncovered.lost
    : 0;

  // Счётчики в фильтрах: масштаб проблем виден до клика, ноль честно говорит
  // «сюда ходить незачем». Особая строка — тоже строка списка: фильтры, под
  // которыми она видна, считают её как +1.
  const filterCounts = useMemo<Record<FilterKey, number>>(() => {
    const unc = data?.uncovered;
    return {
      all: allRows.length + (uncoveredTotal > 0 ? 1 : 0),
      lost: allRows.filter(r => r.counts.lost > 0).length
        + ((unc?.lost ?? 0) > 0 ? 1 : 0),
      outdated: allRows.filter(r => r.counts.outdated > 0).length
        + ((unc?.outdated ?? 0) > 0 ? 1 : 0),
      nonstandard: allRows.filter(r => r.nonstandard).length,
    };
  }, [allRows, data, uncoveredTotal]);

  // Порядок строк: несущие больше всего привязок — сверху, внутри равных —
  // натуральный порядок ключей (REQ-9 выше REQ-10, testOrder.ts).
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    // Поиск — по ключу И по названию из Jira (v1.7.1): название человек
    // помнит чаще, чем номер. Совпадение подсвечивается в обоих местах.
    const matches = (r: { entry: TestIndexEntry }) =>
      r.entry.key.includes(needle)
      || (r.entry.summary ?? '').toUpperCase().includes(needle);
    return allRows
      .filter(r => !needle || matches(r))
      .filter(r => {
        if (filter === 'lost') return r.counts.lost > 0;
        if (filter === 'outdated') return r.counts.outdated > 0;
        if (filter === 'nonstandard') return r.nonstandard;
        return true;
      })
      .sort((a, b) =>
        b.total - a.total || compareTestKeys(a.entry.key, b.entry.key));
  }, [allRows, q, filter]);

  // Особая строка видна под «Все» и под фильтрами тех статусов, которые в ней
  // есть, — цифры чипов яруса 1 сходятся с ярусом 2. Текстовый поиск строку
  // прячет: поиск — про тесты, у строки нет ни ключа, ни названия.
  const showUncoveredRow = uncoveredTotal > 0
    && !q.trim()
    && (filter === 'all'
      || (filter === 'outdated' && (data?.uncovered.outdated ?? 0) > 0)
      || (filter === 'lost' && (data?.uncovered.lost ?? 0) > 0));

  const summary = useMemo(() => {
    if (!data) return null;
    let links = 0;
    for (const t of data.tests) links += t.active + t.outdated + t.lost;
    return { tests: data.tests.length, links, pages: data.pages_covered };
  }, [data]);

  // Раскрытие пишет ключ в URL (?key=) как «точку интереса»: возврат со
  // страницы привязки откроет экран на этом же тесте, а адрес из строки
  // браузера можно отправить коллеге. Закрытие своей строки точку снимает.
  const toggle = (key: string) => {
    const opening = !expanded.has(key);
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (opening) setParam('key', key);
    else if (searchParams.get('key') === key) setParam('key', '');
  };

  // Строки привязок раскрытого блока — общие для строк тестов и «Привязок
  // без тестов» (v1.7.5): разметка одна, различаются точка интереса в URL и
  // текст опустевшего блока. key строки — highlight_id: у привязок без тестов
  // link_id не существует, а внутри одного блока подсветка не повторяется.
  const renderLinkRows = (
    links: TestLinkRef[] | undefined,
    interestKey: string,
    emptyText: string,
  ) => (
    <AnimatedHeight>
    {links === undefined ? (
      <LinksPending />
    ) : links.length === 0 ? (
      <div style={{
        ...linkRowStyle, ...linkRowDivider,
        color: colors.textTertiary, fontSize: '13px', fontStyle: 'italic',
      }}>
        {emptyText}
      </div>
    ) : links.map((link, linkIndex) => {
        const st = statusLabel[link.status] ?? statusLabel.active;
        return (
          <div
            key={link.highlight_id}
            onClick={() => {
              // Точка интереса — именно ЭТОТ блок (открытых строк может быть
              // несколько): возврат назад вернёт к нему. replaceState, а не
              // setSearchParams: два роутерных перехода в одном тике гоняются
              // между собой.
              const next = new URLSearchParams(searchParams);
              next.set('key', interestKey);
              window.history.replaceState(null, '', `${window.location.pathname}?${next}`);
              navigate(`/pages/${link.page_id}?highlight=${link.highlight_id}`);
            }}
            title="Открыть страницу на этом выделении"
            style={{
              ...linkRowStyle,
              ...(linkIndex === 0 ? linkRowDivider : undefined),
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
            {/* Цитата — суть строки, ей до 3 строк (v1.6.5): типичное
                требование читается целиком на месте, не заставляя ходить
                на страницу; совсем длинное клампится — полный контекст
                по клику. */}
            <span style={{
              flex: 1, minWidth: 0, fontSize: '13px', color: colors.textPrimary,
              lineHeight: 1.5, overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
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
    </AnimatedHeight>
  );

  if (failed) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: colors.textSecondary, fontSize: '13px' }}>
        Тесты проекта недоступны.{' '}
        <Link to="/tests" style={{ color: colors.greenDark, fontWeight: 600 }}>К выбору проекта</Link>
      </div>
    );
  }
  if (!data || !summary) {
    // Скелетон яруса: полоска-заголовок (имя проекта неизвестно до ответа),
    // поле-полоса и типовые строки ключей 48px.
    return (
      <div style={{ padding: '32px 40px', maxWidth: '1060px', margin: '0 auto', boxSizing: 'border-box' }}>
        {showSkeleton && (
          <FadeIn>
            <SkeletonBar width="260px" height={22} style={{ marginBottom: '20px' }} />
            <SkeletonBar width="420px" height={38} radius={10} style={{ marginBottom: '16px' }} />
            <SkeletonBar width="330px" height={12} style={{ marginBottom: '20px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[0, 1, 2, 3, 4, 5].map(i => (
                <div key={i} style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: radii.md,
                  background: colors.white,
                  minHeight: '48px',
                  padding: '8px 14px',
                  display: 'flex', alignItems: 'center', gap: '12px',
                }}>
                  <SkeletonBar width="86px" height={12} />
                  <SkeletonBar width={i % 2 ? '38%' : '52%'} height={12} />
                  <SkeletonBar width="34px" height={18} radius={9} style={{ marginLeft: 'auto' }} />
                </div>
              ))}
            </div>
          </FadeIn>
        )}
      </div>
    );
  }

  return (
    // Скроллит <main> из Layout (как в профиле): свой overflow у контейнера
    // с maxWidth вешал скроллбар на его правый край — посреди экрана (v1.6.6).
    // Колонка отцентрована: прибитая к левому краю, на широком мониторе она
    // оставляла всю «лишнюю» ширину одним пустым полем справа.
    <div style={{ padding: '32px 40px', maxWidth: '1060px', margin: '0 auto', boxSizing: 'border-box' }}>
      {/* Мягкое появление экрана и данных — 160мс, как у модалок (v1.7.1). */}
      <FadeIn>
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
          placeholder="Поиск тестов…"
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
              {f.label} ({filterCounts[f.key]})
            </button>
          );
        })}
      </div>

      {/* Пульс строки-«точки интереса» — та же механика, что у кнопки
          «Актуализировать» в панели (0.8s × 2, класс не инлайн — анимация
          перебивает ховер-фон, reduced-motion отключается медиа-запросом). */}
      <style>{`
        @keyframes tests-row-pulse {
          0%, 100% { background-color: ${colors.white}; }
          50% { background-color: ${colors.greenAccent}2E; }
        }
        .tests-row-pulse { animation: tests-row-pulse 0.8s ease-in-out 2; }
        @media (prefers-reduced-motion: reduce) {
          .tests-row-pulse { animation: none; }
        }
      `}</style>

      <div style={{ fontSize: '13px', color: colors.textSecondary, marginBottom: '16px' }}>
        Всего: {summary.tests} {plural(summary.tests, ['тест', 'теста', 'тестов'])}
        {' · '}покрывают {summary.links} {plural(summary.links, ['привязку', 'привязки', 'привязок'])}
        {' '}на {summary.pages} {plural(summary.pages, ['странице', 'страницах', 'страницах'])}
        {/* Разрыв цифр ярусов объясняется словами (v1.7.5). */}
        {uncoveredTotal > 0 && (
          <>{' · '}ещё {uncoveredTotal} {plural(uncoveredTotal, ['привязка', 'привязки', 'привязок'])} без тестов</>
        )}
      </div>

      {data.tests.length === 0 && uncoveredTotal === 0 ? (
        <div style={{
          padding: '28px', borderRadius: radii.lg,
          border: `1px solid ${colors.border}`, background: 'rgba(255,255,255,0.85)',
          color: colors.textSecondary, fontSize: '13px', lineHeight: 1.55,
        }}>
          В проекте пока нет привязанных тестов. Откройте страницу, выделите
          текст требования и привяжите к нему ключ теста — он появится здесь.
        </div>
      ) : rows.length === 0 && !showUncoveredRow ? (
        <div style={{ padding: '28px 0', color: colors.textTertiary, fontSize: '13px', fontStyle: 'italic' }}>
          Ничего не нашлось — измените запрос или фильтр.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Особая строка «Привязки без тестов» (v1.7.5) — закреплена над
              списком: это долг покрытия, а не тест, поэтому пунктирная рамка
              в янтаре и значок вместо ключа. Раскрытие, кэш и точка интереса —
              общие с тестовыми строками (UNCOVERED_KEY). */}
          {showUncoveredRow && data.uncovered && (() => {
            const unc = data.uncovered;
            const isOpen = expanded.has(UNCOVERED_KEY);
            return (
              <div
                data-test-key={UNCOVERED_KEY}
                className={pulseKey === UNCOVERED_KEY ? 'tests-row-pulse' : undefined}
                style={{
                  border: `1px dashed ${colors.statusOutdated}88`,
                  borderRadius: radii.md,
                  background: colors.white,
                  overflow: 'hidden',
                }}
              >
                <div
                  onClick={() => toggle(UNCOVERED_KEY)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    minHeight: '48px', padding: '8px 14px', cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.02)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Красится currentColor (урок v1.7.0) — без span был бы чёрным. */}
                  <span style={{ color: colors.statusOutdated, display: 'flex', flexShrink: 0 }}>
                    <StatusAlertIcon kind="warning" size={16} />
                  </span>
                  <div style={{
                    flex: 1, minWidth: 0,
                    display: 'flex', flexDirection: 'column', gap: '2px',
                  }}>
                    <span style={{
                      fontSize: '13.5px', fontWeight: 600,
                      color: colors.textPrimary, lineHeight: 1.45,
                    }}>
                      Привязки без тестов
                    </span>
                    <span style={{ fontSize: '12.5px', color: colors.textSecondary }}>
                      {uncoveredTotal} {plural(uncoveredTotal, ['привязка', 'привязки', 'привязок'])}
                      {' · '}{unc.pages_count} {plural(unc.pages_count, ['страница', 'страницы', 'страниц'])}
                    </span>
                  </div>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    {unc.active > 0 && (
                      <StatusCountPill color={colors.statusActive} count={unc.active} title="Актуально" />
                    )}
                    {unc.outdated > 0 && (
                      <StatusCountPill color={colors.statusOutdated} count={unc.outdated} title="Требует проверки" />
                    )}
                    {unc.lost > 0 && (
                      <StatusCountPill color={colors.statusLost} count={unc.lost} title="Утрачено" />
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
                <TreeReveal expanded={isOpen}>
                  {renderLinkRows(
                    linksByKey[UNCOVERED_KEY], UNCOVERED_KEY,
                    'Непокрытых привязок не осталось — возможно, тесты только что привязали',
                  )}
                </TreeReveal>
              </div>
            );
          })()}
          {rows.map(({ entry, counts, total, pagesCount, allLost, nonstandard }) => {
            const isOpen = expanded.has(entry.key);
            // Jira не знает такой задачи — ключ гаснет и теряет ссылку
            // (/browse дал бы 404); информер объяснит (v1.7.0).
            const notInJira = entry.jira_status === 'not_found';
            const keyIsLink = !!data.jira_base_url && !nonstandard && !notInJira;
            return (
              <div
                key={entry.key}
                data-test-key={entry.key}
                className={pulseKey === entry.key ? 'tests-row-pulse' : undefined}
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: radii.md,
                  background: colors.white,
                  overflow: 'hidden',
                }}
              >
                {/* Строка ключа — клик раскрывает привязки. Структура по
                    референсу (v1.7.0): ключ — колонкой слева, название —
                    главная строка, счётчики — серой подстрокой. Без названия
                    (нет токена/не нашли) счётчики остаются единственной
                    строкой — высота держится minHeight. */}
                <div
                  onClick={() => toggle(entry.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    minHeight: '48px', padding: '8px 14px', cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.02)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {(nonstandard || notInJira) && (
                    <KeyIssueInformer
                      text={nonstandard
                        ? 'Ключ не похож на формат Jira (TEST-123) — проверьте, нет ли опечатки'
                        : 'Задачи с таким ключом нет в Jira — тест удалён или ключ с опечаткой'}
                    />
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
                      {highlightMatch(entry.key, q)}
                    </a>
                  ) : (
                    <span style={{
                      color: notInJira ? colors.textSecondary : colors.textPrimary,
                      fontWeight: 600, fontSize: '14px', flexShrink: 0,
                    }}>
                      {highlightMatch(entry.key, q)}
                    </span>
                  )}
                  {/* Название (целиком, с переносами) + счётчики подстрокой:
                      единый текст в одну строку читался кашей (ревью). */}
                  <div style={{
                    flex: 1, minWidth: 0,
                    display: 'flex', flexDirection: 'column', gap: '2px',
                  }}>
                    {entry.summary && (
                      <span style={{
                        fontSize: '13.5px', color: colors.textPrimary,
                        lineHeight: 1.45, wordBreak: 'break-word',
                      }}>
                        {highlightMatch(entry.summary, q)}
                      </span>
                    )}
                    <span style={{ fontSize: '12.5px', color: colors.textSecondary }}>
                      {total} {plural(total, ['привязка', 'привязки', 'привязок'])}
                      {' · '}{pagesCount} {plural(pagesCount, ['страница', 'страницы', 'страниц'])}
                    </span>
                  </div>
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
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
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

                {/* Раскрытие — TreeReveal (мягкость аккордеона, v1.6.6), внутри
                    AnimatedHeight: пока привязки едут, блок держит высоту одной
                    строки (LinksPending), а с приходом ответа плавно дорастает
                    до реального списка — без рывка лоадер → контент (v1.7.3).
                    Разделитель — на строках (borderTop): у ожидания и у первой
                    привязки он одинаковый, граница не прыгает. */}
                <TreeReveal expanded={isOpen}>
                  {renderLinkRows(
                    linksByKey[entry.key], entry.key,
                    'Привязок не осталось — возможно, их только что отвязали',
                  )}
                </TreeReveal>
              </div>
            );
          })}
        </div>
      )}
      </FadeIn>
    </div>
  );
};

export default ProjectTestsPage;
