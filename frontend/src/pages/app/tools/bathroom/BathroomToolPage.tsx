/**
 * Scopit - Bathroom Estimator pages beyond the tool's home
 *
 * The tool's home (its list of bathroom jobs) opens through ToolWrapper like
 * every tool. An estimate, the product library and the company's prices
 * have their own URLs (/app/tools/bathroom_estimate/:estimateId, …/products,
 * …/prices), so they come through here: the same access check, and a
 * spinner while the page's code loads. The product library is the one the
 * Cabinet Estimator keeps; from here its Back goes to this tool.
 */
import React, { Suspense, lazy } from 'react';
import { Spin } from 'antd';
import { ToolAccessGate } from '@/components/features/tools/ToolAccessGate';
import { BATHROOM_TOOL_PATH } from '@/components/features/tools/bathroom-estimate/paths';

const BathroomEstimateDetailPage = lazy(() => import('./BathroomEstimateDetailPage'));
const ProductLibraryPage = lazy(() => import('@/pages/app/tools/cabinet/ProductLibraryPage'));
const UnitPricesPage = lazy(() => import('@/pages/app/tools/UnitPricesPage'));

const Loading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
    <Spin size="large" />
  </div>
);

const BathroomToolPage: React.FC<{ page: 'estimate' | 'products' | 'prices' }> = ({ page }) => (
  <ToolAccessGate toolId="bathroom_estimate">
    <Suspense fallback={<Loading />}>
      {page === 'estimate' ? (
        <BathroomEstimateDetailPage />
      ) : page === 'prices' ? (
        <UnitPricesPage domain="bathroom" backLabel="Bathroom Estimator" backPath={BATHROOM_TOOL_PATH} />
      ) : (
        <ProductLibraryPage backLabel="Bathroom Estimator" backPath={BATHROOM_TOOL_PATH} />
      )}
    </Suspense>
  </ToolAccessGate>
);

export default BathroomToolPage;
