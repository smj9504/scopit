/**
 * Scopit - Main App Component
 */
import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, createBrowserRouter, createRoutesFromElements, RouterProvider } from 'react-router-dom';
import { ConfigProvider, Spin, App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { antdTheme, colors } from '@/styles/theme';
import BackendWarmupGate from '@/components/common/BackendWarmupGate';
import '@/styles/global.css';

// Lazy load pages
const LandingPage = lazy(() => import('@/pages/public/LandingPage'));
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const OAuthCallbackPage = lazy(() => import('@/pages/auth/OAuthCallbackPage'));

const AppLayout = lazy(() => import('@/components/layout/AppLayout'));
const DashboardPage = lazy(() => import('@/pages/app/DashboardPage'));
const EstimatesListPage = lazy(() => import('@/pages/app/estimates/EstimatesListPage'));
const EstimateDetailPage = lazy(() => import('@/pages/app/estimates/EstimateDetailPage'));
const EstimateEditorPage = lazy(() => import('@/pages/app/estimates/EstimateEditorPage'));
const InvoicesListPage = lazy(() => import('@/pages/app/invoices/InvoicesListPage'));
const InvoiceDetailPage = lazy(() => import('@/pages/app/invoices/InvoiceDetailPage'));
const InvoiceEditorPage = lazy(() => import('@/pages/app/invoices/InvoiceEditorPage'));
const CustomersListPage = lazy(() => import('@/pages/app/customers/CustomersListPage'));
const CustomerDetailPage = lazy(() => import('@/pages/app/customers/CustomerDetailPage'));
const LineItemsListPage = lazy(() => import('@/pages/app/line_items/LineItemsListPage'));
const SettingsPage = lazy(() => import('@/pages/app/settings/SettingsPage'));
const ToolsPage = lazy(() => import('@/pages/app/tools/ToolsPage'));
const ToolWrapper = lazy(() => import('@/pages/app/tools/ToolWrapper'));

// Public pages (no auth)
const SignPage = lazy(() => import('@/pages/public/SignPage'));
const PackingDemoPage = lazy(() => import('@/pages/public/PackingDemoPage'));
const PackingCalculatorPage = lazy(() => import('@/pages/public/PackingCalculatorPage'));
const PackOutEstimatePage = lazy(() => import('@/pages/public/PackOutEstimatePage'));
const InsurancePackingEstimatePage = lazy(() => import('@/pages/public/InsurancePackingEstimatePage'));
const PackingReportPage = lazy(() => import('@/pages/public/PackingReportPage'));
const PackingLeadFormPage = lazy(() => import('@/pages/public/PackingLeadFormPage'));
const PackingLeadVerifyPage = lazy(() => import('@/pages/public/PackingLeadVerifyPage'));
const PackingLeadResultPage = lazy(() => import('@/pages/public/PackingLeadResultPage'));
const PrivacyPolicyPage = lazy(() => import('@/pages/public/PrivacyPolicyPage'));
const TermsPage = lazy(() => import('@/pages/public/TermsPage'));
const NotFoundPage = lazy(() => import('@/pages/public/NotFoundPage'));

// Admin pages (Superuser only)
const AdminLayout = lazy(() => import('@/components/layout/AdminLayout'));
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage'));
const AdminUsersPage = lazy(() => import('@/pages/admin/AdminUsersPage'));
const AdminUserDetailPage = lazy(() => import('@/pages/admin/AdminUserDetailPage'));
const AdminAnalyticsPage = lazy(() => import('@/pages/admin/AdminAnalyticsPage'));

// Create QueryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

// Loading fallback
const LoadingFallback = () => (
  <div
    style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: colors.bgLight,
    }}
  >
    <Spin size="large" />
  </div>
);

// Protected Route wrapper
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingFallback />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Public Route wrapper (redirect if authenticated)
const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingFallback />;
  }

  if (isAuthenticated) {
    return <Navigate to="/app/dashboard" replace />;
  }

  return <>{children}</>;
};

// Admin Route wrapper (Superuser only)
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, user } = useAuthStore();

  if (isLoading) {
    return <LoadingFallback />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Check if user is superuser
  if (!user?.isSuperuser) {
    return <Navigate to="/app/dashboard" replace />;
  }

  return <>{children}</>;
};

// createBrowserRouter (data router) is required for useBlocker, used by tools
// like the Packing Estimator to warn on navigation away from unsaved changes.
const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      {/* Public Routes */}
      <Route path="/" element={<LandingPage />} />

      {/* Auth Routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <RegisterPage />
          </PublicRoute>
        }
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/auth/callback" element={<OAuthCallbackPage />} />

      {/* Public E-Sign Page (no auth required) */}
      <Route path="/sign/:token" element={<SignPage />} />

      {/* Public Packing Estimator Demo (no auth required) */}
      <Route path="/demo/packing" element={<PackingDemoPage />} />

      {/* Public Packing Calculator SEO content pages (no auth required) */}
      <Route path="/packing-calculator" element={<PackingCalculatorPage />} />
      <Route path="/pack-out-estimate" element={<PackOutEstimatePage />} />
      <Route path="/insurance-packing-estimate" element={<InsurancePackingEstimatePage />} />
      <Route path="/packing-report" element={<PackingReportPage />} />

      {/* Public Packing Estimate Lead Capture (no auth required) */}
      <Route path="/packing-estimate" element={<PackingLeadFormPage />} />
      <Route path="/packing-estimate/verify/:token" element={<PackingLeadVerifyPage />} />
      <Route path="/packing-estimate/result/:token" element={<PackingLeadResultPage />} />

      {/* Legal (no auth required) */}
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/terms" element={<TermsPage />} />

      {/* Protected App Routes */}
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />

        {/* Estimates */}
        <Route path="estimates" element={<EstimatesListPage />} />
        <Route path="estimates/new" element={<EstimateEditorPage />} />
        <Route path="estimates/:id" element={<EstimateDetailPage />} />
        <Route path="estimates/:id/edit" element={<EstimateEditorPage />} />

        {/* Invoices */}
        <Route path="invoices" element={<InvoicesListPage />} />
        <Route path="invoices/new" element={<InvoiceEditorPage />} />
        <Route path="invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="invoices/:id/edit" element={<InvoiceEditorPage />} />

        {/* Customers */}
        <Route path="customers" element={<CustomersListPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />

        {/* Line Items */}
        <Route path="line-items" element={<LineItemsListPage />} />

        {/* Tools */}
        <Route path="tools" element={<ToolsPage />} />
        <Route path="tools/:toolId" element={<ToolWrapper />} />

        {/* Settings */}
        <Route path="settings/*" element={<SettingsPage />} />
      </Route>

      {/* Admin Routes (Superuser only) */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminLayout />
          </AdminRoute>
        }
      >
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="users/:id" element={<AdminUserDetailPage />} />
        <Route path="analytics" element={<AdminAnalyticsPage />} />
      </Route>

      {/* 404 - render a real noindex not-found page instead of redirecting
          to "/" (which produced a soft-404 for unknown URLs) */}
      <Route path="*" element={<NotFoundPage />} />
    </>,
  ),
);

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={antdTheme}>
        <AntdApp>
          <BackendWarmupGate>
            <Suspense fallback={<LoadingFallback />}>
              <RouterProvider router={router} />
            </Suspense>
          </BackendWarmupGate>
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
};

export default App;
