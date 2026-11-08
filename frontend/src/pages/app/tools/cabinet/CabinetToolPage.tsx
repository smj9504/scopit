/**
 * Scopit - Cabinet Estimator pages beyond the tool's home
 *
 * The tool's home (its list of kitchen jobs) opens through ToolWrapper like
 * every tool. An estimate and the product library have their own URLs
 * (/app/tools/cabinet_estimate/:estimateId, …/products), so they come
 * through here: the same access check, and a spinner while the page's code
 * loads.
 */
import React, { Suspense, lazy } from 'react';
import { Spin } from 'antd';
import { ToolAccessGate } from '@/components/features/tools/ToolAccessGate';

const CabinetEstimateDetailPage = lazy(() => import('./CabinetEstimateDetailPage'));
const ProductLibraryPage = lazy(() => import('./ProductLibraryPage'));

const Loading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
    <Spin size="large" />
  </div>
);

const CabinetToolPage: React.FC<{ page: 'estimate' | 'products' }> = ({ page }) => (
  <ToolAccessGate toolId="cabinet_estimate">
    <Suspense fallback={<Loading />}>
      {page === 'estimate' ? <CabinetEstimateDetailPage /> : <ProductLibraryPage />}
    </Suspense>
  </ToolAccessGate>
);

export default CabinetToolPage;
