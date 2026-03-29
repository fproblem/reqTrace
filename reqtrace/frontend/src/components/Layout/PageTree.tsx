import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../../api/client';
import { SpaceTree, TreeNodeItem } from '../../types';
import { useToast } from '../Toast';
import { colors, radii } from '../../styles/tokens';

const TREE_STATE_KEY = 'reqtrace_tree_state';

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

interface PageTreeProps {
  userId: string;
  onPageAdded?: () => void;
}

export const PageTree: React.FC<PageTreeProps> = ({ userId, onPageAdded }) => {
  const [spaces, setSpaces] = useState<SpaceTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandState, setExpandState] = useState<Record<string, boolean>>(loadExpandState);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  const loadTree = useCallback(async () => {
    try {
      const data = await api.getPageTree();
      setSpaces(data);
    } catch (e: any) {
      showToast('error', 'Не удалось загрузить дерево страниц', e.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // Refetch tree on mount and when route changes (covers delete, refresh scenarios)
  useEffect(() => { loadTree(); }, [location.pathname, loadTree]);

  const toggleExpand = useCallback((key: string) => {
    setExpandState(prev => {
      // Default is expanded (true), so undefined → collapse (false)
      const current = prev[key] !== false;
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
      const page = await api.addPage(newUrl.trim(), userId);
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

  const setExpandForSpace = useCallback((space: SpaceTree, expanded: boolean) => {
    setExpandState(prev => {
      const next = { ...prev };
      const spaceKey = `space:${space.space_key}`;
      next[spaceKey] = true; // always keep space itself expanded
      for (const page of space.pages) {
        next[`page:${page.confluence_page_id}`] = expanded;
      }
      saveExpandState(next);
      return next;
    });
  }, []);

  const handleAddDemo = async () => {
    try {
      const page = await api.addDemoPage(userId);
      await loadTree();
      navigate(`/pages/${page.id}`);
    } catch (e: any) {
      showToast('error', 'Не удалось добавить демо-страницу', e.message);
    }
  };

  const activePageId = useMemo(() => {
    const match = location.pathname.match(/^\/pages\/(.+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const isEmpty = spaces.length === 0 || spaces.every(s => s.pages.length === 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
          Страницы
        </span>
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

      {/* Tree content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '20px 4px', color: colors.textTertiary, fontSize: '12px' }}>
            Загрузка...
          </div>
        ) : isEmpty ? (
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
        ) : (
          spaces.map(space => (
            <SpaceNode
              key={space.space_key}
              space={space}
              expandState={expandState}
              toggleExpand={toggleExpand}
              setExpandForSpace={setExpandForSpace}
              activePageId={activePageId}
              navigate={navigate}
            />
          ))
        )}
      </div>
    </div>
  );
};

// --- Space node ---

interface SpaceNodeProps {
  space: SpaceTree;
  expandState: Record<string, boolean>;
  toggleExpand: (key: string) => void;
  setExpandForSpace: (space: SpaceTree, expanded: boolean) => void;
  activePageId: string | null;
  navigate: (path: string) => void;
}

const spaceActionBtnStyle: React.CSSProperties = {
  width: '22px',
  height: '22px',
  border: 'none',
  background: 'transparent',
  color: colors.textSecondary,
  fontSize: '14px',
  lineHeight: '22px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: radii.sm,
  flexShrink: 0,
  padding: 0,
  transition: 'all 0.15s',
};

const SpaceNode: React.FC<SpaceNodeProps> = ({ space, expandState, toggleExpand, setExpandForSpace, activePageId, navigate }) => {
  const spaceKey = `space:${space.space_key}`;
  const isExpanded = expandState[spaceKey] !== false; // default expanded

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
        {isExpanded && (
          <>
            <button
              onClick={() => setExpandForSpace(space, true)}
              title="Развернуть все"
              style={spaceActionBtnStyle}
              onMouseEnter={e => {
                e.currentTarget.style.background = colors.greenLight;
                e.currentTarget.style.color = colors.greenDark;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = colors.textSecondary;
              }}
            >
              ⊞
            </button>
            <button
              onClick={() => setExpandForSpace(space, false)}
              title="Свернуть все"
              style={spaceActionBtnStyle}
              onMouseEnter={e => {
                e.currentTarget.style.background = colors.greenLight;
                e.currentTarget.style.color = colors.greenDark;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = colors.textSecondary;
              }}
            >
              ⊟
            </button>
          </>
        )}
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
}

const TreeNodeComponent: React.FC<TreeNodeProps> = React.memo(({
  node, childrenMap, depth, expandState, toggleExpand, activePageId, navigate,
}) => {
  const children = childrenMap[node.confluence_page_id] || [];
  const hasChildren = children.length > 0;
  const nodeKey = `page:${node.confluence_page_id}`;
  const isExpanded = hasChildren && expandState[nodeKey] !== false; // default expanded
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

  const coverageDotColor = node.is_virtual ? undefined
    : node.coverage_percent >= 70 ? colors.statusActive
    : node.coverage_percent >= 30 ? colors.statusOutdated
    : node.coverage_percent > 0 ? colors.statusLost
    : undefined;

  return (
    <div>
      <button
        onClick={handleClick}
        title={node.title}
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

        {/* Coverage dot */}
        {coverageDotColor && (
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: coverageDotColor,
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
          {node.title}
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
        />
      ))}
    </div>
  );
});

export default PageTree;
