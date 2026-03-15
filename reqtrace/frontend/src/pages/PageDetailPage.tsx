import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { PageDetail, Highlight } from '../types';
import { ContentRenderer, contentStyles } from '../components/PageView/ContentRenderer';
import { HighlightLayer } from '../components/PageView/HighlightLayer';
import { SidePanel } from '../components/PageView/SidePanel';
import { DiffView } from '../components/PageView/DiffView';
import { colors, radii, shadows } from '../styles/tokens';

interface PageDetailPageProps {
  userId: string;
  jiraBaseUrl?: string;
}

type ViewMode = 'coverage' | 'changes';

export const PageDetailPage: React.FC<PageDetailPageProps> = ({ userId }) => {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();

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
  const selectionContextRef = useRef<{ textBefore: string; textAfter: string }>({
    textBefore: '', textAfter: '',
  });

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

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
    } catch (e) {
      console.error('Failed to load page', e);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => { loadPage(); }, [loadPage]);

  const handleRefresh = async () => {
    if (!pageId) return;
    setRefreshing(true);
    try {
      await api.refreshPage(pageId, userId);
      await loadPage();
    } finally {
      setRefreshing(false);
    }
  };

  const handleSetBaseline = async () => {
    if (!pageId) return;
    try {
      await api.setBaseline(pageId, userId);
      await loadPage();
    } catch (e) {
      console.error('Failed to set baseline', e);
    }
  };

  const handleHighlightClick = useCallback((h: Highlight) => {
    setSelectedHighlight(h);
  }, []);

  const handleAddTest = async (highlightId: string, testKey: string) => {
    await api.addTestLink(highlightId, testKey, userId);
    await loadPage();
    const updated = highlights.find(h => h.id === highlightId);
    if (updated) {
      const refreshed = await api.listHighlights(pageId!);
      setHighlights(refreshed);
      setSelectedHighlight(refreshed.find(h => h.id === highlightId) || null);
    }
  };

  const handleRemoveTest = async (linkId: string) => {
    await api.removeTestLink(linkId);
    await loadPage();
    if (selectedHighlight) {
      const refreshed = await api.listHighlights(pageId!);
      setHighlights(refreshed);
      setSelectedHighlight(refreshed.find(h => h.id === selectedHighlight.id) || null);
    }
  };

  const handleDeleteHighlight = async (highlightId: string) => {
    await api.deleteHighlight(highlightId);
    setSelectedHighlight(null);
    await loadPage();
  };

  const handleDeletePage = async () => {
    if (!pageId || deleteConfirmText !== 'Удалить') return;
    setDeleting(true);
    try {
      await api.deletePage(pageId);
      navigate('/');
    } catch (e) {
      console.error('Failed to delete page', e);
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

      selectionContextRef.current = {
        textBefore: fullText.substring(Math.max(0, offsetInContainer - 100), offsetInContainer),
        textAfter: fullText.substring(
          offsetInContainer + text.length,
          offsetInContainer + text.length + 100,
        ),
      };
    } else {
      selectionContextRef.current = { textBefore: '', textAfter: '' };
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

    const { textBefore, textAfter } = selectionContextRef.current;

    try {
      await api.createHighlight(pageId, {
        start_xpath: '',
        start_offset: 0,
        end_xpath: '',
        end_offset: 0,
        text_content: selectionText,
        text_before: textBefore,
        text_after: textAfter,
        user_id: userId,
      });
      window.getSelection()?.removeAllRanges();
      setShowSelectionPopup(false);
      setSelectionText('');
      selectionContextRef.current = { textBefore: '', textAfter: '' };
      await loadPage();
    } catch (e) {
      console.error('Failed to create highlight', e);
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

  const activeHighlights = highlights.filter(h => h.status === 'active');
  const outdatedHighlights = highlights.filter(h => h.status === 'outdated');
  const lostHighlights = highlights.filter(h => h.status === 'lost');
  const coveredCount = highlights.filter(h => h.tests.length > 0).length;
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
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '16px', color: colors.textSecondary, padding: '4px 8px',
            }}
          >
            ←
          </button>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: colors.textPrimary }}>
              {page.title}
            </div>
            <div style={{ fontSize: '12px', color: colors.textTertiary, marginTop: '2px' }}>
              v{page.current_snapshot?.confluence_version || '?'}
              {' · Снимок: '}{formatDate(page.current_snapshot?.fetched_at)}
              {' · Baseline: '}{formatDate(page.baseline?.confirmed_at)}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
              <span style={{
                padding: '2px 8px', borderRadius: radii.pill,
                background: 'rgba(122,224,90,0.1)', color: colors.statusActive,
                fontWeight: 600,
              }}>
                {activeHighlights.length} актуальных
              </span>
            )}
            {outdatedHighlights.length > 0 && (
              <span style={{
                padding: '2px 8px', borderRadius: radii.pill,
                background: 'rgba(245,158,11,0.1)', color: colors.statusOutdated,
                fontWeight: 600,
              }}>
                {outdatedHighlights.length} требуют проверки
              </span>
            )}
            {lostHighlights.length > 0 && (
              <span style={{
                padding: '2px 8px', borderRadius: radii.pill,
                background: 'rgba(239,68,68,0.1)', color: colors.statusLost,
                fontWeight: 600,
              }}>
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
            onClick={handleSetBaseline}
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
            jiraBaseUrl={jiraBaseUrl}
            onClose={() => setSelectedHighlight(null)}
            onAddTest={handleAddTest}
            onRemoveTest={handleRemoveTest}
            onDeleteHighlight={handleDeleteHighlight}
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
