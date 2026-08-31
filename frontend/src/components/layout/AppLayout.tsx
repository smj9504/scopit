/**
 * Scopit - App Layout
 * Mobile-responsive layout with drawer navigation
 */
import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout, Menu, Button, Dropdown, Avatar, Badge, Drawer } from 'antd';
import {
  FileTextOutlined,
  DollarOutlined,
  UserOutlined,
  UnorderedListOutlined,
  SettingOutlined,
  LogoutOutlined,
  HomeOutlined,
  MenuOutlined,
  CloseOutlined,
  AppstoreOutlined,
  ArrowLeftOutlined,
  DashboardOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';
import { colors, fonts, shadows } from '@/styles/theme';
import { HeaderNavProvider, useHeaderNav } from '@/hooks/useHeaderNav';
import { useIsMobile, useIsNarrow } from '@/hooks/useIsMobile';

const { Sider, Content, Header } = Layout;

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

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const menuItems = [
    {
      key: '/app/dashboard',
      icon: <HomeOutlined />,
      label: 'Dashboard',
    },
    {
      key: '/app/estimates',
      icon: <FileTextOutlined />,
      label: 'Estimates',
    },
    {
      key: '/app/invoices',
      icon: <DollarOutlined />,
      label: 'Invoices',
    },
    {
      key: '/app/customers',
      icon: <UserOutlined />,
      label: 'Customers',
    },
    {
      key: '/app/line-items',
      icon: <UnorderedListOutlined />,
      label: 'Line Items',
    },
    {
      key: '/app/tools',
      icon: <AppstoreOutlined />,
      label: 'Tools',
    },
    {
      key: '/app/settings',
      icon: <SettingOutlined />,
      label: 'Settings',
    },
  ];

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

  const getSelectedKey = () => {
    const path = location.pathname;
    const item = menuItems.find((item) => path.startsWith(item.key));
    return item?.key || '/app/dashboard';
  };

  const handleMenuClick = (key: string) => {
    navigate(key);
    if (useDrawer) {
      setMobileMenuOpen(false);
    }
  };

  // Sidebar content (shared between desktop Sider and mobile/tablet Drawer)
  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed && !useDrawer ? 'center' : 'flex-start',
          padding: collapsed && !useDrawer ? 0 : '0 24px',
          flexShrink: 0,
        }}
      >
        <Link to="/app/dashboard" style={{ textDecoration: 'none' }}>
          <span
            style={{
              fontFamily: fonts.heading,
              fontSize: collapsed && !useDrawer ? 18 : 20,
              fontWeight: 800,
              color: colors.primary,
              letterSpacing: '-0.02em',
            }}
          >
            {collapsed && !useDrawer ? 'S' : 'Scopit'}
          </span>
        </Link>
      </div>

      {/* Menu */}
      <Menu
        mode="inline"
        selectedKeys={[getSelectedKey()]}
        items={menuItems}
        onClick={({ key }) => handleMenuClick(key)}
        style={{
          border: 'none',
          padding: '16px 8px',
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          fontSize: 14,
        }}
      />

      {/* Beta Badge */}
      {(!collapsed || useDrawer) && (
        <div
          style={{
            padding: '8px 24px 24px',
            flexShrink: 0,
          }}
        >
          <Badge.Ribbon text="Beta" color={colors.primary}>
            <div
              style={{
                background: colors.bgLight,
                borderRadius: 8,
                padding: '12px 50px 12px 16px',
                fontSize: 13,
                color: colors.textSecondary,
              }}
            >
              All features free during beta
            </div>
          </Badge.Ribbon>
        </div>
      )}
    </>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Desktop Sidebar — only on screens >= 1024px */}
      {!useDrawer && (
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
            <SidebarContent />
          </Sider>

          {/* Edge toggle button — large enough touch target on all devices */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
          {/* Close button row */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              padding: '12px 16px',
              borderBottom: `1px solid ${colors.border}`,
              // Account for top notch
              paddingTop: 'calc(12px + env(safe-area-inset-top))',
              flexShrink: 0,
            }}
          >
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={() => setMobileMenuOpen(false)}
              style={{
                width: 44,
                height: 44,
              }}
            />
          </div>
          <SidebarContent />
        </div>
      </Drawer>

      {/* Main Content */}
      <HeaderNavProvider>
        <Layout
          style={{
            marginLeft: useDrawer ? 0 : collapsed ? 80 : 240,
            transition: 'margin-left 0.2s ease',
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
              display: 'flex',
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
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  padding: '6px 10px',
                  borderRadius: 10,
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
              </div>
            </Dropdown>
          </Header>

          {/* Content */}
          <Content
            style={{
              padding: isMobile ? 16 : 24,
              minHeight: 'calc(100vh - 56px)',
              background: colors.bgLight,
              overflowX: 'hidden',
              paddingBottom: isMobile
                ? 'calc(60px + 16px + env(safe-area-inset-bottom))'
                : useDrawer
                ? 'calc(16px + env(safe-area-inset-bottom))'
                : 24,
              paddingRight: useDrawer
                ? 'calc(16px + env(safe-area-inset-right))'
                : 24,
            }}
          >
            <Outlet />
          </Content>
        </Layout>
      </HeaderNavProvider>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <nav
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
            height: 60,
          }}
        >
          {[
            { key: '/app/dashboard', icon: <HomeOutlined />, label: 'Home' },
            { key: '/app/estimates', icon: <FileTextOutlined />, label: 'Estimates' },
            { key: '/app/invoices', icon: <DollarOutlined />, label: 'Invoices' },
            { key: '/app/customers', icon: <UserOutlined />, label: 'Customers' },
            { key: '/app/tools', icon: <AppstoreOutlined />, label: 'Tools' },
          ].map((tab) => {
            const isActive = location.pathname.startsWith(tab.key);
            return (
              <button
                key={tab.key}
                onClick={() => navigate(tab.key)}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 0',
                  color: isActive ? colors.primary : colors.textMuted,
                  fontSize: 20,
                  transition: 'color 0.15s ease',
                  position: 'relative',
                }}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
              >
                {/* Active indicator dot */}
                {isActive && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
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
                    fontSize: 10,
                    fontWeight: isActive ? 600 : 500,
                    lineHeight: 1,
                    letterSpacing: '0.01em',
                  }}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </Layout>
  );
};

export default AppLayout;
