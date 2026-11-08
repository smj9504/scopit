/**
 * Company prices — the Bathroom or Cabinet Estimator's.
 *
 * Every price the tool's calculator uses, with its default (from the code,
 * updated monthly or quarterly) and the company's own material and labor.
 * An empty company cell follows the default. A company price applies to
 * estimates priced after it is saved: an estimate keeps the prices it was
 * first priced with until "Use current prices" on the estimate.
 *
 * One page for both tools; each opens it at its own URL
 * (/app/tools/<tool>/prices) so Back returns to the tool it came from.
 * A manager or admin can change prices; everyone else sees them read-only.
 * Ported from MJ Estimate's UnitPrices (its company picker and domain switch
 * aren't needed: a Scopit user prices their own company, one tool at a time).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Grid,
  Input,
  InputNumber,
  Popover,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  HistoryOutlined,
  InfoCircleOutlined,
  PercentageOutlined,
  SaveOutlined,
  SearchOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unitPriceService } from '@/services/unitPriceService';
import { useBackNav } from '@/hooks/useHeaderNav';
import {
  applyPercent,
  buildChanges,
  defaultTotal,
  effectiveTotal,
  hasOwn,
  isChanged,
  takes,
  valueOf,
  type Drafts,
} from '@/components/features/tools/unit-prices/unitPriceDrafts';
import type {
  PriceDomain,
  PriceKind,
  PriceSide,
  UnitPriceChange,
  UnitPriceHistoryEntry,
  UnitPriceItem,
} from '@/types/unitPrices';

const { Title, Text } = Typography;

const KIND_TAGS: Record<PriceKind, { color: string; label: string }> = {
  material: { color: 'blue', label: 'Material' },
  labor: { color: 'green', label: 'Labor' },
  mixed: { color: 'purple', label: 'Material + labor' },
};

const money = (v: number | null | undefined) =>
  v == null ? '' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtWhen = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US');
};

/** "Default → $12.00", the way a change reads in the history. */
const change = (from: number | null, to: number | null) =>
  from === to ? '' : `${from == null ? 'Default' : money(from)} → ${to == null ? 'Default' : money(to)}`;

export interface UnitPricesPageProps {
  domain: PriceDomain;
  /** Where the header's Back goes: the tool the page was opened from */
  backLabel: string;
  backPath: string;
}

const UnitPricesPage: React.FC<UnitPricesPageProps> = ({ domain, backLabel, backPath }) => {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  useBackNav(backLabel, backPath);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string>();
  const [onlyCompany, setOnlyCompany] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bulkSide, setBulkSide] = useState<PriceSide>('labor');
  const [bulkPct, setBulkPct] = useState<number | null>(5);

  const prices = useQuery({
    queryKey: ['unit-prices', domain],
    queryFn: () => unitPriceService.list(domain),
  });

  const history = useQuery({
    queryKey: ['unit-price-history', domain],
    queryFn: () => unitPriceService.history(domain),
    enabled: historyOpen,
  });

  const items = useMemo(() => prices.data?.items ?? [], [prices.data]);
  const canEdit = !!prices.data?.can_edit;
  const groups = useMemo(() => Array.from(new Set(items.map((i) => i.group))), [items]);
  const changedItems = useMemo(() => items.filter((item) => isChanged(item, drafts)), [items, drafts]);
  const ownCount = items.filter((i) => i.material != null || i.labor != null).length;

  // Leaving the page with unsaved prices asks first.
  useEffect(() => {
    if (!changedItems.length) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changedItems.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (group && item.group !== group) return false;
      if (onlyCompany && !hasOwn(item, drafts)) return false;
      if (!q) return true;
      return [item.label, item.group, item.key].some((f) => f.toLowerCase().includes(q));
    });
  }, [items, search, group, onlyCompany, drafts]);

  // One card per group, in the order groups first appear (a group's prices
  // can sit in more than one table)
  const byGroup = useMemo(() => {
    const out = new Map<string, UnitPriceItem[]>();
    filtered.forEach((item) => {
      const rows = out.get(item.group);
      if (rows) rows.push(item);
      else out.set(item.group, [item]);
    });
    return Array.from(out, ([name, rows]) => ({ group: name, rows }));
  }, [filtered]);

  const setDraft = (key: string, edit: UnitPriceChange) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...edit } }));

  const save = useMutation({
    mutationFn: () => unitPriceService.save(domain, buildChanges(items, drafts)),
    onSuccess: (data) => {
      queryClient.setQueryData(['unit-prices', domain], data);
      queryClient.invalidateQueries({ queryKey: ['unit-price-history', domain] });
      setDrafts({});
      message.success('Prices saved. They apply to estimates priced from now on.');
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Could not save the prices'),
  });

  const sideCell = (item: UnitPriceItem, side: PriceSide) => {
    if (!takes(item.kind, side)) return <Text type="secondary">—</Text>;
    const value = valueOf(item, drafts, side);
    if (!canEdit) return value == null ? <Text type="secondary">Default</Text> : <Text>{money(value)}</Text>;
    return (
      <InputNumber
        size="small"
        min={0}
        step={1}
        precision={2}
        prefix="$"
        style={{ width: '100%' }}
        placeholder="Default"
        value={value ?? undefined}
        onChange={(v) => setDraft(item.key, { [side]: v == null ? null : Number(v) })}
        aria-label={`${item.label} company ${side}`}
      />
    );
  };

  const columns = [
    {
      title: 'Price',
      key: 'label',
      render: (_: unknown, item: UnitPriceItem) => (
        <Space size={6} wrap>
          <span>{item.label}</span>
          <Tag color={KIND_TAGS[item.kind].color} style={{ marginInlineEnd: 0 }}>{KIND_TAGS[item.kind].label}</Tag>
          {item.note && (
            <Tooltip title={item.note}>
              <InfoCircleOutlined style={{ color: '#8c8c8c' }} aria-label={item.note} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 80 },
    {
      title: 'Default material',
      key: 'dm',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, item: UnitPriceItem) => (
        <Text type="secondary">{takes(item.kind, 'material') ? money(item.default_material) : '—'}</Text>
      ),
    },
    {
      title: 'Default labor',
      key: 'dl',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, item: UnitPriceItem) => (
        <Text type="secondary">{takes(item.kind, 'labor') ? money(item.default_labor) : '—'}</Text>
      ),
    },
    {
      title: 'Company material',
      key: 'm',
      width: 140,
      align: canEdit ? undefined : ('right' as const),
      render: (_: unknown, item: UnitPriceItem) => sideCell(item, 'material'),
    },
    {
      title: 'Company labor',
      key: 'l',
      width: 140,
      align: canEdit ? undefined : ('right' as const),
      render: (_: unknown, item: UnitPriceItem) => sideCell(item, 'labor'),
    },
    {
      title: 'In use',
      key: 'total',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, item: UnitPriceItem) => {
        const value = effectiveTotal(item, drafts);
        const isDefault = Math.abs(value - defaultTotal(item)) < 0.005;
        return isDefault ? <Text>{money(value)}</Text> : <Text strong style={{ color: '#d46b08' }}>{money(value)}</Text>;
      },
    },
    ...(canEdit
      ? [
          {
            key: 'reset',
            width: 48,
            render: (_: unknown, item: UnitPriceItem) =>
              hasOwn(item, drafts) ? (
                <Tooltip
                  title={
                    item.updated_by
                      ? `Back to default (last changed by ${item.updated_by}, ${fmtWhen(item.updated_at)})`
                      : 'Back to default'
                  }
                >
                  <Button
                    size="small"
                    type="text"
                    icon={<UndoOutlined />}
                    aria-label={`${item.label} back to default`}
                    onClick={() => setDraft(item.key, { material: null, labor: null })}
                  />
                </Tooltip>
              ) : null,
          },
        ]
      : []),
  ];

  const historyColumns = [
    { title: 'When', dataIndex: 'changed_at', key: 'at', width: 180, render: (v: string) => fmtWhen(v) },
    { title: 'Who', dataIndex: 'changed_by', key: 'by', width: 140, render: (v: string | null) => v || '—' },
    {
      title: 'Price',
      key: 'item',
      render: (_: unknown, h: UnitPriceHistoryEntry) => (
        <span>{h.group ? <Text type="secondary">{h.group} · </Text> : null}{h.label}</span>
      ),
    },
    {
      title: 'Material',
      key: 'm',
      width: 180,
      render: (_: unknown, h: UnitPriceHistoryEntry) => change(h.old_material, h.new_material),
    },
    {
      title: 'Labor',
      key: 'l',
      width: 180,
      render: (_: unknown, h: UnitPriceHistoryEntry) => change(h.old_labor, h.new_labor),
    },
  ];

  const toolName = prices.data?.label ?? (domain === 'bathroom' ? 'Bathroom' : 'Kitchen Cabinet');

  return (
    <div>
      <Card
        // On a phone the header's back link already names the tool
        title={<Title level={4} style={{ margin: 0 }}>{isMobile ? 'Prices' : `${toolName} prices`}</Title>}
        extra={
          <Space size={8}>
            <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>
              {isMobile ? 'History' : 'Change history'}
            </Button>
            {canEdit && !isMobile && (
              <Button onClick={() => setDrafts({})} disabled={!changedItems.length}>
                Discard
              </Button>
            )}
            {canEdit && (
              <Button
                type="primary"
                icon={<SaveOutlined />}
                disabled={!changedItems.length}
                loading={save.isPending}
                onClick={() => save.mutate()}
              >
                Save{changedItems.length ? ` (${changedItems.length})` : ''}
              </Button>
            )}
          </Space>
        }
        styles={{ header: isMobile ? { padding: '0 12px' } : undefined, body: isMobile ? { padding: 12 } : undefined }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, maxWidth: 820 }}>
          The prices this tool's estimates are calculated with. Defaults are updated monthly or quarterly; leave a company
          cell empty to follow the default. Saved prices apply to estimates priced from then on. An estimate already
          calculated keeps the prices it was first priced with until you choose &ldquo;Use current prices&rdquo; on it.
        </Text>
        {prices.data && !canEdit && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Only a manager or admin can change these prices."
          />
        )}

        <Space wrap size={12} style={{ marginBottom: 16 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search prices"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: isMobile ? '100%' : 240 }}
          />
          <Select
            allowClear
            showSearch
            placeholder="All groups"
            value={group}
            onChange={setGroup}
            options={groups.map((g) => ({ value: g, label: g }))}
            style={{ width: isMobile ? '100%' : 220 }}
          />
          <Space size={6}>
            <Switch size="small" checked={onlyCompany} onChange={setOnlyCompany} aria-label="Company prices only" />
            <Text>Company prices only{ownCount ? ` (${ownCount})` : ''}</Text>
          </Space>
          {canEdit && (
            <Popover
              trigger="click"
              title="Adjust the prices shown"
              content={(
                <Space direction="vertical" size={8}>
                  <Segmented
                    value={bulkSide}
                    onChange={(v) => setBulkSide(v as PriceSide)}
                    options={[{ value: 'labor', label: 'Labor' }, { value: 'material', label: 'Material' }]}
                  />
                  <InputNumber
                    value={bulkPct}
                    onChange={(v) => setBulkPct(v == null ? null : Number(v))}
                    addonAfter="%"
                    step={1}
                    style={{ width: 160 }}
                    aria-label="Percent change"
                  />
                  <Text type="secondary" style={{ fontSize: 12, maxWidth: 240, display: 'block' }}>
                    Changes the {bulkSide} of the {filtered.length} price{filtered.length === 1 ? '' : 's'} shown, from
                    each one&rsquo;s current figure. Nothing changes until you save.
                  </Text>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => bulkPct && setDrafts((prev) => applyPercent(filtered, prev, bulkSide, bulkPct))}
                    disabled={!bulkPct || !filtered.length}
                  >
                    Apply
                  </Button>
                </Space>
              )}
            >
              <Button icon={<PercentageOutlined />} disabled={!items.length}>Adjust by %</Button>
            </Popover>
          )}
        </Space>

        {prices.error ? (
          <Alert type="error" showIcon message="The prices could not be loaded" />
        ) : prices.isLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
        ) : !byGroup.length ? (
          <Empty description={items.length ? 'No prices match' : 'No prices'} />
        ) : (
          byGroup.map(({ group: name, rows }) => (
            <Card
              key={name}
              size="small"
              title={<span>{name} <Text type="secondary" style={{ fontWeight: 400 }}>{rows.length}</Text></span>}
              style={{ marginBottom: 12 }}
              styles={{ body: { padding: 0 } }}
            >
              <Table
                size="small"
                rowKey="key"
                columns={columns}
                dataSource={rows}
                pagination={false}
                scroll={{ x: 900 }}
                rowClassName={(item) => (isChanged(item, drafts) ? 'unit-price-row-changed' : '')}
              />
            </Card>
          ))
        )}
      </Card>

      <Drawer
        title="Change history"
        width={isMobile ? '100%' : 900}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      >
        <Table
          size="small"
          rowKey={(h) => `${h.key}-${h.changed_at}`}
          loading={history.isLoading}
          columns={historyColumns}
          dataSource={history.data ?? []}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: 760 }}
          locale={{ emptyText: 'No prices changed yet' }}
        />
      </Drawer>

      <style>{'.unit-price-row-changed > td { background: #fff7e6 !important; }'}</style>
    </div>
  );
};

export default UnitPricesPage;
