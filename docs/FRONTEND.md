# Scopit - Frontend 개발 가이드

> React 프론트엔드 구현 문서

---

## 📁 프로젝트 구조

```
frontend/src/
├── pages/                    # 페이지 컴포넌트
│   ├── public/               # 공개 (Landing, Pricing)
│   ├── auth/                 # 인증 (Login, Register)
│   └── app/                  # 앱 (Dashboard, Estimates, etc.)
│
├── components/               # 재사용 컴포넌트
│   ├── common/               # Button, Input, Modal, Table
│   ├── layout/               # AppLayout, Sidebar, Header
│   └── features/             # 기능별 (EstimateForm, etc.)
│
├── services/                 # API 호출
├── stores/                   # Zustand 상태
├── hooks/                    # 커스텀 훅
├── types/                    # TypeScript 타입
└── utils/                    # 유틸리티
```

---

## 🛠️ 기술 스택

| 라이브러리 | 용도 |
|------------|------|
| React 18 | UI Framework |
| TypeScript | Type Safety |
| Ant Design 5 | UI Components |
| Framer Motion | Animations |
| TanStack Query | Server State |
| Zustand | Client State |
| Axios | HTTP Client |

---

## 🎨 테마

```typescript
// styles/theme.ts
export const theme = {
  colors: {
    primary: '#111827',
    bgWhite: '#ffffff',
    bgLight: '#f9fafb',
    border: '#e5e7eb',
    textPrimary: '#111827',
    textSecondary: '#6b7280',
  },
  fonts: {
    heading: "'Plus Jakarta Sans', sans-serif",
    body: "'Inter', sans-serif",
  },
};
```

---

## 🔐 인증

### Auth Store (Zustand)

```typescript
// stores/authStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setTokens: (access: string, refresh: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      setTokens: (access, refresh) => set({ 
        accessToken: access, 
        refreshToken: refresh,
        isAuthenticated: true 
      }),
      logout: () => set({ 
        user: null, 
        accessToken: null, 
        refreshToken: null,
        isAuthenticated: false 
      }),
    }),
    { name: 'scopit-auth' }
  )
);
```

### API Client (Axios)

```typescript
// services/api.ts
import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL + '/api',
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
```

---

## 🛡️ Feature Gate

```tsx
// hooks/useFeatureGate.ts
export function useFeatureGate(feature: string) {
  const { data: subscription } = useQuery({
    queryKey: ['subscription'],
    queryFn: subscriptionService.getMySubscription,
  });
  
  if (subscription?.isBetaUser) {
    return { canAccess: true, isBeta: true };
  }
  
  return {
    canAccess: subscription?.plan?.[feature] ?? false,
    isBeta: false,
  };
}

// components/FeatureGate.tsx
export const FeatureGate = ({ feature, children }) => {
  const { canAccess } = useFeatureGate(feature);
  
  if (!canAccess) {
    return <UpgradeModal />;
  }
  
  return <>{children}</>;
};
```

---

## 📄 페이지 예시

```tsx
// pages/app/estimates/EstimateListPage.tsx
import { useQuery } from '@tanstack/react-query';
import { Table, Button } from 'antd';
import { motion } from 'framer-motion';

const EstimateListPage = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['estimates'],
    queryFn: estimateService.getList,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1>Estimates</h1>
        <Button type="primary">New Estimate</Button>
      </div>
      
      <Table
        columns={columns}
        dataSource={data?.items}
        loading={isLoading}
      />
    </motion.div>
  );
};
```

---

## 🗺️ 라우팅

```tsx
// App.tsx
<Routes>
  {/* Public */}
  <Route path="/" element={<LandingPage />} />
  <Route path="/login" element={<LoginPage />} />
  
  {/* Protected */}
  <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
    <Route path="dashboard" element={<DashboardPage />} />
    <Route path="estimates" element={<EstimateListPage />} />
    <Route path="invoices" element={<InvoiceListPage />} />
    <Route path="customers" element={<CustomerListPage />} />
    <Route path="line-items" element={<LineItemListPage />} />
    <Route path="settings/*" element={<SettingsPage />} />
  </Route>
</Routes>
```

---

*Last Updated: 2026-01-26*
