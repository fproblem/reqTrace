import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { PageDetail, Highlight } from '../types';
import { ContentRenderer, contentStyles } from '../components/PageView/ContentRenderer';
import { HighlightLayer, getContentBlocks, highlightDomOrder, compareByDomThenAnchor } from '../components/PageView/HighlightLayer';
import { SidePanel } from '../components/PageView/SidePanel';
import { DiffView } from '../components/PageView/DiffView';
import { useToast } from '../components/Toast';
import { colors, radii, shadows } from '../styles/tokens';

interface PageDetailPageProps {
  userId: string;
  jiraBaseUrl?: string;
}

type ViewMode = 'coverage' | 'changes';

export const PageDetailPage: React.FC<PageDetailPageProps> = ({ userId }) => {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [page, setPage] = useState<PageDetail | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('coverage');
  const [selectedHighlight, setSelectedHighlight] = useState<Highlight | null>(null);
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

  const loadPage = useCallback(async () => {
    if (!pageId) return;
    try {
      const [pageData, hlData, settingsData] = await Promise.all([
        api.getPage(pageId),
        api.listHighlights(pageId),
        api.getSettings(),
      ]);
      setPage(pageData);
      setHighlights(hlData);
      setJiraBaseUrl(settingsData.jira_base_url || '');
    } catch (e: any) {
      showToast('error', 'Не удалось загрузить страницу', e.message);
    } finally {
      setLoading(false);
    }
  }, [pageId, showToast]);

  useEffect(() => { loadPage(); }, [loadPage]);

  const handleRefresh = async () => {
    if (!pageId) return;
    setRefreshing(true);
    try {
      await api.refreshPage(pageId, userId);
      await loadPage();
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
      await api.setBaseline(pageId, userId);
      await loadPage();
    } catch (e: any) {
      showToast('error', 'Не удалось закрепить baseline', e.message);
    }
  };

  const handleHighlightClick = useCallback((h: Highlight) => {
    setSelectedHighlight(h);
    scrollToHighlight(h.id);
  }, []);

  const scrollToHighlight = useCallback((highlightId: string) => {
    setTimeout(() => {
      const el = contentAreaRef.current?.querySelector(
        `[data-highlight-id="${highlightId}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
  }, []);

  const handleNavigate = useCallback((h: Highlight) => {
    setSelectedHighlight(h);
    scrollToHighlight(h.id);
  }, [scrollToHighlight]);

  const handleAddTest = async (highlightId: string, testKey: string) => {
    try {
      await api.addTestLink(highlightId, testKey, userId);
      await loadPage();
      const refreshed = await api.listHighlights(pageId!);
      setHighlights(refreshed);
      setSelectedHighlight(refreshed.find(h => h.id === highlightId) || null);
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
      await api.reanchorHighlight(highlightId, userId);
      await loadPage();
      if (pageId) {
        const refreshed = await api.listHighlights(pageId);
        setHighlights(refreshed);
        setSelectedHighlight(refreshed.find(h => h.id === highlightId) || null);
      }
    } catch (e: any) {
      showToast('error', 'Не удалось актуализировать привязку', e.message);
    }
  };

  const handleDeleteHighlight = async (highlightId: string) => {
    try {
      await api.deleteHighlight(highlightId);
      setSelectedHighlight(null);
      await loadPage();
    } catch (e: any) {
      showToast('error', 'Не удалось удалить привязку', e.message);
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
      const fullText = container.textContent || '';
      const leadingTrimmed = rawText.length - rawText.trimStart().length;

      const preRange = document.createRange();
      preRange.selectNodeContents(container);
      preRange.setEnd(range.startContainer, range.startOffset);
      const offsetInContainer = preRange.toString().length + leadingTrimmed;
      preRange.detach();

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
          const pre = document.createRange();
          pre.selectNodeContents(blocks[i]);
          pre.setEnd(range.startContainer, range.startOffset);
          startCharOffset = pre.toString().length;
          const trimDelta = rawText.length - rawText.trimStart().length;
          startCharOffset += trimDelta;
          pre.detach();
        }
        if (blocks[i].contains(range.endContainer)) {
          anchorBlockEnd = i;
          const pre = document.createRange();
          pre.selectNodeContents(blocks[i]);
          pre.setEnd(range.endContainer, range.endOffset);
          let rawEndOffset = pre.toString().length;
          const trailingTrimmed = rawText.length - rawText.trimEnd().length;
          rawEndOffset -= trailingTrimmed;
          endCharOffset = Math.max(0, rawEndOffset);
          pre.detach();
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
      await api.createHighlight(pageId, {
        text_content: selectionText,
        text_before: textBefore,
        text_after: textAfter,
        anchor_block_start: anchorBlockStart,
        anchor_block_end: anchorBlockEnd,
        start_char_offset: startCharOffset,
        end_char_offset: endCharOffset,
        user_id: userId,
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
    } catch (e: any) {
      showToast('error', 'Не удалось создать привязку', e.message);
    }
  };

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

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
        await api.promotePage(pageId, userId);
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
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '16px', color: colors.textSecondary, padding: '4px 8px',
            }}
          >
            ←
          </button>
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

  // Чип статуса в верхней панели ведёт к ВЕРХНЕЙ подсветке этого статуса.
  // Порядок считаем в момент клика по фактической позиции отрисованных <mark>
  // в DOM — иначе legacy-привязки (anchor_block_start === null) уезжали в конец
  // якорной сортировки и чип прыгал не к той подсветке.
  const jumpToFirstOfStatus = (status: 'active' | 'outdated' | 'lost') => {
    const ofStatus = highlights.filter(h => h.status === status);
    if (ofStatus.length === 0) return;
    const [first] = [...ofStatus].sort(compareByDomThenAnchor(highlightDomOrder()));
    if (status === 'lost') {
      setSelectedHighlight(first);
    } else {
      handleHighlightClick(first);
    }
  };
  const coveragePercent = highlights.length > 0
    ? Math.round((coveredCount / highlights.length) * 100)
    : 0;

  const formatDate = (d: string | undefined) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  };

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
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '16px', color: colors.textSecondary, padding: '4px 8px',
              flexShrink: 0,
            }}
          >
            ←
          </button>
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
          <div style={{
            padding: '4px 12px',
            borderRadius: radii.pill,
            background: 'rgba(0,0,0,0.03)',
            fontSize: '13px',
            fontWeight: 600,
            color: colors.textSecondary,
          }}>
            Покрытие: {coveragePercent}%
          </div>

          {/* Stats */}
          <div style={{
            display: 'flex', gap: '6px', fontSize: '12px',
          }}>
            {activeHighlights.length > 0 && (
              <span
                onClick={() => jumpToFirstOfStatus('active')}
                style={{
                  padding: '2px 8px', borderRadius: radii.pill,
                  background: 'rgba(122,224,90,0.1)', color: colors.statusActive,
                  fontWeight: 600, cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(122,224,90,0.25)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(122,224,90,0.1)'; }}
              >
                {activeHighlights.length} актуальных
              </span>
            )}
            {outdatedHighlights.length > 0 && (
              <span
                onClick={() => jumpToFirstOfStatus('outdated')}
                style={{
                  padding: '2px 8px', borderRadius: radii.pill,
                  background: 'rgba(245,158,11,0.1)', color: colors.statusOutdated,
                  fontWeight: 600, cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.25)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.1)'; }}
              >
                {outdatedHighlights.length} требуют проверки
              </span>
            )}
            {lostHighlights.length > 0 && (
              <span
                onClick={() => jumpToFirstOfStatus('lost')}
                style={{
                  padding: '2px 8px', borderRadius: radii.pill,
                  background: 'rgba(239,68,68,0.1)', color: colors.statusLost,
                  fontWeight: 600, cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.25)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
              >
                {lostHighlights.length} утрачено
              </span>
            )}
          </div>

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
                  padding: '6px 14px',
                  border: 'none',
                  background: viewMode === mode ? colors.greenAccent : 'transparent',
                  color: viewMode === mode ? '#fff' : colors.textSecondary,
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
              >
                {mode === 'coverage' ? 'Покрытие' : 'Изменения'}
              </button>
            ))}
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              padding: '7px 16px',
              borderRadius: radii.pill,
              border: `1px solid ${colors.border}`,
              background: colors.white,
              color: colors.textPrimary,
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {refreshing ? 'Обновление...' : 'Обновить'}
          </button>

          <button
            onClick={handleSetBaselineClick}
            style={{
              padding: '7px 16px',
              borderRadius: radii.pill,
              border: 'none',
              background: colors.greenAccent,
              color: '#fff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Закрепить baseline
          </button>

          <button
            onClick={() => setShowDeleteModal(true)}
            style={{
              padding: '7px 16px',
              borderRadius: radii.pill,
              border: `1px solid rgba(239,68,68,0.3)`,
              background: 'rgba(239,68,68,0.05)',
              color: colors.statusLost,
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
              e.currentTarget.style.borderColor = 'rgba(239,68,68,0.5)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(239,68,68,0.05)';
              e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)';
            }}
          >
            Удалить
          </button>
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
                    highlights={highlights.filter(h => h.status !== 'lost')}
                    selectedHighlightId={selectedHighlight?.id || null}
                    onHighlightClick={handleHighlightClick}
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

        {/* Side panel */}
        {selectedHighlight && (
          <SidePanel
            highlight={selectedHighlight}
            allHighlights={highlights}
            jiraBaseUrl={jiraBaseUrl}
            onClose={() => setSelectedHighlight(null)}
            onAddTest={handleAddTest}
            onRemoveTest={handleRemoveTest}
            onDeleteHighlight={handleDeleteHighlight}
            onReanchor={handleReanchor}
            onNavigate={handleNavigate}
          />
        )}
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
        <div
          onClick={() => setShowBaselineWarning(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: colors.white,
              borderRadius: radii.lg,
              padding: '28px 32px',
              width: '440px',
              maxWidth: '90vw',
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
            }}
          >
            <div style={{
              fontSize: '17px',
              fontWeight: 700,
              color: colors.textPrimary,
              marginBottom: '8px',
            }}>
              Непроверенные привязки
            </div>
            <div style={{
              fontSize: '13px',
              color: colors.textSecondary,
              lineHeight: 1.6,
              marginBottom: '20px',
            }}>
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
            </div>
            <div style={{
              display: 'flex',
              gap: '10px',
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => setShowBaselineWarning(false)}
                style={{
                  padding: '9px 20px',
                  borderRadius: radii.pill,
                  border: `1px solid ${colors.border}`,
                  background: colors.white,
                  color: colors.textPrimary,
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Отмена
              </button>
              <button
                onClick={handleSetBaseline}
                style={{
                  padding: '9px 20px',
                  borderRadius: radii.pill,
                  border: 'none',
                  background: colors.greenAccent,
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Закрепить всё равно
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div
          onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: colors.white,
              borderRadius: radii.lg,
              padding: '28px 32px',
              width: '420px',
              maxWidth: '90vw',
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
            }}
          >
            <div style={{
              fontSize: '17px',
              fontWeight: 700,
              color: colors.textPrimary,
              marginBottom: '8px',
            }}>
              Удаление страницы
            </div>
            <div style={{
              fontSize: '13px',
              color: colors.textSecondary,
              lineHeight: 1.5,
              marginBottom: '6px',
            }}>
              Вы собираетесь удалить страницу <strong style={{ color: colors.textPrimary }}>
              «{page.title}»</strong>. Это действие необратимо — все снимки, baseline и
              привязки к тестам будут удалены.
            </div>
            <div style={{
              fontSize: '13px',
              color: colors.textSecondary,
              marginBottom: '16px',
            }}>
              Для подтверждения введите слово <strong style={{ color: colors.statusLost }}>Удалить</strong>
            </div>
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
                if (e.key === 'Escape') { setShowDeleteModal(false); setDeleteConfirmText(''); }
              }}
            />
            <div style={{
              display: 'flex',
              gap: '10px',
              marginTop: '20px',
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
                style={{
                  padding: '9px 20px',
                  borderRadius: radii.pill,
                  border: `1px solid ${colors.border}`,
                  background: colors.white,
                  color: colors.textPrimary,
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Отмена
              </button>
              <button
                onClick={handleDeletePage}
                disabled={deleteConfirmText !== 'Удалить' || deleting}
                style={{
                  padding: '9px 20px',
                  borderRadius: radii.pill,
                  border: 'none',
                  background: deleteConfirmText === 'Удалить' ? '#EF4444' : 'rgba(239,68,68,0.3)',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: deleteConfirmText === 'Удалить' ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                  opacity: deleting ? 0.7 : 1,
                }}
              >
                {deleting ? 'Удаление...' : 'Удалить страницу'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PageDetailPage;
