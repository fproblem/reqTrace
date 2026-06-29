import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { colors, radii, glassmorphism, fonts } from '../../styles/tokens';
import { ChangelogModal, useCurrentVersion } from '../ChangelogModal';
import { PageTree } from './PageTree';

interface LayoutProps {
  children: React.ReactNode;
  userName?: string;
  userId?: string;
  onLogout?: () => void;
}

const SIDEBAR_KEY = 'reqtrace_sidebar';
const MIN_WIDTH = 150;  // tree appears at / collapses below this drag width
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;
const RAIL_WIDTH = 48;

interface SidebarState {
  width: number;
  collapsed: boolean;
}

function loadSidebarState(): SidebarState {
  try {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const width = typeof parsed.width === 'number'
        ? Math.min(Math.max(parsed.width, MIN_WIDTH), MAX_WIDTH)
        : DEFAULT_WIDTH;
      return { width, collapsed: !!parsed.collapsed };
    }
  } catch {
    // ignore malformed state
  }
  return { width: DEFAULT_WIDTH, collapsed: false };
}

const Chevron: React.FC<{ dir: 'left' | 'right'; size?: number }> = ({ dir, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'block' }}
  >
    <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
  </svg>
);

export const Layout: React.FC<LayoutProps> = ({ children, userName, userId, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [changelogOpen, setChangelogOpen] = useState(false);
  const currentVersion = useCurrentVersion();

  const [sidebar, setSidebar] = useState<SidebarState>(loadSidebarState);
  const asideRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const rawXRef = useRef(sidebar.width);
  const zoneRef = useRef(false); // true while drag width is past MIN_WIDTH (tree shown)
  const [dragging, setDragging] = useState(false);
  const [dragTree, setDragTree] = useState(false);

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebar));
  }, [sidebar]);

  // During drag we mutate the aside width directly (bypassing React) so a large
  // PageTree doesn't re-render on every mouse move; we commit to state on release.
  const onDrag = useCallback((e: MouseEvent) => {
    if (!draggingRef.current) return;
    const x = e.clientX;
    rawXRef.current = x;
    // Width follows the cursor smoothly (direct DOM write, no re-render → no jank).
    if (asideRef.current) {
      asideRef.current.style.width = `${Math.min(Math.max(x, RAIL_WIDTH), MAX_WIDTH)}px`;
    }
    // Content swaps rail↔tree once when crossing MIN_WIDTH — width stays smooth, only
    // the contents change, so the tree appears as soon as we reach 150px.
    const tree = x >= MIN_WIDTH;
    if (tree !== zoneRef.current) {
      zoneRef.current = tree;
      setDragTree(tree);
    }
  }, []);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);

    // On release decide by final position: narrower than MIN_WIDTH → collapse, else expand.
    const x = rawXRef.current;
    const collapsed = x < MIN_WIDTH;
    const finalWidth = collapsed ? RAIL_WIDTH : Math.min(x, MAX_WIDTH);
    // Width was set imperatively during the drag (bypassing React), so React may skip
    // the DOM write when the committed value matches its last render (e.g. collapsing
    // back to the rail: 48 → 48). Snap the DOM ourselves and restore the transition.
    if (asideRef.current) {
      asideRef.current.style.transition = 'width 0.18s ease';
      asideRef.current.style.width = `${finalWidth}px`;
    }
    if (collapsed) {
      setSidebar(prev => ({ ...prev, collapsed: true }));
    } else {
      setSidebar({ width: finalWidth, collapsed: false });
    }
  }, [onDrag]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    rawXRef.current = e.clientX;
    setDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    if (asideRef.current) asideRef.current.style.transition = 'none';
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  }, [onDrag, endDrag]);

  // Safety: drop listeners if unmounted mid-drag
  useEffect(() => () => {
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);
  }, [onDrag, endDrag]);

  const toggleCollapsed = useCallback(() => {
    setSidebar(prev => ({
      width: prev.width || DEFAULT_WIDTH,
      collapsed: !prev.collapsed,
    }));
  }, []);

  const isSettings = location.pathname === '/settings';
  // During a drag the contents follow the cursor zone (tree once width >= MIN_WIDTH),
  // while the width tracks the cursor smoothly. Outside a drag they follow the
  // committed state. Release commits the dragged width as-is (no snap-back → no bounce).
  const showRail = dragging ? !dragTree : sidebar.collapsed;
  const width = dragging
    ? Math.min(Math.max(rawXRef.current, RAIL_WIDTH), MAX_WIDTH)
    : (sidebar.collapsed ? RAIL_WIDTH : sidebar.width);

  // Same drag handle works both ways: drag left to collapse, drag right to expand.
  const resizeHandle = (
    <div
      onMouseDown={startDrag}
      title={sidebar.collapsed ? 'Потяните вправо, чтобы раскрыть' : 'Потяните, чтобы изменить ширину (до упора — свернуть)'}
      style={{
        // Straddle the divider: grip sits centred on the border, protruding outside.
        position: 'absolute', top: 0, right: '-12px', width: '6px', height: '100%',
        cursor: 'col-resize', zIndex: 3,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseEnter={e => {
        const grip = e.currentTarget.firstElementChild as HTMLElement | null;
        if (grip) Array.from(grip.children).forEach(c => { (c as HTMLElement).style.background = colors.greenAccent; });
      }}
      onMouseLeave={e => {
        const grip = e.currentTarget.firstElementChild as HTMLElement | null;
        if (grip) Array.from(grip.children).forEach(c => { (c as HTMLElement).style.background = colors.textTertiary; });
      }}
    >
      {/* Grip marker — signals the sidebar is draggable */}
      <div style={{ display: 'flex', gap: '2px', alignItems: 'center', pointerEvents: 'none' }}>
        <span style={{ width: '2px', height: '18px', borderRadius: '1px', background: colors.textTertiary, transition: 'background 0.15s' }} />
        <span style={{ width: '2px', height: '18px', borderRadius: '1px', background: colors.textTertiary, transition: 'background 0.15s' }} />
      </div>
    </div>
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      fontFamily: fonts.body,
      background: colors.background,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background blobs */}
      <div style={{
        position: 'fixed', top: '-10%', left: '-5%',
        width: '500px', height: '500px', borderRadius: '50%',
        background: colors.blobLilac, filter: 'blur(80px)', zIndex: 0,
      }} />
      <div style={{
        position: 'fixed', bottom: '-15%', right: '-5%',
        width: '600px', height: '600px', borderRadius: '50%',
        background: colors.blobGreen, filter: 'blur(80px)', zIndex: 0,
      }} />
      <div style={{
        position: 'fixed', top: '40%', right: '20%',
        width: '400px', height: '400px', borderRadius: '50%',
        background: colors.blobYellow, filter: 'blur(80px)', zIndex: 0,
      }} />

      {/* Top bar */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '52px',
        flexShrink: 0,
        padding: '0 16px',
        ...glassmorphism,
        borderBottom: `1px solid ${colors.border}`,
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Left: brand + version */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <img
            src={`${process.env.PUBLIC_URL}/logo-header.svg`}
            alt="ReqTrace"
            onClick={() => navigate('/')}
            style={{ height: '34px', display: 'block', cursor: 'pointer', flexShrink: 0 }}
          />

          {currentVersion && (
            <button
              onClick={() => setChangelogOpen(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                padding: '2px 8px', borderRadius: radii.pill,
                border: `1px solid ${colors.border}`,
                background: 'rgba(122, 224, 90, 0.08)',
                color: colors.textSecondary, fontSize: '11px', fontWeight: 500,
                cursor: 'pointer', flexShrink: 0,
                fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = colors.greenAccent; e.currentTarget.style.color = colors.greenDark; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.textSecondary; }}
            >
              v{currentVersion}
            </button>
          )}
        </div>

        {/* Right: settings + user */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <button
            onClick={() => navigate('/settings')}
            style={{
              padding: '6px 12px', borderRadius: radii.md, border: 'none',
              background: isSettings ? colors.greenLight : 'transparent',
              color: isSettings ? colors.greenDark : colors.textSecondary,
              fontWeight: isSettings ? 600 : 500, fontSize: '13px',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!isSettings) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
            onMouseLeave={e => { if (!isSettings) e.currentTarget.style.background = 'transparent'; }}
          >
            Настройки
          </button>

          {userName && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              paddingLeft: '12px', marginLeft: '4px',
              borderLeft: `1px solid ${colors.border}`,
            }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: colors.textPrimary }}>
                {userName}
              </span>
              {onLogout && (
                <button
                  onClick={onLogout}
                  style={{
                    background: 'none', border: 'none', color: colors.textSecondary,
                    cursor: 'pointer', fontSize: '12px', padding: 0,
                    textDecoration: 'underline', fontFamily: 'inherit',
                  }}
                >
                  Выйти
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Content row: sidebar + main */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative', zIndex: 1 }}>
        <aside
          ref={asideRef}
          style={{
            width: `${width}px`,
            flexShrink: 0,
            ...glassmorphism,
            borderRight: `1px solid ${colors.border}`,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            // No overflow:hidden — the tree clips itself via its own container, and
            // this lets the resize grip sit outside, on the divider (Confluence-style).
            zIndex: 2, // above main so the protruding grip stays visible
            transition: dragging ? 'none' : 'width 0.18s ease',
          }}
        >
          {showRail ? (
            <>
              {/* Whole rail is the expand target — big click area; thin right edge stays draggable */}
              <button
                onClick={toggleCollapsed}
                title="Раскрыть панель страниц"
                style={{
                  flex: 1, width: '100%', border: 'none', background: 'transparent',
                  color: colors.textSecondary, cursor: 'pointer', display: 'flex',
                  flexDirection: 'column', alignItems: 'center', paddingTop: '14px',
                  transition: 'background 0.15s, color 0.15s', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = colors.greenLight; e.currentTarget.style.color = colors.greenDark; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textSecondary; }}
              >
                <Chevron dir="right" size={18} />
              </button>
              {resizeHandle}
            </>
          ) : (
            <>
              <div style={{ flex: 1, overflow: 'hidden', padding: '14px 10px 4px', minWidth: 0 }}>
                {userId && <PageTree userId={userId} />}
              </div>

              {/* Collapse control — bottom-right corner, Confluence-style */}
              <div style={{
                flexShrink: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
                padding: '4px 14px 8px',
              }}>
                <button
                  onClick={toggleCollapsed}
                  title="Свернуть панель страниц"
                  style={{
                    width: '36px', height: '30px', border: 'none', borderRadius: radii.sm,
                    background: 'transparent', color: colors.textTertiary, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s', fontFamily: 'inherit', padding: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = colors.greenLight; e.currentTarget.style.color = colors.greenDark; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textTertiary; }}
                >
                  <Chevron dir="left" size={16} />
                </button>
              </div>

              {/* Resize handle on the right divider */}
              {resizeHandle}
            </>
          )}
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, position: 'relative', zIndex: 1, overflow: 'auto', minWidth: 0 }}>
          {children}
        </main>
      </div>

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
};

export default Layout;
