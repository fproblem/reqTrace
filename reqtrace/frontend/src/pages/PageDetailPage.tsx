import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { PageDetail, Highlight } from '../types';
import { ContentRenderer, contentStyles } from '../components/PageView/ContentRenderer';
import { HighlightLayer, getContentBlocks, highlightDomOrder, compareByDomThenAnchor } from '../components/PageView/HighlightLayer';
import type { HighlightRenderReport } from '../components/PageView/HighlightLayer';
import { SidePanel, PANEL_ANIM_MS } from '../components/PageView/SidePanel';
import { DiffView } from '../components/PageView/DiffView';
import { Modal, ModalButton, modalTextStyle } from '../components/Modal';
import { RefreshIcon } from '../components/RefreshIcon';
import { useToast } from '../components/Toast';
import { colors, radii, shadows } from '../styles/tokens';

interface PageDetailPageProps {
  jiraBaseUrl?: string;
}

type ViewMode = 'coverage' | 'changes';

// Длина «сырого» текста (textContent), как его считает HighlightLayer при
// отрисовке, от начала root до точки (node, offset). Берём
// cloneContents().textContent, а НЕ Range.toString(): toString отдаёт
// «отрендеренный» текст (<br> → \n, схлопывание пробелов), из-за чего смещения
// захвата расходились со смещениями отрисовки — подсветка уезжала или вовсе не
// появлялась. cloneContents().textContent совпадает с обходом текстовых узлов
// в wrapTextNodesInRange.
function measureTextOffset(root: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, offset);
  const len = r.cloneContents().textContent?.length ?? 0;
  r.detach();
  return len;
}

function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  let equal = true;
  a.forEach(id => { if (!b.has(id)) equal = false; });
  return equal;
}

function sameRenderReport(a: HighlightRenderReport | null, b: HighlightRenderReport): boolean {
  return !!a && sameIdSet(a.rendered, b.rendered) && sameIdSet(a.considered, b.considered);
}

export const PageDetailPage: React.FC<PageDetailPageProps> = () => {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();
  const { showToast, showUndoToast, dismissToast } = useToast();

  const [page, setPage] = useState<PageDetail | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('coverage');
  const [selectedHighlight, setSelectedHighlight] = useState<Highlight | null>(null);
  const [renderReport, setRenderReport] = useState<HighlightRenderReport | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [contentContainer, setContentContainer] = useState<HTMLDivElement | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');

  const [selectionText, setSelectionText] = useState('');
  const [showSelectionPopup, setShowSelectionPopup] = useState(false);
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 });
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const contentContainerRef = useRef<HTMLDivElement | null>(null);
  const selectionContextRef = useRef<{
    textBefore: string;
    textAfter: string;
    anchorBlockStart: number | null;
    anchorBlockEnd: number | null;
    startCharOffset: number | null;
    endCharOffset: number | null;
  }>({
    textBefore: '', textAfter: '',
    anchorBlockStart: null, anchorBlockEnd: null,
    startCharOffset: null, endCharOffset: null,
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

  useEffect(() => { loadPage(); }, [loadPage]);

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
        // Автоперехода к следующему «Требует проверки» здесь сознательно НЕТ:
        // пробовали (c21b3dfc) — на тесте прыжок панели дезориентировал.
        // Обход по статусу остаётся ручным (плашка статуса/чипы), а завершение
        // обхода отмечаем тостом.
        if (!refreshed.some(h => h.status === 'outdated')) {
          showToast('success', 'Все привязки проверены', 'Выделений в статусе «Требует проверки» не осталось');
        }
      }
    } catch (e: any) {
      showToast('error', 'Не удалось актуализировать привязку', e.message);
    }
  };

  // Отложенное удаление выделения: с экрана оно исчезает сразу, но DELETE
  // уходит на сервер только когда undo-тост дотикал до конца. «Отменить»
  // просто перечитывает привязки — сервер ещё ничего не удалял. Одновременно
  // живёт одно отложенное удаление: новое немедленно коммитит предыдущее.
  const pendingDeleteRef = useRef<{ toastId: number; commit: () => void } | null>(null);

  const handleDeleteHighlight = async (highlightId: string) => {
    if (pendingDeleteRef.current) {
      const prev = pendingDeleteRef.current;
      pendingDeleteRef.current = null;
      dismissToast(prev.toastId);
      prev.commit();
    }

    setSelectedHighlight(null);
    setHighlights(prev => prev.filter(h => h.id !== highlightId));

    const restore = async () => {
      pendingDeleteRef.current = null;
      try {
        const refreshed = await api.listHighlights(pageId!);
        setHighlights(refreshed);
      } catch (e: any) {
        showToast('error', 'Не удалось восстановить привязку', e.message);
      }
    };

    const commit = () => {
      pendingDeleteRef.current = null;
      api.deleteHighlight(highlightId).catch((e: any) => {
        showToast('error', 'Не удалось удалить привязку', e.message);
        void restore();
      });
    };

    // Без message: про удаление связей с тестами уже предупредила карточка
    // подтверждения в панели — в тосте хватает заголовка.
    const toastId = showUndoToast('warning', 'Выделение удалено', {
      seconds: 7,
      actionLabel: 'Отменить',
      onExpire: commit,
      onAction: restore,
    });
    pendingDeleteRef.current = { toastId, commit };
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

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setShowSelectionPopup(false);
      return;
    }

    const rawText = selection.toString();
    const text = rawText.trim();
    if (!text || text.length < 2) {
      setShowSelectionPopup(false);
      return;
    }

    if (contentAreaRef.current && !contentAreaRef.current.contains(selection.anchorNode)) {
      setShowSelectionPopup(false);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const container = contentContainerRef.current;
    if (container) {
      // Обе границы выделения должны лежать ВНУТРИ контейнера с контентом.
      // Ранняя проверка выше валидирует contentAreaRef (внешнюю обёртку, куда
      // попадает и секция «Утраченные привязки», и заголовок), а смещения
      // считаются по contentContainerRef. Без этой проверки measureTextOffset
      // (Range.setEnd) бросил бы InvalidNodeTypeError и весь обработчик
      // оборвался бы без появления кнопки «Привязать тесты».
      if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
        setShowSelectionPopup(false);
        return;
      }

      const fullText = container.textContent || '';
      const leadingTrimmed = rawText.length - rawText.trimStart().length;

      const offsetInContainer =
        measureTextOffset(container, range.startContainer, range.startOffset) + leadingTrimmed;

      const textBefore = fullText.substring(Math.max(0, offsetInContainer - 100), offsetInContainer);
      const textAfter = fullText.substring(
        offsetInContainer + text.length,
        offsetInContainer + text.length + 100,
      );

      const blocks = getContentBlocks(container);
      let anchorBlockStart = -1;
      let anchorBlockEnd = -1;
      let startCharOffset = 0;
      let endCharOffset = 0;

      for (let i = 0; i < blocks.length; i++) {
        if (anchorBlockStart === -1 && blocks[i].contains(range.startContainer)) {
          anchorBlockStart = i;
          startCharOffset = measureTextOffset(blocks[i], range.startContainer, range.startOffset);
          const trimDelta = rawText.length - rawText.trimStart().length;
          startCharOffset += trimDelta;
        }
        if (blocks[i].contains(range.endContainer)) {
          anchorBlockEnd = i;
          let rawEndOffset = measureTextOffset(blocks[i], range.endContainer, range.endOffset);
          const trailingTrimmed = rawText.length - rawText.trimEnd().length;
          rawEndOffset -= trailingTrimmed;
          endCharOffset = Math.max(0, rawEndOffset);
          break;
        }
      }

      // Если хотя бы одна граница выделения не попала в листовой блок
      // (текст лежит в нелистовом <li>/<td>/<blockquote> либо граница пришлась
      // на контейнерный <ul>/<ol> или пробельный узел) — НЕ привязываем
      // подсветку к блоку 0. Раньше именно этот фолбэк «улетал» в начало
      // страницы. Вместо этого сохраняем без блочных якорей: подсветку
      // корректно разместит текстовый поиск (applyLegacyTextSearch) по
      // text_content и контексту text_before/text_after.
      const blockAnchored = anchorBlockStart !== -1 && anchorBlockEnd !== -1;

      selectionContextRef.current = {
        textBefore,
        textAfter,
        anchorBlockStart: blockAnchored ? anchorBlockStart : null,
        anchorBlockEnd: blockAnchored ? anchorBlockEnd : null,
        startCharOffset: blockAnchored ? startCharOffset : null,
        endCharOffset: blockAnchored ? endCharOffset : null,
      };
    } else {
      selectionContextRef.current = {
        textBefore: '', textAfter: '',
        anchorBlockStart: null, anchorBlockEnd: null,
        startCharOffset: null, endCharOffset: null,
      };
    }

    setSelectionText(text);
    setPopupPos({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
    setShowSelectionPopup(true);
  }, []);

  const handleCreateHighlight = async () => {
    if (!pageId || !selectionText) return;

    const { textBefore, textAfter, anchorBlockStart, anchorBlockEnd, startCharOffset, endCharOffset } =
      selectionContextRef.current;

    try {
      const created = await api.createHighlight(pageId, {
        text_content: selectionText,
        text_before: textBefore,
        text_after: textAfter,
        anchor_block_start: anchorBlockStart,
        anchor_block_end: anchorBlockEnd,
        start_char_offset: startCharOffset,
        end_char_offset: endCharOffset,
      });
      window.getSelection()?.removeAllRanges();
      setShowSelectionPopup(false);
      setSelectionText('');
      selectionContextRef.current = {
        textBefore: '', textAfter: '',
        anchorBlockStart: null, anchorBlockEnd: null,
        startCharOffset: null, endCharOffset: null,
      };
      await loadPage();
      // Сразу открываем боковую панель на созданной привязке: кнопка обещает
      // «Привязать тесты», поэтому пользователь должен сразу получить форму
      // привязки, а не искать бледную метку «Требует проверки» на странице.
      setSelectedHighlight(created);
      pendingScrollHighlightRef.current = created.id;
    } catch (e: any) {
      showToast('error', 'Не удалось создать привязку', e.message);
    }
  };

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  // Синхронизируем статус «Утрачено» с фактической отрисовкой:
  //  • привязку обработали, но ни одной <mark> не появилось → «Утрачено»
  //    (видно в секции внизу и в чипе «утрачено» вверху);
  //  • ранее утраченная привязка снова легла на страницу (в т.ч. «разрывом»
  //    после правки) → возвращаем в «Требует проверки».
  // Статус пишем в БД best-effort (эндпоинты идемпотентны), локально — сразу.
  useEffect(() => {
    if (!renderReport) return;
    const { rendered, considered } = renderReport;

    const toLose: string[] = [];
    const toRecover: string[] = [];
    highlights.forEach(h => {
      if (!considered.has(h.id)) return;
      const isRendered = rendered.has(h.id);
      if (!isRendered && h.status !== 'lost') toLose.push(h.id);
      else if (isRendered && h.status === 'lost') toRecover.push(h.id);
    });
    if (toLose.length === 0 && toRecover.length === 0) return;

    const apply = (h: Highlight): Highlight => {
      if (toLose.indexOf(h.id) !== -1) return { ...h, status: 'lost' };
      if (toRecover.indexOf(h.id) !== -1) return { ...h, status: 'outdated' };
      return h;
    };
    setHighlights(prev => prev.map(apply));
    setSelectedHighlight(prev => (prev ? apply(prev) : prev));

    toLose.forEach(id => { api.markHighlightLost(id).catch(() => {}); });
    toRecover.forEach(id => { api.unmarkHighlightLost(id).catch(() => {}); });
  }, [renderReport, highlights]);

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
          padding: '14px 24px',
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
        padding: '14px 24px',
        background: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
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
                          Тесты: {h.tests.map(t => t.test_key).join(', ')}
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
      {showSelectionPopup && viewMode === 'coverage' && (
        <div style={{
          position: 'fixed',
          left: popupPos.x,
          top: popupPos.y,
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
