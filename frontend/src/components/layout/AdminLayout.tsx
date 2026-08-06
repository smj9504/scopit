/**
 * Scopit - Admin Layout
 * Mobile-responsive layout wrapper for admin pages with drawer navigation
 */
import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Button, Space, Avatar, Drawer } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  BarChartOutlined,
  ArrowLeftOutlined,
  SettingOutlined,
  MenuOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile, useIsNarrow } from '@/hooks/useIsMobile';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const AdminLayout: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const isMobile = useIsMobile();
  // Tablet (768-1023px): use drawer nav, same as mobile
  const isNarrow = useIsNarrow();
  const useDrawer = isMobile || isNarrow;

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const menuItems = [
    {
      key: '/admin/dashboard',
      icon: <DashboardOutlined />,
      label: 'Dashboard',
    },
    {
      key: '/admin/users',
      icon: <UserOutlined />,
      label: 'Users',
    },
    {
      key: '/admin/analytics',
      icon: <BarChartOutlined />,
      label: 'Analytics',
    },
  ];

  const selectedKey = menuItems.find((item) =>
    location.pathname.startsWith(item.key)
  )?.key || '/admin/dashboard';

  const handleMenuClick = (key: string) => {
    navigate(key);
    if (useDrawer) {
      setMobileMenuOpen(false);
    }
  };

  // Sidebar content (shared between desktop Sider and mobile/tablet Drawer)
  const SidebarContent = () => (
    <>
      {/* Logo/Title */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          flexShrink: 0,
        }}
      >
        <Text
          strong
          style={{ color: '#fff', fontSize: 18 }}
        >
          <SettingOutlined style={{ marginRight: 8 }} />
          Admin Panel
        </Text>
      </div>

      {/* Menu */}
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={({ key }) => handleMenuClick(key)}
        style={{ borderRight: 0, marginTop: 8, flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
      />

      {/* Back to App */}
      <div
        style={{
          padding: 16,
          borderTop: '1px solid rgba(255,255,255,0.1)',
          flexShrink: 0,
          // Safe area for bottom notch
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
        }}
      >
        <Button
          type="default"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/app/dashboard')}
          block
          style={{
            background: 'rgba(255,255,255,0.1)',
            color: '#fff',
            border: 'none',
            minHeight: 44,
          }}
        >
          Back to App
        </Button>
      </div>
    </>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Desktop Sidebar — only on screens >= 1024px */}
      {!useDrawer && (
        <Sider
          width={220}
          style={{
            background: '#001529',
            position: 'fixed',
            left: 0,
            top: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 100,
          }}
        >
          <SidebarContent />
        </Sider>
      )}

      {/* Mobile + Tablet Drawer */}
      <Drawer
        placement="left"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        // Wider on tablet
        width={isNarrow && !isMobile ? 300 : 280}
        styles={{
          body: {
            padding: 0,
            background: '#001529',
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
            background: '#001529',
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
              borderBottom: '1px solid rgba(255,255,255,0.1)',
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
                color: '#fff',
              }}
            />
          </div>
          <SidebarContent />
        </div>
      </Drawer>

      <Layout
        style={{
          marginLeft: useDrawer ? 0 : 220,
          transition: 'margin-left 0.2s ease',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <Header
          style={{
            background: '#fff',
            paddingLeft: useDrawer ? 16 : 24,
            paddingRight: useDrawer ? 16 : 24,
            paddingTop: 0,
            paddingBottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            // Raised above drawer overlay backdrop but below the drawer itself
            zIndex: 99,
            height: 'auto',
            minHeight: 64,
            lineHeight: 'normal',
          }}
        >
          {/* Left side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
            {!useDrawer && (
              <Text type="secondary">
                Superuser Admin Console
              </Text>
            )}
            {useDrawer && (
              <Text strong style={{ fontSize: 16 }}>
                Admin
              </Text>
            )}
          </div>

          {/* Right side */}
          <Space>
            {!useDrawer && <Text>{user?.fullName || user?.email}</Text>}
            <Avatar
              icon={<UserOutlined />}
              src={user?.avatarUrl}
              style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36 }}
            />
          </Space>
        </Header>

        {/* Content */}
        <Content
          style={{
            background: '#f5f5f5',
            minHeight: 'calc(100vh - 64px)',
            padding: useDrawer ? 16 : 0,
            // Prevent horizontal overflow
            overflowX: 'hidden',
            // Safe area for bottom notch and right side (landscape)
            paddingBottom: useDrawer
              ? 'calc(16px + env(safe-area-inset-bottom))'
              : 0,
            paddingRight: useDrawer
              ? 'calc(16px + env(safe-area-inset-right))'
              : 0,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AdminLayout;
