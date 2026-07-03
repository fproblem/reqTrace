import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../../api/client';
import { Project, ProjectTree, SpaceTree, TreeNodeItem } from '../../types';
import { useToast } from '../Toast';
import { colors, radii } from '../../styles/tokens';

const TREE_STATE_KEY = 'reqtrace_tree_state';

function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: colors.yellowHighlight, borderRadius: '2px', padding: '0 1px' }}>
        {text.slice(idx, idx + q.length)}
      </span>
      {text.slice(idx + q.length)}
    </>
  );
}

function loadExpandState(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(TREE_STATE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveExpandState(state: Record<string, boolean>) {
  localStorage.setItem(TREE_STATE_KEY, JSON.stringify(state));
}

// Клиентское зеркало серверной нормализации base URL (project_access.py):
// нужно, чтобы при добавлении страницы заранее понять, каким проектам
// подходит ссылка, и показать выбор проекта, если их несколько.
function normalizeBaseUrl(url: string): string {
  let u = (url || '').trim();
  if (!u) return '';
  if (!u.includes('://')) u = 'https://' + u;
  try {
    const p = new URL(u);
    const port = p.port ? `:${p.port}` : '';
    const path = p.pathname.replace(/\/+$/, '');
    return `${p.protocol}//${p.hostname.toLowerCase()}${port}${path}`;
  } catch {
    return '';
  }
}

function urlBelongsToBase(pageUrl: string, baseUrl: string): boolean {
  if (!baseUrl) return false;
  const base = normalizeBaseUrl(baseUrl);
  const page = normalizeBaseUrl(pageUrl);
  return base !== '' && (page === base || page.startsWith(base + '/'));
}

interface PageTreeProps {
  onPageAdded?: () => void;
}

export const PageTree: React.FC<PageTreeProps> = ({ onPageAdded }) => {
  const [projects, setProjects] = useState<ProjectTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandState, setExpandState] = useState<Record<string, boolean>>(loadExpandState);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  // Список проектов с base URL — для выбора проекта при добавлении страницы.
  const [myProjects, setMyProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  const loadTree = useCallback(async () => {
    try {
      const data = await api.getPageTree();
      setProjects(data);
    } catch (e: any) {
      showToast('error', 'Не удалось загрузить дерево страниц', e.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // Refetch tree on mount and when route changes (covers delete, refresh scenarios)
  useEffect(() => { loadTree(); }, [location.pathname, loadTree]);

  // Проекты с кредами подтягиваются при открытии формы добавления.
  useEffect(() => {
    if (!showAddForm) return;
    api.listProjects()
      .then(setMyProjects)
      .catch(() => setMyProjects([]));
  }, [showAddForm]);

  // Проекты текущего пользователя, которым подходит введённая ссылка.
  const candidateProjects = useMemo(() => {
    const url = newUrl.trim();
    if (!url) return [];
    return myProjects.filter(
      p => p.joined && p.my_status === 'ok' && urlBelongsToBase(url, p.confluence_base_url)
    );
  }, [newUrl, myProjects]);

  useEffect(() => {
    if (candidateProjects.length > 0 && !candidateProjects.some(p => p.id === selectedProjectId)) {
      setSelectedProjectId(candidateProjects[0].id);
    }
  }, [candidateProjects, selectedProjectId]);

  const toggleExpand = useCallback((key: string) => {
    setExpandState(prev => {
      // Default is collapsed, so undefined → expand (true)
      const current = prev[key] === true;
      const next = { ...prev, [key]: !current };
      saveExpandState(next);
      return next;
    });
  }, []);

  const handleAddPage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    setAdding(true);
    setError('');
    try {
      const projectId = candidateProjects.length > 1 ? selectedProjectId : undefined;
      const page = await api.addPage(newUrl.trim(), projectId);
      setNewUrl('');
      setShowAddForm(false);
      await loadTree();
      navigate(`/pages/${page.id}`);
      onPageAdded?.();
    } catch (e: any) {
      const msg = e.message || 'Ошибка при добавлении';
      setError(msg);
      showToast('error', 'Не удалось добавить страницу', msg);
    } finally {
      setAdding(false);
    }
  };

  const handleAddDemo = async () => {
    try {
      const page = await api.addDemoPage();
      await loadTree();
      navigate(`/pages/${page.id}`);
    } catch (e: any) {
      showToast('error', 'Не удалось добавить демо-страницу', e.message);
    }
  };

  const handleSyncTree = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await api.syncTree();
      await loadTree();

      const parts: string[] = [];
      if (res.moved) parts.push(`перемещено: ${res.moved}`);
      if (res.added) parts.push(`добавлено: ${res.added}`);
      if (res.removed) parts.push(`удалено: ${res.removed}`);

      if (parts.length === 0) {
        showToast('success', 'Структура актуальна', 'Изменений в иерархии не найдено');
      } else {
        showToast('success', 'Структура синхронизирована', parts.join(', '));
      }

      if (res.missing_tracked) {
        showToast(
          'warning',
          'Часть страниц отсутствует в Confluence',
          `Отслеживаемых страниц без аналога в Confluence: ${res.missing_tracked}. Они сохранены, проверьте их вручную`,
        );
      }
    } catch (e: any) {
      showToast('error', 'Не удалось синхронизировать структуру', e.message);
    } finally {
      setSyncing(false);
    }
  };

  const activePageId = useMemo(() => {
    const match = location.pathname.match(/^\/pages\/(.+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const filterSpace = useCallback((space: SpaceTree, q: string): SpaceTree | null => {
    const matched = new Set<string>();
    for (const page of space.pages) {
      if (page.title.toLowerCase().includes(q)) {
        matched.add(page.confluence_page_id);
      }
    }
    if (matched.size === 0) return null;

    // Include ancestors of matched pages so the tree stays connected
    const cpidToPage = new Map(space.pages.map(p => [p.confluence_page_id, p]));
    const withAncestors = new Set(matched);
    Array.from(matched).forEach(cpid => {
      let current = cpidToPage.get(cpid);
      while (current?.parent_confluence_page_id) {
        if (withAncestors.has(current.parent_confluence_page_id)) break;
        withAncestors.add(current.parent_confluence_page_id);
        current = cpidToPage.get(current.parent_confluence_page_id);
      }
    });

    return {
      ...space,
      pages: space.pages.filter(p => withAncestors.has(p.confluence_page_id)),
    };
  }, []);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects;

    return projects
      .map(project => {
        if (project.no_access) return null; // содержимое закрыто — не ищется
        const spaces = project.spaces
          .map(space => filterSpace(space, q))
          .filter((s): s is SpaceTree => s !== null);
        if (spaces.length === 0) return null;
        return { ...project, spaces } as ProjectTree;
      })
      .filter((p): p is ProjectTree => p !== null);
  }, [projects, searchQuery, filterSpace]);

  const isSearching = searchQuery.trim().length > 0;

  const hasAnyPages = projects.some(p => p.spaces.some(s => s.pages.length > 0));
  const isEmptySearch = isSearching && filteredProjects.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{`
        @keyframes reqtrace-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 4px',
        marginBottom: '8px',
      }}>
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          color: colors.textTertiary,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          Проекты
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button
            onClick={handleSyncTree}
            disabled={syncing}
            title="Синхронизировать структуру с Confluence (перенос/добавление страниц)"
            style={{
              width: '22px',
              height: '22px',
              borderRadius: radii.sm,
              border: 'none',
              background: 'transparent',
              color: colors.textSecondary,
              cursor: syncing ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                display: 'block',
                animation: syncing ? 'reqtrace-spin 0.8s linear infinite' : undefined,
              }}
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            title="Добавить страницу"
            style={{
              width: '22px',
              height: '22px',
              borderRadius: radii.sm,
              border: 'none',
              background: showAddForm ? colors.greenLight : 'transparent',
              color: showAddForm ? colors.greenDark : colors.textSecondary,
              fontSize: '16px',
              lineHeight: '22px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <form onSubmit={handleAddPage} style={{ marginBottom: '10px', padding: '0 4px' }}>
          <input
            type="text"
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            placeholder="Confluence URL..."
            autoFocus
            style={{
              width: '100%',
              padding: '6px 8px',
              borderRadius: radii.sm,
              border: `1px solid ${colors.border}`,
              fontSize: '12px',
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
              marginBottom: '6px',
            }}
          />
          {/* Ссылка подходит нескольким проектам (общий сервер) — явный выбор */}
          {candidateProjects.length > 1 && (
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              title="Проект, в который добавить страницу"
              style={{
                width: '100%',
                padding: '6px 8px',
                borderRadius: radii.sm,
                border: `1px solid ${colors.border}`,
                fontSize: '12px',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: '6px',
                background: colors.white,
              }}
            >
              {candidateProjects.map(p => (
                <option key={p.id} value={p.id}>В проект: {p.name}</option>
              ))}
            </select>
          )}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="submit"
              disabled={!newUrl.trim() || adding}
              style={{
                flex: 1,
                padding: '4px 8px',
                borderRadius: radii.sm,
                border: 'none',
                background: colors.greenAccent,
                color: '#fff',
                fontSize: '11px',
                fontWeight: 600,
                cursor: newUrl.trim() && !adding ? 'pointer' : 'default',
                fontFamily: 'inherit',
                opacity: !newUrl.trim() || adding ? 0.5 : 1,
              }}
            >
              {adding ? '...' : 'Добавить'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setNewUrl(''); setError(''); }}
              style={{
                padding: '4px 8px',
                borderRadius: radii.sm,
                border: `1px solid ${colors.border}`,
                background: 'transparent',
                color: colors.textSecondary,
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Отмена
            </button>
          </div>
          {error && (
            <div style={{ color: colors.statusLost, fontSize: '11px', marginTop: '4px' }}>
              {error}
            </div>
          )}
        </form>
      )}

      {/* Search */}
      {!loading && hasAnyPages && (
        <div style={{ padding: '0 4px', marginBottom: '8px', position: 'relative' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Найти страницу..."
            style={{
              width: '100%',
              padding: '6px 26px 6px 8px',
              borderRadius: radii.sm,
              border: `1px solid ${colors.border}`,
              fontSize: '12px',
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = colors.greenAccent; }}
            onBlur={e => { e.currentTarget.style.borderColor = colors.border; }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: colors.textTertiary,
                fontSize: '14px',
                padding: '0 2px',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Tree content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '20px 4px', color: colors.textTertiary, fontSize: '12px' }}>
            Загрузка...
          </div>
        ) : projects.length === 0 ? (
          <div style={{ padding: '20px 4px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.3 }}>📄</div>
            <div style={{ fontSize: '12px', color: colors.textTertiary, marginBottom: '12px' }}>
              Нет проектов. Подключите проект в настройках — или попробуйте демо-страницу
            </div>
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
              <button
                onClick={() => navigate('/settings')}
                style={{
                  padding: '6px 12px',
                  borderRadius: radii.sm,
                  border: 'none',
                  background: colors.greenAccent,
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                В настройки
              </button>
              <button
                onClick={handleAddDemo}
                style={{
                  padding: '6px 12px',
                  borderRadius: radii.sm,
                  border: `1px solid ${colors.border}`,
                  background: 'transparent',
                  color: colors.textSecondary,
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Демо-страница
              </button>
            </div>
          </div>
        ) : !hasAnyPages && projects.every(p => !p.no_access) ? (
          <div style={{ padding: '20px 4px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.3 }}>📄</div>
            <div style={{ fontSize: '12px', color: colors.textTertiary, marginBottom: '12px' }}>
              Нет страниц
            </div>
            <button
              onClick={handleAddDemo}
              style={{
                padding: '6px 12px',
                borderRadius: radii.sm,
                border: `1px solid ${colors.border}`,
                background: 'transparent',
                color: colors.textSecondary,
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Демо-страница
            </button>
          </div>
        ) : isEmptySearch ? (
          <div style={{ padding: '12px 4px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: colors.textTertiary }}>
              Ничего не найдено
            </div>
          </div>
        ) : (
          filteredProjects.map(project => (
            <ProjectNode
              key={project.project_id}
              project={project}
              expandState={expandState}
              toggleExpand={toggleExpand}
              activePageId={activePageId}
              navigate={navigate}
              isSearching={isSearching}
              searchQuery={searchQuery}
            />
          ))
        )}
      </div>
    </div>
  );
};

// --- Project node (верхний уровень дерева) ---

interface ProjectNodeProps {
  project: ProjectTree;
  expandState: Record<string, boolean>;
  toggleExpand: (key: string) => void;
  activePageId: string | null;
  navigate: (path: string) => void;
  isSearching: boolean;
  searchQuery: string;
}

const ProjectNode: React.FC<ProjectNodeProps> = ({
  project, expandState, toggleExpand, activePageId, navigate, isSearching, searchQuery,
}) => {
  const projectKey = `project:${project.project_id}`;
  const isExpanded = isSearching || expandState[projectKey] === true;

  if (project.no_access) {
    // Замок: креды невалидны — содержимое закрыто, клик ведёт в настройки.
    return (
      <div style={{ marginBottom: '4px' }}>
        <button
          onClick={() => navigate('/settings')}
          title={`Нет доступа к проекту «${project.project_name}» — Confluence отклонил ваши логин/пароль. Нажмите, чтобы обновить креды в настройках`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            width: '100%',
            padding: '5px 4px',
            border: 'none',
            borderRadius: radii.sm,
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: '11px', flexShrink: 0 }}>🔒</span>
          <span style={{
            fontSize: '12.5px',
            fontWeight: 600,
            color: colors.textTertiary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}>
            {project.project_name}
          </span>
          <span style={{ fontSize: '10px', color: colors.textTertiary, flexShrink: 0 }}>
            нет доступа
          </span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '6px' }}>
      <button
        onClick={() => toggleExpand(projectKey)}
        title={project.project_name}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          width: '100%',
          padding: '5px 4px',
          border: 'none',
          borderRadius: radii.sm,
          background: 'transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <span style={{
          fontSize: '10px',
          color: colors.textTertiary,
          transition: 'transform 0.15s',
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          display: 'inline-block',
          flexShrink: 0,
        }}>
          ▶
        </span>
        <span style={{
          fontSize: '12.5px',
          fontWeight: 700,
          color: colors.textPrimary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}>
          {project.project_name}
        </span>
      </button>
      {isExpanded && (
        <div style={{ marginLeft: '8px' }}>
          {project.spaces.map(space => (
            <SpaceNode
              key={space.space_key}
              projectId={project.project_id}
              space={space}
              expandState={expandState}
              toggleExpand={toggleExpand}
              activePageId={activePageId}
              navigate={navigate}
              isSearching={isSearching}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// --- Space node ---

interface SpaceNodeProps {
  projectId: string;
  space: SpaceTree;
  expandState: Record<string, boolean>;
  toggleExpand: (key: string) => void;
  activePageId: string | null;
  navigate: (path: string) => void;
  isSearching: boolean;
  searchQuery: string;
}

const SpaceNode: React.FC<SpaceNodeProps> = ({ projectId, space, expandState, toggleExpand, activePageId, navigate, isSearching, searchQuery }) => {
  const spaceKey = `space:${projectId}:${space.space_key}`;
  const isExpanded = isSearching || expandState[spaceKey] === true; // collapsed by default; force expand when searching

  // Build children map
  const childrenMap = useMemo(() => {
    const map: Record<string, TreeNodeItem[]> = { __roots__: [] };
    for (const page of space.pages) {
      if (!page.parent_confluence_page_id) {
        map.__roots__.push(page);
      } else {
        const parentKey = page.parent_confluence_page_id;
        if (!map[parentKey]) map[parentKey] = [];
        map[parentKey].push(page);
      }
    }

    // Pages whose parent is not in this space's page list → treat as roots
    const allCpids = new Set(space.pages.map(p => p.confluence_page_id));
    for (const page of space.pages) {
      if (page.parent_confluence_page_id && !allCpids.has(page.parent_confluence_page_id)) {
        // Parent not in this space, move to roots
        const parentKey = page.parent_confluence_page_id;
        const arr = map[parentKey];
        if (arr) {
          const idx = arr.indexOf(page);
          if (idx !== -1) arr.splice(idx, 1);
          if (arr.length === 0) delete map[parentKey];
        }
        map.__roots__.push(page);
      }
    }

    return map;
  }, [space.pages]);

  return (
    <div style={{ marginBottom: '4px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '2px 4px',
      }}>
        <button
          onClick={() => toggleExpand(spaceKey)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            flex: 1,
            minWidth: 0,
            padding: '4px 0',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          <span style={{
            fontSize: '10px',
            color: colors.textTertiary,
            transition: 'transform 0.15s',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            display: 'inline-block',
          }}>
            ▶
          </span>
          <span style={{
            fontSize: '12px',
            fontWeight: 600,
            color: colors.textSecondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {space.space_key}
          </span>
        </button>
      </div>
      {isExpanded && (
        <div>
          {childrenMap.__roots__.map(node => (
            <TreeNodeComponent
              key={node.id}
              node={node}
              childrenMap={childrenMap}
              depth={0}
              expandState={expandState}
              toggleExpand={toggleExpand}
              activePageId={activePageId}
              navigate={navigate}
              isSearching={isSearching}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// --- Tree node ---

interface TreeNodeProps {
  node: TreeNodeItem;
  childrenMap: Record<string, TreeNodeItem[]>;
  depth: number;
  expandState: Record<string, boolean>;
  toggleExpand: (key: string) => void;
  activePageId: string | null;
  navigate: (path: string) => void;
  isSearching: boolean;
  searchQuery: string;
}

const TreeNodeComponent: React.FC<TreeNodeProps> = React.memo(({
  node, childrenMap, depth, expandState, toggleExpand, activePageId, navigate, isSearching, searchQuery,
}) => {
  const children = childrenMap[node.confluence_page_id] || [];
  const hasChildren = children.length > 0;
  const nodeKey = `page:${node.confluence_page_id}`;
  const isExpanded = hasChildren && (isSearching || expandState[nodeKey] === true);
  const isActive = activePageId === node.id;

  const handleClick = () => {
    if (node.is_virtual) {
      navigate(`/pages/${node.id}`);
      if (hasChildren) toggleExpand(nodeKey);
    } else {
      navigate(`/pages/${node.id}`);
    }
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleExpand(nodeKey);
  };

  // Точка — худший статус привязок страницы: утрачено > требует проверки >
  // актуально. Нет привязок (или виртуальная страница) — нет точки.
  const statusDotColor = node.is_virtual ? undefined
    : node.highlights_lost > 0 ? colors.statusLost
    : node.highlights_outdated > 0 ? colors.statusOutdated
    : node.highlights_active > 0 ? colors.statusActive
    : undefined;

  const breakdown = [
    node.highlights_active > 0 && `актуально: ${node.highlights_active}`,
    node.highlights_outdated > 0 && `требует проверки: ${node.highlights_outdated}`,
    node.highlights_lost > 0 && `утрачено: ${node.highlights_lost}`,
  ].filter(Boolean).join(', ');
  const nodeTooltip = breakdown ? `${node.title}\nПривязки — ${breakdown}` : node.title;

  return (
    <div>
      <button
        onClick={handleClick}
        title={nodeTooltip}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          width: '100%',
          padding: '4px 4px',
          paddingLeft: `${8 + depth * 14}px`,
          border: 'none',
          borderRadius: radii.sm,
          background: isActive ? colors.greenLight : 'transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => {
          if (!isActive) e.currentTarget.style.background = 'rgba(0,0,0,0.03)';
        }}
        onMouseLeave={e => {
          if (!isActive) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Chevron */}
        {hasChildren ? (
          <span
            onClick={handleChevronClick}
            style={{
              fontSize: '8px',
              color: colors.textTertiary,
              transition: 'transform 0.15s',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '12px',
              height: '12px',
              flexShrink: 0,
            }}
          >
            ▶
          </span>
        ) : (
          <span style={{ width: '12px', flexShrink: 0 }} />
        )}

        {/* Точка худшего статуса привязок */}
        {statusDotColor && (
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: statusDotColor,
            flexShrink: 0,
          }} />
        )}

        {/* Title */}
        <span style={{
          fontSize: '13px',
          fontWeight: isActive ? 600 : 400,
          color: isActive ? colors.greenDark
            : node.is_virtual ? colors.textTertiary
            : colors.textPrimary,
          fontStyle: node.is_virtual ? 'italic' : 'normal',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}>
          {isSearching ? highlightMatch(node.title, searchQuery) : node.title}
        </span>
      </button>

      {/* Children */}
      {isExpanded && children.map(child => (
        <TreeNodeComponent
          key={child.id}
          node={child}
          childrenMap={childrenMap}
          depth={depth + 1}
          expandState={expandState}
          toggleExpand={toggleExpand}
          activePageId={activePageId}
          navigate={navigate}
          isSearching={isSearching}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  );
});

export default PageTree;
