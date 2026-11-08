/**
 * ProductLibrary
 *
 * The company's products from retailers — cabinets, hardware, faucets,
 * sinks, countertops, tile, vanities… — that the Cabinet and Bathroom
 * Estimators' upgrade options are built from. Products come in through ProductImport (the
 * bookmarklet, a screenshot, a link, or by hand) and are checked and saved
 * in ProductEditor.
 *
 * Opened as /app/tools/cabinet_estimate/products?import=1 by the bookmarklet: tells the page
 * that opened it it's ready, takes the product page it sends, reads it and
 * opens the editor.
 *
 * One library for both tools; each opens it at its own URL so Back returns
 * to the tool it came from (backLabel / backPath).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Empty, Grid, Input, Segmented, Select, Space, Spin, Typography, message } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import ProductCard from '@/components/features/tools/cabinet-estimate/products/ProductCard';
import ProductEditor from '@/components/features/tools/cabinet-estimate/products/ProductEditor';
import ProductImport, { IMPORT_PAGE, IMPORT_READY } from '@/components/features/tools/cabinet-estimate/products/ProductImport';
import { productLibraryService } from '@/services/productLibraryService';
import { useBackNav } from '@/hooks/useHeaderNav';
import { CABINET_TOOL_PATH } from '@/components/features/tools/cabinet-estimate/paths';
import type { Product, ProductDraft } from '@/types/productLibrary';

const { Title, Text } = Typography;
const PAGE_SIZE = 48;
type Trade = 'all' | 'kitchen' | 'bathroom';

/** The bookmarklet's end: say ready to the page that opened this one, take what it sends, read it. */
function useBookmarkletImport(onDraft: (draft: ProductDraft) => void, onCutOff: () => void) {
  const [params, setParams] = useSearchParams();
  const importing = params.get('import') === '1';
  const [waiting, setWaiting] = useState(importing);
  const done = useRef(false);

  useEffect(() => {
    if (!importing || done.current) return;
    const opener = window.opener as Window | null;
    if (!opener) {
      // Opened without the shop's page, or the shop cut the two windows
      // apart (Cross-Origin-Opener-Policy): its page then offers to copy itself.
      setWaiting(false);
      setParams({}, { replace: true });
      onCutOff();
      return;
    }
    const onMessage = async (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: unknown; html?: unknown };
      if (e.source !== opener || data?.type !== IMPORT_PAGE || typeof data.url !== 'string' || typeof data.html !== 'string') return;
      done.current = true;
      window.removeEventListener('message', onMessage);
      try {
        onDraft(await productLibraryService.readHtml(data.url, data.html));
      } catch (err: any) {
        message.error(err?.response?.data?.detail ?? 'The product page could not be read');
      } finally {
        setWaiting(false);
        setParams({}, { replace: true });
      }
    };
    window.addEventListener('message', onMessage);
    // Said a few times, in case the page that opened this one is slow to listen.
    const tell = () => opener.postMessage(IMPORT_READY, '*');
    tell();
    const timer = window.setInterval(tell, 700);
    const giveUp = window.setTimeout(() => {
      if (!done.current) {
        setWaiting(false);
        message.warning('The product page did not answer. Click the bookmark on it again.');
      }
    }, 15000);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(timer);
      window.clearTimeout(giveUp);
    };
  }, [importing, onDraft, onCutOff, setParams]);

  return waiting;
}

export interface ProductLibraryProps {
  /** Where the header's Back goes: the tool the library was opened from */
  backLabel?: string;
  backPath?: string;
}

const ProductLibrary: React.FC<ProductLibraryProps> = ({
  backLabel = 'Cabinet Estimator',
  backPath = CABINET_TOOL_PATH,
}) => {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  useBackNav(backLabel, backPath);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [trade, setTrade] = useState<Trade>('all');
  const [category, setCategory] = useState<string | undefined>();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<{ product?: Product | null; draft?: ProductDraft | null } | null>(null);

  // Search as typing settles.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const { data: meta } = useQuery({ queryKey: ['product-meta'], queryFn: productLibraryService.getMeta, staleTime: Infinity });
  const { data, isLoading } = useQuery({
    queryKey: ['products', query, trade, category, limit],
    queryFn: () =>
      productLibraryService.list({ q: query || undefined, trade: trade === 'all' ? undefined : trade, category, limit }),
  });

  const openDraft = React.useCallback((draft: ProductDraft) => {
    setImportOpen(false);
    setEditing({ draft });
  }, []);
  const pastePage = React.useCallback(() => {
    setImportOpen(true);
    message.info('If the shop page shows a “copy this page” button, click it, then paste here (Ctrl+V).', 8);
  }, []);
  const waitingForPage = useBookmarkletImport(openDraft, pastePage);

  const categoryOptions = useMemo(
    () =>
      (meta?.categories ?? [])
        .filter((c) => trade === 'all' || c.trade === trade || c.trade === 'both')
        .map((c) => ({ value: c.key, label: c.label })),
    [meta, trade]
  );

  const items = data?.items ?? [];
  return (
    <div>
      <Card
        title={<Title level={4} style={{ margin: 0 }}>Product library</Title>}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setImportOpen(true)}>
            {isMobile ? 'Add' : 'Add product'}
          </Button>
        }
        styles={{ header: isMobile ? { padding: '0 12px' } : undefined, body: isMobile ? { padding: 12 } : undefined }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Products from retailers that kitchen and bathroom upgrade options are built from. An estimate keeps a copy of each
          product it uses, so editing one here doesn't change an estimate already sent.
        </Text>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            placeholder="Search name, brand, model, finish"
            prefix={<SearchOutlined />}
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: isMobile ? '100%' : 280 }}
          />
          <Segmented<Trade>
            value={trade}
            onChange={(v) => {
              setTrade(v);
              setCategory(undefined);
            }}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Kitchen', value: 'kitchen' },
              { label: 'Bathroom', value: 'bathroom' },
            ]}
          />
          <Select
            allowClear
            placeholder="Any category"
            value={category}
            onChange={setCategory}
            options={categoryOptions}
            style={{ width: 220 }}
          />
          {data && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {data.total} product{data.total === 1 ? '' : 's'}
            </Text>
          )}
        </Space>

        {waitingForPage ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
            <div style={{ marginTop: 12, color: '#374151' }}>Reading the product page…</div>
          </div>
        ) : isLoading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <Empty
            style={{ padding: 32 }}
            description={
              query || category || trade !== 'all'
                ? 'No products match'
                : 'No products yet. Add one from a retailer page, a screenshot, a link or by hand.'
            }
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setImportOpen(true)}>
              Add product
            </Button>
          </Empty>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 190}px, 1fr))`,
                gap: 12,
              }}
            >
              {items.map((p) => (
                <ProductCard key={p.id} product={p} meta={meta} onOpen={() => setEditing({ product: p })} />
              ))}
            </div>
            {data && data.total > items.length && (
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <Button onClick={() => setLimit((l) => l + PAGE_SIZE)}>Show more</Button>
              </div>
            )}
          </>
        )}
      </Card>

      <ProductImport open={importOpen} onClose={() => setImportOpen(false)} onDraft={openDraft} />
      <ProductEditor
        open={!!editing}
        meta={meta}
        product={editing?.product}
        draft={editing?.draft}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null);
          message.success(`Saved ${saved.title}`);
          queryClient.invalidateQueries({ queryKey: ['products'] });
        }}
        onArchived={(gone) => {
          setEditing(null);
          message.success(`Removed ${gone.title}`);
          queryClient.invalidateQueries({ queryKey: ['products'] });
        }}
      />
    </div>
  );
};

export default ProductLibrary;
