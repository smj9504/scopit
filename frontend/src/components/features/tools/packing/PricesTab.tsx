/**
 * Scopit - Packing Tool: Prices Tab
 * Editable table of moving line-item prices, grouped by category.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Table,
  Input,
  InputNumber,
  Select,
  Spin,
  Empty,
  Typography,
  Space,
  Tag,
  message,
  Grid,
  Card,
  Tooltip,
} from 'antd';
import {
  SearchOutlined,
  CheckCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { packingApi } from './packingApi';
import type { MovingPrice } from './types';
import { colors, fonts, borderRadius, fontSizes } from '@/styles/theme';

const { Text, Title } = Typography;
const { useBreakpoint } = Grid;

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALL_CATEGORY = '__all__';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Derive unique sorted categories from the price list. */
function getCategories(prices: MovingPrice[]): string[] {
  const set = new Set<string>();
  prices.forEach((p) => {
    if (p.cat) set.add(p.cat);
  });
  return Array.from(set).sort();
}

// Category color palette – rotates through soft tones
const CAT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Labor:      { bg: '#fef9c3', border: '#fde047', text: '#854d0e' },
  Box:        { bg: '#dbeafe', border: '#93c5fd', text: '#1d4ed8' },
  Mattress:   { bg: '#fce7f3', border: '#f9a8d4', text: '#9d174d' },
  Protective: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
  Transport:  { bg: '#ede9fe', border: '#c4b5fd', text: '#5b21b6' },
  Storage:    { bg: '#ffedd5', border: '#fdba74', text: '#9a3412' },
  Material:   { bg: '#e0f2fe', border: '#7dd3fc', text: '#0369a1' },
  Specialty:  { bg: '#fdf4ff', border: '#e879f9', text: '#86198f' },
};

function catStyle(cat: string) {
  return (
    CAT_COLORS[cat] ?? { bg: '#f3f4f6', border: '#d1d5db', text: '#374151' }
  );
}

// ── Inline price cell ─────────────────────────────────────────────────────────

interface EditablePriceCellProps {
  price: MovingPrice;
  onSave: (id: string, newPrice: number) => Promise<void>;
}

const EditablePriceCell: React.FC<EditablePriceCellProps> = ({ price, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number>(price.unit_price);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync if parent data changes (e.g., after refresh)
  useEffect(() => {
    setValue(price.unit_price);
  }, [price.unit_price]);

  const handleBlur = useCallback(async () => {
    setEditing(false);
    if (value === price.unit_price) return;
    setSaving(true);
    try {
      await onSave(price.id, value);
    } catch {
      // Revert on failure
      setValue(price.unit_price);
    } finally {
      setSaving(false);
    }
  }, [value, price.unit_price, price.id, onSave]);

  if (editing) {
    return (
      <InputNumber
        ref={inputRef as any}
        value={value}
        onChange={(v) => setValue(v ?? price.unit_price)}
        onBlur={handleBlur}
        onPressEnter={handleBlur}
        prefix="$"
        min={0}
        precision={2}
        step={0.5}
        size="small"
        autoFocus
        style={{
          width: 100,
          borderRadius: borderRadius.base,
          fontFamily: fonts.body,
          fontSize: fontSizes.sm,
        }}
      />
    );
  }

  return (
    <Tooltip title="Click to edit">
      <div
        onClick={() => setEditing(true)}
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          borderRadius: borderRadius.base,
          transition: 'background 0.15s',
          fontFamily: fonts.body,
          fontSize: fontSizes.sm,
          color: colors.textPrimary,
          fontWeight: 500,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = colors.bgLight;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = 'transparent';
        }}
      >
        {saving ? (
          <Spin size="small" />
        ) : (
          formatCurrency(value)
        )}
      </div>
    </Tooltip>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

export const PricesTab: React.FC = () => {
  const [prices, setPrices] = useState<MovingPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState<string>(ALL_CATEGORY);
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  useEffect(() => {
    packingApi
      .getPrices()
      .then(setPrices)
      .catch(() => message.error('Failed to load prices'))
      .finally(() => setLoading(false));
  }, []);

  const handleSavePrice = useCallback(async (id: string, newPrice: number) => {
    await packingApi.updatePrice(id, { unit_price: newPrice });
    setPrices((prev) =>
      prev.map((p) => (p.id === id ? { ...p, unit_price: newPrice } : p)),
    );
    message.success('Price updated');
  }, []);

  // ── Filtered data ────────────────────────────────────────────────────────

  const categories = getCategories(prices);

  const filtered = prices.filter((p) => {
    const matchesCat = selectedCat === ALL_CATEGORY || p.cat === selectedCat;
    const q = search.toLowerCase().trim();
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q) ||
      p.cat.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  // ── Category select options ──────────────────────────────────────────────

  const categoryOptions = [
    { value: ALL_CATEGORY, label: 'All Categories' },
    ...categories.map((c) => ({ value: c, label: c })),
  ];

  // ── Desktop columns ──────────────────────────────────────────────────────

  const desktopColumns: ColumnsType<MovingPrice> = [
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      width: 90,
      render: (value: string) => (
        <Text
          code
          style={{
            fontSize: fontSizes.xs,
            color: colors.textSecondary,
            fontFamily: 'monospace',
          }}
        >
          {value}
        </Text>
      ),
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (value: string) => (
        <Text style={{ fontSize: fontSizes.sm, color: colors.textPrimary }}>
          {value}
        </Text>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'cat',
      key: 'cat',
      width: 130,
      render: (value: string) => {
        const style = catStyle(value);
        return (
          <Tag
            style={{
              borderRadius: borderRadius.full,
              fontSize: fontSizes.xs,
              fontFamily: fonts.body,
              background: style.bg,
              borderColor: style.border,
              color: style.text,
            }}
          >
            {value}
          </Tag>
        );
      },
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 80,
      render: (value: string) => (
        <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary }}>
          {value}
        </Text>
      ),
    },
    {
      title: 'Price',
      key: 'price',
      width: 130,
      align: 'right' as const,
      render: (_: unknown, record: MovingPrice) => (
        <EditablePriceCell price={record} onSave={handleSavePrice} />
      ),
    },
    {
      title: 'Taxable',
      dataIndex: 'is_taxable',
      key: 'is_taxable',
      width: 80,
      align: 'center' as const,
      render: (value: boolean | undefined) =>
        value ? (
          <CheckCircleOutlined style={{ color: colors.success, fontSize: 16 }} />
        ) : (
          <MinusCircleOutlined style={{ color: colors.textMuted, fontSize: 16 }} />
        ),
    },
  ];

  // ── Mobile columns (condensed) ───────────────────────────────────────────

  const mobileColumns: ColumnsType<MovingPrice> = [
    {
      title: 'Item',
      key: 'item',
      render: (_: unknown, record: MovingPrice) => {
        const style = catStyle(record.cat);
        return (
          <div>
            <Text
              strong
              style={{ fontSize: fontSizes.sm, color: colors.textPrimary, display: 'block' }}
            >
              {record.name}
            </Text>
            <Space size={4} style={{ marginTop: 2 }}>
              <Tag
                style={{
                  borderRadius: borderRadius.full,
                  fontSize: 11,
                  lineHeight: '16px',
                  fontFamily: fonts.body,
                  background: style.bg,
                  borderColor: style.border,
                  color: style.text,
                  margin: 0,
                }}
              >
                {record.cat}
              </Tag>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>
                / {record.unit}
              </Text>
            </Space>
          </div>
        );
      },
    },
    {
      title: 'Price',
      key: 'price',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, record: MovingPrice) => (
        <EditablePriceCell price={record} onSave={handleSavePrice} />
      ),
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <Title
          level={5}
          style={{
            margin: 0,
            marginBottom: 4,
            fontFamily: fonts.heading,
            color: colors.textPrimary,
            fontWeight: 600,
          }}
        >
          Moving Prices
        </Title>
        <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary }}>
          Click any price to edit it inline. Changes are saved immediately.
        </Text>
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Input
          allowClear
          placeholder="Search by name or code..."
          prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: '1 1 200px',
            maxWidth: 320,
            borderRadius: borderRadius.base,
            fontFamily: fonts.body,
            fontSize: fontSizes.sm,
            borderColor: colors.border,
          }}
        />
        <Select
          value={selectedCat}
          onChange={setSelectedCat}
          options={categoryOptions}
          style={{
            flex: '0 0 auto',
            minWidth: 160,
            fontFamily: fonts.body,
            fontSize: fontSizes.sm,
          }}
          popupMatchSelectWidth={false}
        />
        {!loading && (
          <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, marginLeft: 'auto' }}>
            {filtered.length} item{filtered.length !== 1 ? 's' : ''}
          </Text>
        )}
      </div>

      {/* Table / Content */}
      {loading ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 240,
          }}
        >
          <Spin size="large" />
        </div>
      ) : filtered.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text style={{ fontSize: fontSizes.sm, color: colors.textSecondary }}>
              {prices.length === 0 ? 'No prices available.' : 'No items match your search.'}
            </Text>
          }
          style={{ marginTop: 48 }}
        />
      ) : isMobile ? (
        /* Mobile: group by category, show as cards */
        <div>
          {categories
            .filter(
              (cat) =>
                (selectedCat === ALL_CATEGORY || cat === selectedCat) &&
                filtered.some((p) => p.cat === cat),
            )
            .map((cat) => {
              const items = filtered.filter((p) => p.cat === cat);
              if (items.length === 0) return null;
              const style = catStyle(cat);
              return (
                <div key={cat} style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Tag
                      style={{
                        borderRadius: borderRadius.full,
                        fontSize: fontSizes.xs,
                        fontFamily: fonts.body,
                        background: style.bg,
                        borderColor: style.border,
                        color: style.text,
                      }}
                    >
                      {cat}
                    </Tag>
                    <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted }}>
                      {items.length} item{items.length !== 1 ? 's' : ''}
                    </Text>
                  </div>
                  <Table<MovingPrice>
                    dataSource={items}
                    columns={mobileColumns}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    showHeader={false}
                    style={{
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.lg,
                      overflow: 'hidden',
                    }}
                  />
                </div>
              );
            })}
        </div>
      ) : (
        /* Desktop: single table with grouping visual */
        <Table<MovingPrice>
          dataSource={filtered}
          columns={desktopColumns}
          rowKey="id"
          size="middle"
          pagination={filtered.length > 50 ? { pageSize: 50, size: 'small' } : false}
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            overflow: 'hidden',
          }}
          rowClassName={(_, index) =>
            index % 2 === 0 ? '' : 'ant-table-row-alt'
          }
        />
      )}

      {/* Subtle alt-row stripe via global style injection */}
      <style>{`
        .ant-table-row-alt > td {
          background-color: ${colors.bgLight} !important;
        }
      `}</style>
    </div>
  );
};
