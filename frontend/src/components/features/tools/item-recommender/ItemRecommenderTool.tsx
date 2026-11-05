/**
 * Item Recommender Tool
 *
 * Semantic search over Xactimate line items with grouped results.
 */
import React, { useState, useCallback } from 'react';
import {
  Input,
  Card,
  Tag,
  Checkbox,
  Button,
  Empty,
  Spin,
  Collapse,
  Typography,
  Space,
  Tooltip,
  Badge,
  message,
} from 'antd';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  SearchOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { colors, fonts, borderRadius, shadows } from '@/styles/theme';
import { formatCurrency } from '@/utils/formatters';
import type { ToolComponentProps } from '../registry';

const { Text, Title } = Typography;
const { Panel } = Collapse;

// ── Types ──────────────────────────────────────────────────────────────

interface SearchResultItem {
  item_code: string;
  category: string;
  description: string;
  includes: string | null;
  excludes: string | null;
  note: string | null;
  unit_price: number;
  labor_cost: number;
  material_cost: number;
  score: number;
}

interface SearchResultGroup {
  key: string;
  label: string;
  items: SearchResultItem[];
}

interface SearchResponse {
  query: string;
  total: number;
  groups: SearchResultGroup[];
}

interface IndexStatus {
  item_count: number;
  data_dir: string;
  needs_reindex: boolean;
  reindex_in_progress: boolean;
}

// ── Group Colors ───────────────────────────────────────────────────────

const GROUP_CONFIG: Record<string, { color: string; bg: string }> = {
  pre_work: { color: '#d97706', bg: '#fffbeb' },
  main_work: { color: '#2563eb', bg: '#eff6ff' },
  related_materials: { color: '#7c3aed', bg: '#f5f3ff' },
  trim_finish: { color: '#059669', bg: '#ecfdf5' },
  post_work: { color: '#dc2626', bg: '#fef2f2' },
};

// ── API Calls ──────────────────────────────────────────────────────────

const searchItems = async (query: string): Promise<SearchResponse> => {
  const res = await api.get<SearchResponse>('/tools/item-recommender/search', {
    params: { q: query },
  });
  return res.data;
};

const getIndexStatus = async (): Promise<IndexStatus> => {
  const res = await api.get<IndexStatus>('/tools/item-recommender/status');
  return res.data;
};

const triggerReindex = async () => {
  const res = await api.post('/tools/item-recommender/reindex');
  return res.data;
};

// ── Item Card ──────────────────────────────────────────────────────────

const ItemCard: React.FC<{
  item: SearchResultItem;
  checked: boolean;
  onToggle: (code: string) => void;
}> = ({ item, checked, onToggle }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 16px',
        borderBottom: `1px solid ${colors.border}`,
        background: checked ? '#f0f9ff' : 'transparent',
        transition: 'background 0.15s',
        cursor: 'pointer',
        minHeight: 44,
      }}
      onClick={() => onToggle(item.item_code)}
    >
      <Checkbox
        checked={checked}
        onChange={() => onToggle(item.item_code)}
        style={{ marginTop: 2, flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <Tag
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              margin: 0,
              borderRadius: 4,
              flexShrink: 0,
            }}
          >
            {item.item_code}
          </Tag>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
            <Text strong style={{ fontSize: 14, fontFamily: fonts.body, flex: 1, wordBreak: 'break-word' }}>
              {item.description}
            </Text>
            {item.note && (
              <Tooltip title={item.note}>
                <InfoCircleOutlined style={{ color: colors.textMuted, fontSize: 13, cursor: 'pointer', flexShrink: 0, marginTop: 2 }} />
              </Tooltip>
            )}
          </div>
        </div>

        {item.includes && (
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 2 }}>
            {item.includes}
          </Text>
        )}

        <div style={{ marginTop: 4 }}>
          <Text strong style={{ fontSize: 13, fontFamily: fonts.heading }}>
            {formatCurrency(item.unit_price)}
          </Text>
          <span style={{ fontSize: 11, color: colors.textMuted, marginLeft: 6 }}>
            L: {formatCurrency(item.labor_cost)} / M: {formatCurrency(item.material_cost)}
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────

const ItemRecommenderTool: React.FC<ToolComponentProps> = () => {
  const [query, setQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const isMobile = useIsMobile();

  const searchMutation = useMutation({
    mutationFn: searchItems,
  });

  // Re-indexing rebuilds the shared index for everyone; the API only allows staff.
  const isSuperuser = useAuthStore((s) => !!s.user?.isSuperuser);

  const reindexMutation = useMutation({
    mutationFn: triggerReindex,
    onSuccess: () => message.success('Re-indexing started in background'),
    onError: () => message.error('Failed to trigger re-index'),
  });

  const { data: status } = useQuery({
    queryKey: ['item-recommender-status'],
    queryFn: getIndexStatus,
    staleTime: 30_000,
  });

  const handleSearch = useCallback(() => {
    if (query.trim().length < 2) return;
    searchMutation.mutate(query.trim());
  }, [query, searchMutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSearch();
    },
    [handleSearch],
  );

  const toggleItem = useCallback((code: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const result = searchMutation.data;

  return (
    <div style={{ maxWidth: 960 }}>
      {/* Search Bar */}
      <Card
        style={{
          borderRadius: borderRadius.lg,
          boxShadow: shadows.sm,
          marginBottom: 20,
        }}
        styles={{ body: { padding: isMobile ? '16px' : '20px 24px' } }}
      >
        <Space.Compact style={{ width: '100%' }}>
          <Input
            size="large"
            placeholder={isMobile ? 'Describe the work type...' : 'Describe the work type (e.g. Hardwood floor replacement, Roof tear-off)...'}
            prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ fontFamily: fonts.body }}
          />
          <Button
            type="primary"
            size="large"
            onClick={handleSearch}
            loading={searchMutation.isPending}
            style={{ fontWeight: 600, minHeight: 40 }}
          >
            Search
          </Button>
        </Space.Compact>

        {/* Status bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 12,
            fontSize: 13,
            color: colors.textMuted,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span>
            {status
              ? `${status.item_count.toLocaleString()} items indexed`
              : 'Loading...'}
            {status?.reindex_in_progress && (
              <Tag color="processing" style={{ marginLeft: 8 }}>
                Re-indexing...
              </Tag>
            )}
          </span>
          {isSuperuser && (
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => reindexMutation.mutate()}
              loading={reindexMutation.isPending}
            >
              Re-index
            </Button>
          )}
        </div>
      </Card>

      {/* Loading */}
      {searchMutation.isPending && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: colors.textSecondary }}>
            Searching items...
          </div>
        </div>
      )}

      {/* Results */}
      {result && !searchMutation.isPending && (
        <>
          {/* Summary */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <Text style={{ fontSize: 14, color: colors.textSecondary }}>
              Found <strong>{result.total}</strong> items for "{result.query}"
            </Text>

            {selectedItems.size > 0 && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                style={{ fontWeight: 600, minHeight: 36 }}
                onClick={() =>
                  message.info(
                    `${selectedItems.size} item(s) selected — estimate integration coming soon`,
                  )
                }
              >
                Add to Estimate ({selectedItems.size})
              </Button>
            )}
          </div>

          {/* Grouped Results */}
          {result.groups.length > 0 ? (
            <Collapse
              defaultActiveKey={result.groups.map((g) => g.key)}
              style={{ background: 'transparent', border: 'none' }}
              expandIconPosition="start"
            >
              {result.groups.map((group) => {
                const cfg = GROUP_CONFIG[group.key] || {
                  color: colors.textPrimary,
                  bg: colors.bgLight,
                };
                return (
                  <Panel
                    key={group.key}
                    header={
                      <span style={{ fontFamily: fonts.heading, fontWeight: 600 }}>
                        <Badge
                          color={cfg.color}
                          style={{ marginRight: 8 }}
                        />
                        {group.label}
                        <Tag
                          style={{
                            marginLeft: 8,
                            borderRadius: 10,
                            fontSize: 12,
                          }}
                        >
                          {group.items.length}
                        </Tag>
                      </span>
                    }
                    style={{
                      marginBottom: 12,
                      borderRadius: borderRadius.lg,
                      border: `1px solid ${colors.border}`,
                      overflow: 'hidden',
                      background: cfg.bg,
                    }}
                  >
                    <div style={{ background: colors.bgWhite, borderRadius: borderRadius.md }}>
                      {group.items.map((item) => (
                        <ItemCard
                          key={item.item_code}
                          item={item}
                          checked={selectedItems.has(item.item_code)}
                          onToggle={toggleItem}
                        />
                      ))}
                    </div>
                  </Panel>
                );
              })}
            </Collapse>
          ) : (
            <Empty description="No matching items found. Try a different search term." />
          )}
        </>
      )}

      {/* Initial state */}
      {!result && !searchMutation.isPending && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ color: colors.textMuted }}>
              Enter a work type to search for recommended line items
            </span>
          }
        />
      )}
    </div>
  );
};

export default ItemRecommenderTool;
