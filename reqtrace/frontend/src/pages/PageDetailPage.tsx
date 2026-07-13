import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { PageDetail, Highlight } from '../types';
import { ContentRenderer, contentStyles } from '../components/PageView/ContentRenderer';
import { HighlightLayer, highlightDomOrder, compareByDomThenAnchor } from '../components/PageView/HighlightLayer';
import type { HighlightRenderReport } from '../components/PageView/HighlightLayer';
import { SidePanel, PANEL_ANIM_MS } from '../components/PageView/SidePanel';
import { DiffView } from '../components/PageView/DiffView';
import { sortedTests } from '../components/PageView/testOrder';
import { Modal, ModalButton, modalTextStyle } from '../components/Modal';
import { RefreshIcon } from '../components/RefreshIcon';
import { useToast } from '../components/Toast';
import { useTreeRefresh } from '../hooks/useTreeRefresh';
import { useTextSelection } from '../components/PageView/selection/useTextSelection';
import { colors, radii, shadows } from '../styles/tokens';

interface PageDetailPageProps {
  jiraBaseUrl?: string;
}

type ViewMode = 'coverage' | 'changes';

function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  let equal = true;
  a.forEach(id => { if (!b.has(id)) equal = false; });
  return equal;
}

function sameRenderReport(a: HighlightRenderReport | null, b: HighlightRenderReport): boolean {
  return !!a
    && sameIdSet(a.rendered, b.rendered)
    && sameIdSet(a.considered, b.considered);
}

export const PageDetailPage: React.FC<PageDetailPageProps> = () => {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();
  const { showToast, showPromptToast, dismissToast } = useToast();
  // Точки статусов в дереве считаются по привязкам страницы. Само дерево
  // перечитывается только при навигации — после действий, меняющих статусы
  // или состав привязок (актуализация, удаление, авто-«Утрачено»), его нужно
  // попросить обновиться явно, иначе индикатор врёт до следующего перехода.
  const { refreshTree } = useTreeRefresh();

  const [page, setPage] = useState<PageDetail | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('coverage');
  const [selectedHighlight, setSelectedHighlight] = useState<Highlight | null>(null);
  const [renderReport, setRenderReport] = useState<HighlightRenderReport | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [contentContainer, setContentContainer] = useState<HTMLDivElement | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');

  const contentAreaRef = useRef<HTMLDivElement>(null);
  const contentContainerRef = useRef<HTMLDivElement | null>(null);
  // Захват выделения и попап «Привязать тесты» — в хуке (v1.5.9):
  // якоря считает selection/selectionAnchors, сервер верифицирует при создании.
  const { selection, anchorsRef, dismiss: dismissSelection } = useTextSelection({
    contentAreaRef,
    getContainer: () => contentContainerRef.current,
  });

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showBaselineWarning, setShowBaselineWarning] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(async () => {
    if (!pageId) return;
    try {
      const [pageData, hlData] = await Promise.all([
        api.getPage(pageId),
        api.listHighlights(pageId),
      ]);
      setPage(pageData);
      setHighlights(hlData);
      // Jira теперь свойство проекта страницы — приходит вместе с ней.
      setJiraBaseUrl(pageData.jira_base_url || '');
      return hlData;
    } catch (e: any) {
      showToast('error', 'Не удалось загрузить страницу', e.message);
    } finally {
      setLoading(false);
    }
  }, [pageId, showToast]);

  // Загрузка при навигации. Диплинк ?highlight=<id> (кнопка «Скопировать
  // ссылку» в панели) применяется ровно здесь — к привязкам, пришедшим для
  // ЭТОЙ навигации, а не к остаткам прошлой страницы в состоянии: открываем
  // панель и подскролливаем к выделению, как после «Привязать тесты».
  // Повторные loadPage (добавление теста и т.п.) диплинк не переприменяют.
  useEffect(() => {
    void loadPage().then(hls => {
      if (!hls) return;
      const id = new URLSearchParams(window.location.search).get('highlight');
      if (!id) return;
      const target = hls.find(h => h.id === id);
      if (!target) {
        showToast('warning', 'Привязка по ссылке не найдена', 'Возможно, её удалили после того, как ссылку скопировали');
        return;
      }
      setSelectedHighlight(target);
      pendingScrollHighlightRef.current = target.id;
    });
  }, [loadPage, showToast]);

  // Предложение «Закрепить текущую версию?» (тост после актуализации последней
  // outdated-привязки) адресовано конкретной странице — при уходе с неё тост
  // гасится, иначе «Закрепить» сработал бы по чужому pageId.
  const baselinePromptRef = useRef<number | null>(null);

  // Переход на другую страницу через дерево НЕ размонтирует компонент —
  // в маршруте меняется только :pageId. Выделение прошлой страницы сбрасываем,
  // иначе панель оставалась открытой с чужими данными (закроется штатной
  // анимацией); заодно гасим попап «Привязать тесты» и устаревший отчёт слоя.
  useEffect(() => {
    setSelectedHighlight(null);
    dismissSelection();
    setRenderReport(null);
    if (baselinePromptRef.current != null) {
      dismissToast(baselinePromptRef.current);
      baselinePromptRef.current = null;
    }
    // Контейнер контента прошлой страницы больше не годится: если по пути
    // ContentRenderer размонтировался (виртуальная страница, «Изменения»),
    // в состоянии остаётся оторванный div со старым контентом, и слой успевал
    // прогнать по нему привязки НОВОЙ страницы — «ничего не отрисовалось» →
    // массовое ложное «Утрачено» → возврат в «Требует проверки» (см. журнал
    // бэка: пачки mark-lost/unmark-lost). Новый контейнер придёт из
    // onContentReady, когда контент реально окажется в DOM.
    setContentContainer(null);
  }, [pageId]);

  // Меню действий (троеточие) закрывается по клику вне него и по Escape.
  useEffect(() => {
    if (!showActionsMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowActionsMenu(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showActionsMenu]);

  const handleRefresh = async () => {
    if (!pageId) return;
    setRefreshing(true);
    // Запоминаем состояние до обновления: id текущего снимка (по нему поймём,
    // создал ли бэкенд новый снимок = контент изменился) и статусы привязок,
    // чтобы показать в тосте сводку «что изменилось» — как у синхронизации дерева.
    const prevSnapshotId = page?.current_snapshot?.id ?? null;
    const prevStatusById = new Map(highlights.map(h => [h.id, h.status] as const));
    try {
      const refreshed = await api.refreshPage(pageId);
      const newHighlights = (await loadPage()) ?? [];
      refreshTree();

      const changed = (refreshed.current_snapshot?.id ?? null) !== prevSnapshotId;
      if (!changed) {
        showToast('success', 'Страница актуальна', 'Изменений на странице не найдено');
        return;
      }

      // Сводка по привязкам: сколько из-за правок «переехало» в «требуют
      // проверки» и «утрачено» относительно состояния до обновления.
      let becameOutdated = 0;
      let becameLost = 0;
      for (const h of newHighlights) {
        const prev = prevStatusById.get(h.id);
        if (h.status === 'outdated' && prev && prev !== 'outdated') becameOutdated++;
        if (h.status === 'lost' && prev && prev !== 'lost') becameLost++;
      }
      const parts: string[] = [];
      if (becameOutdated) parts.push(`требуют проверки: +${becameOutdated}`);
      if (becameLost) parts.push(`утрачено: +${becameLost}`);
      const detail = parts.length
        ? `Содержимое изменилось. Привязки — ${parts.join(', ')}`
        : 'Содержимое страницы изменилось';
      showToast('success', 'Страница обновлена', detail);
    } catch (e: any) {
      showToast('error', 'Не удалось обновить страницу', e.message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSetBaselineClick = () => {
    if (!pageId) return;
    const hasOutdated = highlights.some(h => h.status === 'outdated');
    if (hasOutdated) {
      setShowBaselineWarning(true);
    } else {
      handleSetBaseline();
    }
  };

  const handleSetBaseline = async () => {
    if (!pageId) return;
    setShowBaselineWarning(false);
    try {
      await api.setBaseline(pageId);
      await loadPage();
      showToast('success', 'Версия закреплена', 'Изменения страницы теперь считаются от текущей версии');
    } catch (e: any) {
      showToast('error', 'Не удалось закрепить baseline', e.message);
    }
  };

  const handleHighlightClick = useCallback((h: Highlight) => {
    setSelectedHighlight(h);
    scrollToHighlight(h.id);
  }, []);

  // HighlightLayer сообщает, какие привязки реально отрисовались. Обновляем
  // состояние только при фактическом изменении отчёта — иначе пере-рендер на
  // каждый прогон слоя зациклил бы эффект.
  const handleRenderReport = useCallback((report: HighlightRenderReport) => {
    setRenderReport(prev => (sameRenderReport(prev, report) ? prev : report));
  }, []);

  // Момент последнего ОТКРЫТИЯ панели (null — закрыта). Пока не истекло окно
  // анимации ширины, подскроллу прицеливаться нельзя: таблицы при пере-вёрстке
  // «едут» дискретными скачками, и эвристика стабильности координат ловила
  // ложное затишье посреди анимации.
  const panelOpenedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (selectedHighlight) {
      if (panelOpenedAtRef.current === null) panelOpenedAtRef.current = performance.now();
    } else {
      panelOpenedAtRef.current = null;
    }
  }, [selectedHighlight]);

  // Подскролл к выделению — строго после анимации открытия панели. Сначала
  // детерминированно пережидаем окно анимации (PANEL_ANIM_MS + запас на
  // хвостовую пере-вёрстку), затем второй линией защиты ждём, пока рамка цели
  // не постоит на месте три кадра подряд (дозагрузка контента, незаконченный
  // предыдущий smooth-scroll). При давно открытой панели окно уже истекло —
  // скролл срабатывает через ~3 кадра, навигация стрелками остаётся быстрой.
  // Потолок ожидания ~1.5с — страховка; новая цель отменяет предыдущую.
  const scrollSeqRef = useRef(0);
  const scrollToHighlight = useCallback((highlightId: string) => {
    const seq = ++scrollSeqRef.current;
    const deadline = performance.now() + 1500;
    let lastTop: number | null = null;
    let stable = 0;
    const tick = () => {
      if (seq !== scrollSeqRef.current) return;
      const now = performance.now();
      const el = contentAreaRef.current?.querySelector(
        `[data-highlight-id="${highlightId}"]`,
      );
      if (now >= deadline) {
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const openedAt = panelOpenedAtRef.current;
      const animating = openedAt !== null && now - openedAt < PANEL_ANIM_MS + 60;
      if (el && !animating) {
        const { top } = el.getBoundingClientRect();
        stable = lastTop !== null && Math.abs(top - lastTop) < 0.5 ? stable + 1 : 0;
        lastTop = top;
        if (stable >= 2) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      } else {
        lastTop = null;
        stable = 0;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  const handleNavigate = useCallback((h: Highlight) => {
    setSelectedHighlight(h);
    scrollToHighlight(h.id);
  }, [scrollToHighlight]);

  // После «Привязать тесты» открывшаяся правая панель сжимает контент, и
  // вьюпорт «уезжает» с места выделения. Подскролливаем к созданной привязке,
  // когда слой фактически отрисовал её <mark>: целиться по таймеру нельзя —
  // метка появляется только после перезагрузки контента и прогона слоя.
  const pendingScrollHighlightRef = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingScrollHighlightRef.current;
    if (!id || !renderReport || !renderReport.considered.has(id)) return;
    pendingScrollHighlightRef.current = null;
    if (renderReport.rendered.has(id)) scrollToHighlight(id);
  }, [renderReport, scrollToHighlight]);

  const handleAddTest = async (highlightId: string, testKey: string) => {
    try {
      await api.addTestLink(highlightId, testKey);
      await loadPage();
      const refreshed = await api.listHighlights(pageId!);
      setHighlights(refreshed);
      // Не закрываем панель, если привязка по какой-то причине не нашлась в
      // обновлённом списке — оставляем текущее выделение, чтобы тест не «исчезал».
      setSelectedHighlight(prev => refreshed.find(h => h.id === highlightId) || prev);
    } catch (e: any) {
      showToast('error', 'Не удалось привязать тест', e.message);
    }
  };

  const handleRemoveTest = async (linkId: string) => {
    try {
      await api.removeTestLink(linkId);
      await loadPage();
      if (selectedHighlight) {
        const refreshed = await api.listHighlights(pageId!);
        setHighlights(refreshed);
        setSelectedHighlight(refreshed.find(h => h.id === selectedHighlight.id) || null);
      }
    } catch (e: any) {
      showToast('error', 'Не удалось отвязать тест', e.message);
    }
  };

  const handleReanchor = async (highlightId: string) => {
    try {
      await api.reanchorHighlight(highlightId);
      await loadPage();
      if (pageId) {
        const refreshed = await api.listHighlights(pageId);
        setHighlights(refreshed);
        setSelectedHighlight(refreshed.find(h => h.id === highlightId) || null);
        refreshTree();
        // Автоперехода к следующему «Требует проверки» здесь сознательно НЕТ:
        // пробовали (c21b3dfc) — на тесте прыжок панели дезориентировал.
        // Обход по статусу остаётся ручным (плашка статуса/чипы), а завершение
        // обхода отмечаем тостом.
        if (!refreshed.some(h => h.status === 'outdated')) {
          // Все привязки проверены — удобный момент закрепить проверенную
          // версию как baseline, мягко побуждаем. Тост с отсчётом: дотикал
          // или «Не сейчас» — ничего не происходит. Если baseline уже стоит
          // на текущем снимке, закреплять нечего — обычный тост, как раньше.
          const baselineCurrent = !page?.current_snapshot ||
            page.baseline?.snapshot_id === page.current_snapshot.id;
          if (baselineCurrent) {
            showToast('success', 'Все привязки проверены', 'Выделений в статусе «Требует проверки» не осталось');
          } else {
            baselinePromptRef.current = showPromptToast('success', 'Все привязки проверены', {
              message: 'Закрепить текущую версию страницы?',
              seconds: 10,
              acceptLabel: 'Закрепить',
              declineLabel: 'Не сейчас',
              onAccept: () => void handleSetBaseline(),
            });
          }
        }
      }
    } catch (e: any) {
      showToast('error', 'Не удалось актуализировать привязку', e.message);
    }
  };

  // Удаление мгновенное (v1.6.0): подтверждение уже спросила карточка в панели.
  // Прежний undo-таймер (v1.5.4) держал привязку живой на сервере ещё 5 секунд,
  // и любой перезапрос списка в это окно воскрешал её в UI — а новое выделение
  // на освободившемся тексте пересекалось с «зомби»-диапазоном.
  const handleDeleteHighlight = async (highlightId: string) => {
    setSelectedHighlight(null);
    setHighlights(prev => prev.filter(h => h.id !== highlightId));
    try {
      await api.deleteHighlight(highlightId);
      refreshTree();
    } catch (e: any) {
      showToast('error', 'Не удалось удалить привязку', e.message);
      try {
        setHighlights(await api.listHighlights(pageId!));
      } catch {
        // Сервер недоступен — вернуть актуальный список всё равно нечем.
      }
    }
  };

  const handleDeletePage = async () => {
    if (!pageId || deleteConfirmText !== 'Удалить') return;
    setDeleting(true);
    try {
      await api.deletePage(pageId);
      navigate('/');
    } catch (e: any) {
      showToast('error', 'Не удалось удалить страницу', e.message);
      setDeleting(false);
    }
  };

  useEffect(() => {
    contentContainerRef.current = contentContainer;
  }, [contentContainer]);

  const handleCreateHighlight = async () => {
    const anchors = anchorsRef.current;
    if (!pageId || !selection || !anchors) return;

    try {
      const created = await api.createHighlight(pageId, {
        text_content: selection.text,
        text_before: anchors.textBefore,
        text_after: anchors.textAfter,
        anchor_block_start: anchors.anchorBlockStart,
        anchor_block_end: anchors.anchorBlockEnd,
        start_char_offset: anchors.startCharOffset,
        end_char_offset: anchors.endCharOffset,
      });
      window.getSelection()?.removeAllRanges();
      dismissSelection();
      await loadPage();
      refreshTree();
      // Сразу открываем боковую панель на созданной привязке: кнопка обещает
      // «Привязать тесты», поэтому пользователь должен сразу получить форму
      // привязки, а не искать бледную метку «Требует проверки» на странице.
      setSelectedHighlight(created);
      pendingScrollHighlightRef.current = created.id;
    } catch (e: any) {
      showToast('error', 'Не удалось создать привязку', e.message);
    }
  };

  // Статусной синхронизации по отчёту слоя больше НЕТ (v1.5.9): статусы решает
  // только сервер при refresh и человек («Актуализировать»). Просмотр страницы
  // не меняет статусы по построению — целый класс багов «самоустаревания»
  // (v1.5.7) и «прыгающих» подсветок невозможен.

  if (loading) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: colors.textSecondary }}>
        Загрузка...
      </div>
    );
  }

  if (!page) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: colors.statusLost }}>
        Страница не найдена
      </div>
    );
  }

  if (page.is_virtual) {
    const handlePromote = async () => {
      if (!pageId) return;
      setPromoting(true);
      try {
        await api.promotePage(pageId);
        await loadPage();
        showToast('success', 'Страница подключена', 'Содержимое загружено из Confluence');
      } catch (e: any) {
        showToast('error', 'Не удалось подключить страницу', e.message);
      } finally {
        setPromoting(false);
      }
    };

    return (
      <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
        {/* Top bar */}
        <div style={{
          // Высота фиксирована (64px, как у шапки сайдбара) — их нижние линии
          // стыкуются в одну сплошную. Не паддингами: контент разной высоты
          // давал бы разную высоту бара.
          height: '64px',
          padding: '0 24px',
          background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(20px)',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexShrink: 0,
        }}>
          <div style={{
            fontSize: '16px', fontWeight: 600, color: colors.textPrimary,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {page.title}
          </div>
          <span style={{
            padding: '2px 10px',
            borderRadius: radii.pill,
            background: 'rgba(0,0,0,0.05)',
            fontSize: '11px',
            fontWeight: 500,
            color: colors.textTertiary,
          }}>
            Виртуальная
          </span>
        </div>

        {/* Promote CTA */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            textAlign: 'center',
            maxWidth: '420px',
            padding: '40px',
          }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '16px',
              opacity: 0.4,
            }}>
              📄
            </div>
            <div style={{
              fontSize: '18px',
              fontWeight: 600,
              color: colors.textPrimary,
              marginBottom: '8px',
            }}>
              Страница не отслеживается
            </div>
            <div style={{
              fontSize: '14px',
              color: colors.textSecondary,
              marginBottom: '28px',
              lineHeight: 1.5,
            }}>
              Эта страница была добавлена автоматически как элемент иерархии.
              Начните отслеживание, чтобы подтянуть содержимое из Confluence
              и работать с покрытием требований.
            </div>
            <button
              onClick={handlePromote}
              disabled={promoting}
              style={{
                padding: '10px 28px',
                borderRadius: radii.pill,
                border: 'none',
                background: colors.greenAccent,
                color: '#fff',
                fontSize: '14px',
                fontWeight: 600,
                cursor: promoting ? 'default' : 'pointer',
                fontFamily: 'inherit',
                opacity: promoting ? 0.7 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {promoting ? 'Подключение...' : 'Начать отслеживание'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sortByPosition = (a: Highlight, b: Highlight) => {
    const aBlock = a.anchor_block_start ?? Infinity;
    const bBlock = b.anchor_block_start ?? Infinity;
    if (aBlock !== bBlock) return aBlock - bBlock;
    return (a.start_char_offset ?? 0) - (b.start_char_offset ?? 0);
  };

  const activeHighlights = highlights.filter(h => h.status === 'active').sort(sortByPosition);
  const outdatedHighlights = highlights.filter(h => h.status === 'outdated').sort(sortByPosition);
  const lostHighlights = highlights.filter(h => h.status === 'lost').sort(sortByPosition);
  const coveredCount = highlights.filter(h => h.tests.length > 0).length;

  // Чип статуса в верхней панели ходит по подсветкам этого статуса по кругу:
  // первый клик — к верхней, повторные — к следующей (в день актуализации
  // можно обходить только «требует проверки»). Порядок считаем в момент клика
  // по фактической позиции отрисованных <mark> в DOM — иначе legacy-привязки
  // (anchor_block_start === null) уезжали в конец якорной сортировки и чип
  // прыгал не к той подсветке.
  const jumpToStatus = (status: 'active' | 'outdated' | 'lost') => {
    const ofStatus = highlights
      .filter(h => h.status === status)
      .sort(compareByDomThenAnchor(highlightDomOrder()));
    if (ofStatus.length === 0) return;
    const currentIdx = selectedHighlight
      ? ofStatus.findIndex(h => h.id === selectedHighlight.id)
      : -1;
    const target = ofStatus[(currentIdx + 1) % ofStatus.length];
    if (status === 'lost') {
      setSelectedHighlight(target);
    } else {
      handleHighlightClick(target);
    }
  };
  const coveragePercent = highlights.length > 0
    ? Math.round((coveredCount / highlights.length) * 100)
    : 0;

  // Счётчики статусов в шапке. Показываем только те, у которых есть привязки —
  // как было раньше с чипами (нулевые статусы не выводим, ряд не «прыгает»).
  const statusCounters = ([
    {
      key: 'active', count: activeHighlights.length,
      color: colors.statusActive,
      bg: 'rgba(122,224,90,0.12)', bgHover: 'rgba(122,224,90,0.22)',
      border: 'rgba(122,224,90,0.35)',
      title: 'Актуальные привязки: тест привязан и текст не менялся. Клики ведут по ним по очереди',
    },
    {
      key: 'outdated', count: outdatedHighlights.length,
      color: colors.statusOutdated,
      bg: 'rgba(245,158,11,0.12)', bgHover: 'rgba(245,158,11,0.22)',
      border: 'rgba(245,158,11,0.35)',
      title: 'Требуют актуализации: текст изменился или привязка ещё не подтверждена. Клики ведут по ним по очереди',
    },
    {
      key: 'lost', count: lostHighlights.length,
      color: colors.statusLost,
      bg: 'rgba(239,68,68,0.12)', bgHover: 'rgba(239,68,68,0.22)',
      border: 'rgba(239,68,68,0.35)',
      title: 'Утраченные: выделенный текст больше не найден на странице. Клики ведут по ним по очереди',
    },
  ] as const).filter(s => s.count > 0);

  const formatDate = (d: string | undefined) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  };

  // Выбранная привязка не отображается на странице: либо она уже «утрачена»
  // (нет <mark> по определению), либо слой её обработал (considered), но ни
  // одной <mark> не появилось (нет в rendered) — это переходное состояние перед
  // авто-переводом в «Утрачено». Показываем только в режиме «Покрытие».
  const selectedNotOnPage =
    viewMode === 'coverage' &&
    !!selectedHighlight &&
    (selectedHighlight.status === 'lost' ||
      (!!renderReport &&
        renderReport.considered.has(selectedHighlight.id) &&
        !renderReport.rendered.has(selectedHighlight.id)));

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      <style>{contentStyles}</style>

      {/* Top bar */}
      <div style={{
        // 64px — как у шапки сайдбара: нижние линии двух баров стыкуются.
        height: '64px',
        padding: '0 24px',
        flexShrink: 0,
        background: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '16px', fontWeight: 600, color: colors.textPrimary,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {page.title}
            </div>
            <div style={{
              fontSize: '12px', color: colors.textTertiary, marginTop: '2px',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              v{page.current_snapshot?.confluence_version || '?'}
              {' · Снимок: '}{formatDate(page.current_snapshot?.fetched_at)}
              {' · Baseline: '}{formatDate(page.baseline?.confirmed_at)}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {/* Coverage indicator */}
          <div
            title={`Покрытие требований тестами: доля привязок, к которым привязан хотя бы один тест — ${coveredCount} из ${highlights.length}`}
            style={{
              padding: '9px 10px',
              borderRadius: radii.pill,
              background: 'rgba(0,0,0,0.03)',
              fontSize: '13px',
              fontWeight: 600,
              color: colors.textSecondary,
              cursor: 'help',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.07)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
          >
            Покрытие: {coveragePercent}%
          </div>

          {/* Stats — отдельные счётчики по статусам (слева направо):
              актуальные, требующие актуализации, утраченные. Цвет — по статусу,
              форма как у иконок «Обновить»/«⋮». Клики перебирают привязки
              статуса по кругу. Нулевые статусы скрыты (см. statusCounters). */}
          {statusCounters.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              {statusCounters.map(s => (
                  <button
                    key={s.key}
                    onClick={() => jumpToStatus(s.key)}
                    title={s.title}
                    style={{
                      minWidth: '34px',
                      height: '34px',
                      padding: '0 8px',
                      borderRadius: radii.md,
                      border: `1px solid ${s.border}`,
                      background: s.bg,
                      color: s.color,
                      fontSize: '13px',
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = s.bgHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = s.bg; }}
                  >
                    {s.count}
                  </button>
              ))}
            </div>
          )}

          {/* Дивайдер всегда: отделяет «Покрытие: %» (и счётчики статусов, если
              есть) от переключателя «Покрытие | Изменения» — иначе две надписи
              «Покрытие» стоят вплотную */}
          <div style={{ width: '1px', height: '24px', background: colors.border, flexShrink: 0 }} />

          {/* Mode toggle */}
          <div style={{
            display: 'flex',
            borderRadius: radii.pill,
            border: `1px solid ${colors.border}`,
            overflow: 'hidden',
          }}>
            {(['coverage', 'changes'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: '9px 10px',
                  border: 'none',
                  background: viewMode === mode ? colors.greenAccent : 'transparent',
                  color: viewMode === mode ? '#fff' : colors.textSecondary,
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  if (viewMode === mode) {
                    e.currentTarget.style.background = colors.greenDark;
                  } else {
                    e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                    e.currentTarget.style.color = colors.textPrimary;
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = viewMode === mode ? colors.greenAccent : 'transparent';
                  e.currentTarget.style.color = viewMode === mode ? '#fff' : colors.textSecondary;
                }}
              >
                {mode === 'coverage' ? 'Покрытие' : 'Изменения'}
              </button>
            ))}
          </div>

          {/* Обновить — иконка как у кнопки обновления дерева/Confluence;
              крутится, пока идёт обновление страницы */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title={refreshing ? 'Обновление…' : 'Обновить страницу из Confluence'}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: radii.md,
              border: `1px solid ${colors.border}`,
              background: colors.white,
              color: colors.textSecondary,
              cursor: refreshing ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              if (refreshing) return;
              e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
              e.currentTarget.style.borderColor = colors.borderHover;
              e.currentTarget.style.color = colors.textPrimary;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = colors.white;
              e.currentTarget.style.borderColor = colors.border;
              e.currentTarget.style.color = colors.textSecondary;
            }}
          >
            <RefreshIcon size={16} spinning={refreshing} />
          </button>

          {/* Меню действий: «Закрепить версию» (baseline) и «Удалить» */}
          <div ref={actionsMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowActionsMenu(v => !v)}
              title="Ещё действия"
              aria-haspopup="menu"
              aria-expanded={showActionsMenu}
              style={{
                width: '34px',
                height: '34px',
                borderRadius: radii.md,
                border: `1px solid ${showActionsMenu ? colors.borderHover : colors.border}`,
                background: showActionsMenu ? 'rgba(0,0,0,0.03)' : colors.white,
                color: showActionsMenu ? colors.textPrimary : colors.textSecondary,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                if (showActionsMenu) return;
                e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                e.currentTarget.style.borderColor = colors.borderHover;
                e.currentTarget.style.color = colors.textPrimary;
              }}
              onMouseLeave={e => {
                if (showActionsMenu) return;
                e.currentTarget.style.background = colors.white;
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.color = colors.textSecondary;
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}>
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </button>

            {showActionsMenu && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  minWidth: '212px',
                  padding: '6px',
                  background: colors.cardBgSolid,
                  border: `1px solid ${colors.border}`,
                  borderRadius: radii.md,
                  boxShadow: shadows.panel,
                  zIndex: 1000,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <button
                  role="menuitem"
                  title="Сделать текущую версию страницы точкой отсчёта, относительно которой считаются изменения"
                  onClick={() => { setShowActionsMenu(false); handleSetBaselineClick(); }}
                  style={{
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
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ display: 'block', flexShrink: 0, color: colors.textSecondary }}
                  >
                    <line x1="12" y1="17" x2="12" y2="22" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                  </svg>
                  Закрепить версию
                </button>

                <button
                  role="menuitem"
                  title="Удалить страницу из reqtrace со всеми снимками, baseline и привязками тестов — действие необратимо"
                  onClick={() => { setShowActionsMenu(false); setShowDeleteModal(true); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '9px 10px',
                    border: 'none',
                    background: 'transparent',
                    color: colors.statusLost,
                    fontSize: '13px',
                    fontWeight: 500,
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    borderRadius: radii.sm,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ display: 'block', flexShrink: 0 }}
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                  Удалить
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div
          ref={contentAreaRef}
          style={{
            flex: 1,
            overflow: 'auto',
            position: 'relative',
          }}
        >
          {viewMode === 'coverage' ? (
            <>
              {page.content_html ? (
                <>
                  <ContentRenderer
                    html={page.content_html}
                    onContentReady={setContentContainer}
                    suspendTableRefreeze={!!selectedHighlight}
                  />
                  <HighlightLayer
                    container={contentContainer}
                    highlights={highlights}
                    selectedHighlightId={selectedHighlight?.id || null}
                    onHighlightClick={handleHighlightClick}
                    onRenderReport={handleRenderReport}
                  />
                </>
              ) : (
                <div style={{
                  padding: '60px', textAlign: 'center',
                  color: colors.textSecondary,
                }}>
                  Нет содержимого
                </div>
              )}

              {/* Lost highlights section */}
              {lostHighlights.length > 0 && (
                <div style={{
                  margin: '0 32px 32px',
                  padding: '16px 20px',
                  background: 'rgba(239,68,68,0.03)',
                  border: `1px solid rgba(239,68,68,0.1)`,
                  borderRadius: radii.md,
                }}>
                  <div style={{
                    fontSize: '13px', fontWeight: 600,
                    color: colors.statusLost, marginBottom: '10px',
                  }}>
                    Утраченные привязки ({lostHighlights.length})
                  </div>
                  {lostHighlights.map(h => (
                    <div
                      key={h.id}
                      onClick={() => setSelectedHighlight(h)}
                      style={{
                        padding: '10px 14px',
                        background: colors.white,
                        border: `1px solid ${colors.border}`,
                        borderRadius: radii.sm,
                        marginBottom: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      <div style={{ color: colors.textPrimary, marginBottom: '4px' }}>
                        «{h.text_content.length > 80
                          ? h.text_content.slice(0, 80) + '...'
                          : h.text_content}»
                      </div>
                      {h.tests.length > 0 && (
                        <div style={{ fontSize: '12px', color: colors.textSecondary }}>
                          Тесты: {sortedTests(h.tests).map(t => t.test_key).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <DiffView pageId={pageId!} />
          )}
        </div>

        {/* Side panel — рендерится всегда: появление/скрытие панель анимирует
            сама (ширина 0↔360), при условном монтировании анимации закрытия
            не было бы — React размонтировал бы её мгновенно. */}
        <SidePanel
          highlight={selectedHighlight}
          allHighlights={highlights}
          jiraBaseUrl={jiraBaseUrl}
          notOnPage={selectedNotOnPage}
          onClose={() => setSelectedHighlight(null)}
          onAddTest={handleAddTest}
          onRemoveTest={handleRemoveTest}
          onDeleteHighlight={handleDeleteHighlight}
          onReanchor={handleReanchor}
          onNavigate={handleNavigate}
        />
      </div>

      {/* Selection popup */}
      {selection && viewMode === 'coverage' && (
        <div style={{
          position: 'fixed',
          left: selection.x,
          top: selection.y,
          transform: 'translate(-50%, -100%)',
          zIndex: 1000,
        }}>
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={handleCreateHighlight}
            style={{
              padding: '8px 16px',
              borderRadius: radii.pill,
              border: 'none',
              background: colors.greenDark,
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow: shadows.panel,
              whiteSpace: 'nowrap',
            }}
          >
            Привязать тесты
          </button>
        </div>
      )}

      {/* Baseline warning modal */}
      {showBaselineWarning && (
        <Modal title="Непроверенные привязки" onClose={() => setShowBaselineWarning(false)}>
          <p style={{ ...modalTextStyle, marginBottom: '20px' }}>
            На странице {highlights.filter(h => h.status === 'outdated').length} {' '}
            привяз{(() => {
              const n = highlights.filter(h => h.status === 'outdated').length;
              if (n === 1) return 'ка требует';
              if (n >= 2 && n <= 4) return 'ки требуют';
              return 'ок требуют';
            })()} проверки. Рекомендуется сначала актуализировать их,
            чтобы убедиться в корректности привязанных тестов.
            Вы можете закрепить baseline сейчас, но непроверенные привязки
            останутся в статусе «Требует проверки».
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <ModalButton onClick={() => setShowBaselineWarning(false)}>Отмена</ModalButton>
            <ModalButton variant="primary" onClick={handleSetBaseline}>Закрепить всё равно</ModalButton>
          </div>
        </Modal>
      )}

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <Modal
          title="Удаление страницы"
          onClose={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
        >
          <p style={{ ...modalTextStyle, marginBottom: '6px' }}>
            Вы собираетесь удалить страницу <strong style={{ color: colors.textPrimary }}>
            «{page.title}»</strong>. Это действие необратимо — все снимки, baseline и
            привязки к тестам будут удалены.
          </p>
          <p style={{ ...modalTextStyle, marginBottom: '16px' }}>
            Для подтверждения введите слово <strong style={{ color: colors.statusLost }}>Удалить</strong>
          </p>
          <input
            type="text"
            value={deleteConfirmText}
            onChange={e => setDeleteConfirmText(e.target.value)}
            placeholder="Введите «Удалить»"
            autoFocus
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: radii.sm,
              border: `1.5px solid ${deleteConfirmText === 'Удалить' ? colors.statusLost : colors.border}`,
              fontSize: '14px',
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && deleteConfirmText === 'Удалить') handleDeletePage();
            }}
          />
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
            <ModalButton onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}>
              Отмена
            </ModalButton>
            <ModalButton
              variant="danger"
              onClick={handleDeletePage}
              disabled={deleteConfirmText !== 'Удалить' || deleting}
            >
              {deleting ? 'Удаление…' : 'Удалить страницу'}
            </ModalButton>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default PageDetailPage;
