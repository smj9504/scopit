/**
 * Scopit - App Layout
 * Mobile-responsive layout with drawer navigation
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout, Button, Dropdown, Avatar, Drawer, Tooltip } from 'antd';
import {
  SettingOutlined,
  LogoutOutlined,
  MenuOutlined,
  CloseOutlined,
  ArrowLeftOutlined,
  DashboardOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';
import { colors, fonts, shadows } from '@/styles/theme';
import { HeaderNavProvider, useHeaderNav } from '@/hooks/useHeaderNav';
import { FocusModeProvider } from '@/hooks/useFocusMode';
import { useIsMobile, useIsNarrow } from '@/hooks/useIsMobile';
import { StrokeIcon, GridIcon, ORDERED_TOOL_META } from '@/components/features/tools/toolMeta';

const { Sider, Content, Header } = Layout;

// Nav item text — gray-700, a step softer than textPrimary so the dark
// selected pill stands out, still ~10:1 on white.
const NAV_TEXT = '#374151';
const BOTTOM_NAV_HEIGHT = 64;

// ── Nav icons (same stroke family as the tool icons) ──────────────────────────

const DashboardIcon = ({ size = 18 }: { size?: number }) => (
  <StrokeIcon size={size}>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v10h5v-6h4v6h5V10" />
  </StrokeIcon>
);
const EstimatesIcon = ({ size = 18 }: { size?: number }) => (
  <StrokeIcon size={size}>
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5" />
  </StrokeIcon>
);
const InvoicesIcon = ({ size = 18 }: { size?: number }) => (
  <StrokeIcon size={size}>
    <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" />
    <path d="M9 9h6M9 13h6" />
  </StrokeIcon>
);
const CustomersIcon = ({ size = 18 }: { size?: number }) => (
  <StrokeIcon size={size}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
  </StrokeIcon>
);
const LineItemsIcon = ({ size = 18 }: { size?: number }) => (
  <StrokeIcon size={size}>
    <path d="M9 6h12M9 12h12M9 18h12" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" />
  </StrokeIcon>
);
const SettingsIcon = ({ size = 18 }: { size?: number }) => (
  <StrokeIcon size={size}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
  </StrokeIcon>
);

interface NavEntry {
  to: string;
  label: string;
  icon: React.ReactNode;
  /** Tool icons render in the accent color when not selected. */
  accentIcon?: boolean;
  /** Match only the exact path, not nested routes. */
  exact?: boolean;
}

const RECORD_ITEMS: NavEntry[] = [
  { to: '/app/estimates', label: 'Estimates', icon: <EstimatesIcon /> },
  { to: '/app/invoices', label: 'Invoices', icon: <InvoicesIcon /> },
  { to: '/app/customers', label: 'Customers', icon: <CustomersIcon /> },
  { to: '/app/line-items', label: 'Line Items', icon: <LineItemsIcon /> },
];

const TOOL_ITEMS: NavEntry[] = ORDERED_TOOL_META.map((meta) => ({
  to: `/app/tools/${meta.id}`,
  label: meta.navLabel,
  icon: <meta.Icon />,
  accentIcon: true,
}));

const BOTTOM_TABS = [
  { to: '/app/dashboard', label: 'Home', icon: <DashboardIcon size={20} /> },
  { to: '/app/tools', label: 'Tools', icon: <GridIcon size={20} /> },
  { to: '/app/estimates', label: 'Estimates', icon: <EstimatesIcon size={20} /> },
  { to: '/app/invoices', label: 'Invoices', icon: <InvoicesIcon size={20} /> },
  { to: '/app/customers', label: 'Customers', icon: <CustomersIcon size={20} /> },
];

// Back navigation button rendered in the header
const HeaderBackNav: React.FC = () => {
  const { backNav } = useHeaderNav();
  const navigate = useNavigate();

  if (!backNav) return null;

  return (
    <Button
      type="text"
      icon={<ArrowLeftOutlined />}
      onClick={() => navigate(backNav.path)}
      style={{
        padding: '4px 8px',
        color: colors.textSecondary,
        fontSize: 14,
        display: 'flex',
        alignItems: 'center',
        height: 36,
      }}
    >
      {backNav.label}
    </Button>
  );
};

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const isMobile = useIsMobile();
  // Tablet: 768-1023px — treat like mobile (drawer nav) but wider drawer
  const isNarrow = useIsNarrow();
  const useDrawer = isMobile || isNarrow;
  // Icons-only rail: desktop sidebar collapsed. The drawer always shows labels.
  const isRail = collapsed && !useDrawer;

  // Focus mode: a page (e.g. the PDF editor) has the whole window, with no
  // sidebar, header or bottom nav. Going in and out of it is instant; only
  // collapsing the sidebar slides the content.
  const [focusMode, setFocusModeState] = useState(false);
  const [animateMargin, setAnimateMargin] = useState(true);
  const setFocusMode = useCallback((on: boolean) => {
    setAnimateMargin(false);
    setFocusModeState(on);
  }, []);
  const focusModeValue = useMemo(() => ({ focusMode, setFocusMode }), [focusMode, setFocusMode]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const userMenuItems = [
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
      onClick: () => navigate('/app/settings'),
    },
    // Entrance to the admin console. Superusers only -- the /admin route is
    // guarded by <AdminRoute> either way, this just saves typing the URL.
    ...(user?.isSuperuser
      ? [
          {
            key: 'admin',
            icon: <DashboardOutlined />,
            label: 'Admin',
            onClick: () => navigate('/admin/dashboard'),
          },
        ]
      : []),
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
      onClick: () => {
        logout();
        navigate('/login');
      },
    },
  ];

  // Selected state. Prefix match on whole path segments so nested routes
  // (/app/tools/packing/<sessionId>, /app/estimates/<id>/edit) keep their
  // parent highlighted. /app/tools itself selects no tool — only "All".
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const isUnder = (base: string) => path === base || path.startsWith(`${base}/`);
  const isToolsIndex = path === '/app/tools';

  const itemHeight = useDrawer ? 44 : 40;

  const renderNavLink = (item: NavEntry, extraStyle?: React.CSSProperties) => {
    const active = item.exact ? path === item.to : isUnder(item.to);
    const link = (
      <Link
        key={item.to}
        to={item.to}
        className="app-nav-item"
        aria-current={active ? 'page' : undefined}
        aria-label={isRail ? item.label : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: isRail ? 'center' : 'flex-start',
          gap: 12,
          height: itemHeight,
          padding: isRail ? 0 : '0 16px',
          borderRadius: 8,
          background: active ? colors.primary : 'transparent',
          color: active ? colors.textWhite : NAV_TEXT,
          fontWeight: active ? 600 : 500,
          flexShrink: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          ...extraStyle,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            color: item.accentIcon && !active ? colors.accent : 'currentColor',
          }}
        >
          {item.icon}
        </span>
        {!isRail && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
      </Link>
    );
    return isRail ? (
      <Tooltip key={item.to} title={item.label} placement="right">
        {link}
      </Tooltip>
    ) : (
      link
    );
  };

  // Group heading; in the icon rail it collapses to a hairline divider.
  const renderGroupLabel = (label: string, action?: React.ReactNode) =>
    isRail ? (
      <div
        role="separator"
        style={{ height: 1, background: colors.border, margin: '12px 16px', flexShrink: 0 }}
      />
    ) : (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${useDrawer ? 16 : 18}px 16px 6px`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary }}>{label}</span>
        {action}
      </div>
    );

  const allToolsLink = (
    <Link
      to="/app/tools"
      aria-current={isToolsIndex ? 'page' : undefined}
      aria-label="All tools"
      style={{
        fontSize: 12,
        fontWeight: 600,
        lineHeight: '20px',
        borderRadius: 9999,
        // Pill when current, plain link otherwise; vertical padding grows the
        // touch target in the drawer.
        padding: isToolsIndex ? '2px 8px' : `${useDrawer ? 4 : 2}px 0`,
        background: isToolsIndex ? colors.primary : 'transparent',
        color: isToolsIndex ? colors.textWhite : '#1d4ed8',
      }}
    >
      All
    </Link>
  );

  // Sidebar content (shared between desktop Sider and mobile/tablet Drawer).
  // A render function, not a nested component, so it doesn't remount on
  // every parent render.
  const renderSidebar = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Logo (+ close button in the drawer) */}
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: isRail ? 'center' : 'space-between',
          // Drawer: room for the top notch, and a tighter right edge for the close button
          padding: isRail ? 0 : useDrawer ? 'env(safe-area-inset-top) 8px 0 24px' : '0 24px',
          borderBottom: useDrawer ? `1px solid ${colors.border}` : 'none',
          boxSizing: 'content-box',
          flexShrink: 0,
        }}
      >
        <Link to="/app/dashboard" aria-label="Scopit dashboard" style={{ textDecoration: 'none' }}>
          <span
            style={{
              fontFamily: fonts.heading,
              fontSize: isRail ? 18 : 20,
              fontWeight: 800,
              color: colors.primary,
              letterSpacing: '-0.02em',
            }}
          >
            {isRail ? 'S' : 'Scopit'}
          </span>
        </Link>
        {useDrawer && (
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
            style={{ width: 44, height: 44 }}
          />
        )}
      </div>

      {/* Nav */}
      <nav
        aria-label="Main"
        style={{
          flex: 1,
          minHeight: 0,
          padding: '12px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          overflowY: 'auto',
          overflowX: 'hidden',
          fontSize: useDrawer ? 15 : 14,
        }}
      >
        {renderNavLink({ to: '/app/dashboard', label: 'Dashboard', icon: <DashboardIcon /> })}

        {renderGroupLabel('Tools', allToolsLink)}
        {/* The rail has no room for the "All" link, so it becomes an item */}
        {isRail && renderNavLink({ to: '/app/tools', label: 'All tools', icon: <GridIcon />, exact: true })}
        {TOOL_ITEMS.map((item) => renderNavLink(item))}

        {renderGroupLabel('Records')}
        {RECORD_ITEMS.map((item) => renderNavLink(item))}

        {renderNavLink(
          { to: '/app/settings', label: 'Settings', icon: <SettingsIcon /> },
          { marginTop: 'auto' },
        )}
      </nav>

      {/* Beta note */}
      {!isRail && (
        <div style={{ padding: '8px 16px 20px', flexShrink: 0 }}>
          <div
            style={{
              background: colors.bgLight,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 600, color: colors.textPrimary }}>Free beta</span>
            {/* Non-breaking spaces keep the date on one line when the text wraps */}
            <span style={{ color: colors.textSecondary }}>Every tool, through Dec&nbsp;31,&nbsp;2026</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Desktop Sidebar — only on screens >= 1024px */}
      {!useDrawer && !focusMode && (
        <div style={{ position: 'relative' }}>
          <Sider
            trigger={null}
            collapsible
            collapsed={collapsed}
            width={240}
            collapsedWidth={80}
            style={{
              background: colors.bgWhite,
              borderRight: `1px solid ${colors.border}`,
              position: 'fixed',
              left: 0,
              top: 0,
              bottom: 0,
              zIndex: 100,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {renderSidebar()}
          </Sider>

          {/* Edge toggle button — large enough touch target on all devices */}
          <button
            onClick={() => {
              setAnimateMargin(true);
              setCollapsed(!collapsed);
            }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            style={{
              position: 'fixed',
              left: collapsed ? 80 - 16 : 240 - 16,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 101,
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: `1px solid ${colors.border}`,
              background: colors.bgWhite,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              transition: 'left 0.2s ease, background 0.15s ease',
              color: colors.textSecondary,
              fontSize: 10,
              // Expand the invisible click area to 44px for touch
              touchAction: 'manipulation',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = colors.bgLight;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = colors.bgWhite;
            }}
          >
            {collapsed ? <RightOutlined style={{ fontSize: 10 }} /> : <LeftOutlined style={{ fontSize: 10 }} />}
          </button>
        </div>
      )}

      {/* Mobile + Tablet Drawer */}
      <Drawer
        placement="left"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        // Wider on tablet for better readability
        width={isNarrow && !isMobile ? 300 : 280}
        styles={{
          body: {
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
          },
          header: {
            display: 'none',
          },
        }}
        style={{
          zIndex: 1001,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            background: colors.bgWhite,
            // Account for notch on left side (landscape)
            paddingLeft: 'env(safe-area-inset-left)',
          }}
        >
          {renderSidebar()}
        </div>
      </Drawer>

      {/* Main Content */}
      <HeaderNavProvider>
        <Layout
          style={{
            marginLeft: useDrawer || focusMode ? 0 : collapsed ? 80 : 240,
            transition: animateMargin ? 'margin-left 0.2s ease' : 'none',
            // Prevent content from overflowing horizontally on mobile
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <Header
            style={{
              background: colors.bgWhite,
              borderBottom: `1px solid ${colors.borderLight}`,
              boxShadow: shadows.xs,
              paddingLeft: useDrawer ? 16 : 24,
              paddingRight: useDrawer ? 16 : 24,
              paddingTop: 0,
              paddingBottom: 0,
              display: focusMode ? 'none' : 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              position: 'sticky',
              top: 0,
              zIndex: 99,
              height: 'auto',
              minHeight: 56,
              lineHeight: 'normal',
            }}
          >
            {/* Left side - Drawer toggle (mobile + tablet) + Back navigation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {useDrawer && (
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  onClick={() => setMobileMenuOpen(true)}
                  style={{
                    fontSize: 18,
                    width: 44,
                    height: 44,
                  }}
                  aria-label="Open menu"
                />
              )}
              <HeaderBackNav />
            </div>

            {/* Right side - User menu */}
            <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
              <button
                type="button"
                aria-label="Account menu"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: 0,
                  background: 'transparent',
                  font: 'inherit',
                  transition: 'background 0.15s ease',
                  minHeight: 44,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = colors.bgSunken;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <Avatar
                  style={{
                    background: colors.primary,
                    color: colors.textWhite,
                    width: 32,
                    height: 32,
                    lineHeight: '32px',
                    fontSize: 13,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {user?.fullName?.charAt(0).toUpperCase() || 'U'}
                </Avatar>
                {!useDrawer && (
                  <span
                    style={{
                      fontWeight: 500,
                      fontSize: 14,
                      color: colors.textPrimary,
                    }}
                  >
                    {user?.fullName || 'User'}
                  </span>
                )}
              </button>
            </Dropdown>
          </Header>

          {/* Content */}
          <Content
            style={
              focusMode
                ? // The page has the whole window, edge to edge
                  { padding: 0, background: colors.bgLight, overflowX: 'hidden' }
                : {
                    padding: isMobile ? 16 : 24,
                    minHeight: 'calc(100vh - 56px)',
                    background: colors.bgLight,
                    overflowX: 'hidden',
                    paddingBottom: isMobile
                      ? `calc(${BOTTOM_NAV_HEIGHT}px + 16px + env(safe-area-inset-bottom))`
                      : useDrawer
                      ? 'calc(16px + env(safe-area-inset-bottom))'
                      : 24,
                    paddingRight: useDrawer
                      ? 'calc(16px + env(safe-area-inset-right))'
                      : 24,
                  }
            }
          >
            <FocusModeProvider value={focusModeValue}>
              <Outlet />
            </FocusModeProvider>
          </Content>
        </Layout>
      </HeaderNavProvider>

      {/* Mobile Bottom Navigation */}
      {isMobile && !focusMode && (
        <nav
          aria-label="Bottom"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: colors.bgWhite,
            borderTop: `1px solid ${colors.borderLight}`,
            boxShadow: '0 -1px 8px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            alignItems: 'stretch',
            zIndex: 100,
            paddingBottom: 'env(safe-area-inset-bottom)',
            height: BOTTOM_NAV_HEIGHT,
          }}
        >
          {BOTTOM_TABS.map((tab) => {
            const isActive = isUnder(tab.to);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: '6px 0',
                  color: isActive ? colors.primary : colors.textSecondary,
                  transition: 'color 0.15s ease',
                  position: 'relative',
                }}
                aria-current={isActive ? 'page' : undefined}
              >
                {/* Active indicator dot — a non-color cue alongside the weight change */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: 3,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      background: colors.primary,
                    }}
                  />
                )}
                {tab.icon}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: isActive ? 600 : 500,
                    lineHeight: 1,
                    letterSpacing: '0.01em',
                  }}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </nav>
      )}
    </Layout>
  );
};

export default AppLayout;
