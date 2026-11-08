/**
 * ProductPicker
 *
 * Choose a product from the library for an estimate: a vanity, a
 * countertop, a faucet… Shows the library's products in the given
 * categories; one that isn't there yet can be added on the spot (the same
 * ways as on the library page) and is picked as soon as it's saved.
 *
 * Shared by the Cabinet and Bathroom Estimators' upgrade options. The estimate keeps its own copy
 * of what's picked; this only hands the product over.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Modal, Select, Space, Spin, Typography } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ProductCard from '@/components/features/tools/cabinet-estimate/products/ProductCard';
import ProductEditor from '@/components/features/tools/cabinet-estimate/products/ProductEditor';
import ProductImport from '@/components/features/tools/cabinet-estimate/products/ProductImport';
import { productLibraryService } from '@/services/productLibraryService';
import type { Product, ProductDraft } from '@/types/productLibrary';

const PAGE_SIZE = 48;

export interface ProductPickerProps {
  open: boolean;
  /** Library categories to offer (catalog.CATEGORIES keys), the main one first. */
  categories: string[];
  onPick: (product: Product) => void;
  onClose: () => void;
  /** e.g. "Choose a countertop". */
  title?: string;
  /** The product chosen now, marked in the list. */
  selectedId?: string | null;
}

const ProductPicker: React.FC<ProductPickerProps> = ({ open, categories, onPick, onClose, title, selectedId }) => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(categories[0]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [importOpen, setImportOpen] = useState(false);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const categoryKey = categories.join(',');

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setQuery('');
    setLimit(PAGE_SIZE);
    setCategory(categoryKey.split(',')[0]);
  }, [open, categoryKey]);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const { data: meta } = useQuery({ queryKey: ['product-meta'], queryFn: productLibraryService.getMeta, staleTime: Infinity });
  const { data, isLoading } = useQuery({
    queryKey: ['products', query, 'picker', category, limit],
    queryFn: () => productLibraryService.list({ q: query || undefined, category, limit }),
    enabled: open && !!category,
  });

  const categoryOptions = useMemo(
    () =>
      categories.map((key) => ({ value: key, label: meta?.categories.find((c) => c.key === key)?.label ?? key })),
    [categories, meta]
  );
  const categoryLabel = categoryOptions.find((c) => c.value === category)?.label ?? 'product';
  const items = data?.items ?? [];

  const startDraft = (d: ProductDraft) => {
    setImportOpen(false);
    // What's read off a listing may not know its category; this picker does.
    const known = d.fields.category && categories.includes(d.fields.category);
    setDraft({ ...d, fields: { ...d.fields, category: known ? d.fields.category : category } });
  };

  return (
    <>
      <Modal
        open={open && !importOpen && !draft}
        title={title ?? `Choose a ${categoryLabel.toLowerCase()}`}
        width={960}
        footer={null}
        onCancel={onClose}
        destroyOnHidden
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            autoFocus
            placeholder="Search name, brand, model, finish"
            prefix={<SearchOutlined />}
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 280 }}
          />
          {categories.length > 1 && (
            <Select value={category} onChange={setCategory} options={categoryOptions} style={{ width: 220 }} />
          )}
          <Button icon={<PlusOutlined />} onClick={() => setImportOpen(true)}>
            Add a {categoryLabel.toLowerCase()} to the library
          </Button>
        </Space>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <Empty
            style={{ padding: 24 }}
            description={query ? 'Nothing matches' : `No ${categoryLabel.toLowerCase()} in the library yet`}
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setImportOpen(true)}>
              Add one
            </Button>
          </Empty>
        ) : (
          <div style={{ maxHeight: '62vh', overflowY: 'auto', padding: 2 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
              {items.map((p) => (
                <ProductCard key={p.id} product={p} meta={meta} selected={p.id === selectedId} onOpen={() => onPick(p)} />
              ))}
            </div>
            {data && data.total > items.length && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <Button onClick={() => setLimit((l) => l + PAGE_SIZE)}>Show more</Button>
              </div>
            )}
          </div>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
          The estimate keeps a copy of the product as it is now. Later edits in the library don't change it.
        </Typography.Text>
      </Modal>

      <ProductImport open={open && importOpen} onClose={() => setImportOpen(false)} onDraft={startDraft} />
      <ProductEditor
        open={open && !!draft}
        meta={meta}
        draft={draft}
        onClose={() => setDraft(null)}
        onSaved={(saved) => {
          setDraft(null);
          queryClient.invalidateQueries({ queryKey: ['products'] });
          onPick(saved);
        }}
        onArchived={() => setDraft(null)}
      />
    </>
  );
};

export default ProductPicker;
