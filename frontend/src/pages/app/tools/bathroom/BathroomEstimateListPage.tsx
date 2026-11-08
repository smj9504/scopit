import React, { useState } from 'react';
import {
  Button,
  Card,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  Popconfirm,
  Grid,
  List,
  Dropdown,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DeleteOutlined,
  CopyOutlined,
  FilePdfOutlined,
  MoreOutlined,
  AppstoreOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { bathroomEstimateService } from '@/services/bathroomEstimateService';
import type { BathroomEstimate, BathroomProjectType } from '@/types/bathroomEstimate';
import { PROJECT_TYPE_LABELS } from '@/components/features/tools/bathroom-estimate/BEGroupBar';
import {
  BATHROOM_PRICES_PATH,
  BATHROOM_PRODUCT_LIBRARY_PATH,
  bathroomEstimatePath,
} from '@/components/features/tools/bathroom-estimate/paths';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const STATUS_COLORS: Record<string, string> = {
  draft: 'default',
  calculated: 'processing',
  approved: 'success',
  exported: 'purple',
};

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** A job's figure: the restoration's total, or the range of a remodel's options. */
const jobTotal = (record: BathroomEstimate): string => {
  if (record.project_type !== 'remodel') return record.total ? money(record.total) : '-';
  const totals = (record.group_members || []).map((m) => m.total).filter((t) => t > 0);
  if (!totals.length) return '-';
  const low = Math.min(...totals);
  const high = Math.max(...totals);
  return low === high ? money(low) : `${dollars(low)}–${dollars(high)}`;
};

/** The job's estimates beyond the one the row's figure is. */
const optionsNote = (record: BathroomEstimate): string | null => {
  const options = (record.group_members || []).filter((m) => m.kind === 'option');
  if (record.project_type === 'remodel') return options.length > 1 ? `${options.length} options` : null;
  return options.length ? `+ ${options.length} upgrade option${options.length === 1 ? '' : 's'}` : null;
};

/** The Bathroom Estimator's home: one row per bathroom job. */
const BathroomEstimateList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['bathroom-estimates', { search, status: statusFilter, page, page_size: pageSize }],
    queryFn: () =>
      bathroomEstimateService.list({
        search: search || undefined,
        status: statusFilter,
        grouped: true,
        page,
        page_size: pageSize,
      }),
  });

  // A row is a whole bathroom job, so deleting it deletes all its estimates
  const deleteMutation = useMutation({
    mutationFn: (id: string) => bathroomEstimateService.delete(id, { wholeGroup: true }),
    onSuccess: () => {
      message.success('Estimate deleted');
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimates'] });
    },
  });

  const deletePrompt = (record: BathroomEstimate) => {
    const count = record.group_members?.length || 1;
    return count > 1 ? `Delete this job and all ${count} of its estimates?` : 'Delete this estimate?';
  };

  const cloneMutation = useMutation({
    mutationFn: (id: string) => bathroomEstimateService.clone(id),
    onSuccess: (result) => {
      message.success('Estimate cloned');
      navigate(bathroomEstimatePath(result.id));
    },
  });

  const handleCreate = async (projectType: BathroomProjectType) => {
    try {
      const result = await bathroomEstimateService.create({ project_type: projectType });
      navigate(bathroomEstimatePath(result.id));
    } catch {
      message.error('Failed to create estimate');
    }
  };

  const createMenu = {
    items: [
      {
        key: 'insurance',
        label: (
          <div>
            <div>{PROJECT_TYPE_LABELS.insurance}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>Restoration for the carrier, upgrade options for the customer</Text>
          </div>
        ),
      },
      {
        key: 'remodel',
        label: (
          <div>
            <div>{PROJECT_TYPE_LABELS.remodel}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>Options for the customer, no insurance</Text>
          </div>
        ),
      },
    ],
    onClick: ({ key }: { key: string }) => handleCreate(key as BathroomProjectType),
  };

  const columns = [
    {
      title: 'Address',
      key: 'address',
      render: (_: any, record: BathroomEstimate) => {
        const parts = [record.property_address];
        const cityStateZip = [
          record.city,
          record.state ? (record.zip_code ? `${record.state} ${record.zip_code}` : record.state) : record.zip_code,
        ].filter(Boolean).join(', ');
        if (cityStateZip) parts.push(cityStateZip);
        const full = parts.filter(Boolean).join(', ');
        return (
          <a onClick={() => navigate(bathroomEstimatePath(record.id))}>
            {full || 'No address'}
          </a>
        );
      },
    },
    {
      title: 'Bathroom',
      key: 'bathroom',
      render: (_: any, record: BathroomEstimate) => {
        const d = (record.designation || '').replace(/_/g, ' ');
        const f = (record.bath_function || '').replace(/_/g, ' ');
        return `${d} ${f}`.trim() || '-';
      },
    },
    {
      title: 'Type',
      key: 'type',
      render: (_: any, record: BathroomEstimate) => (
        <Tag color={record.project_type === 'remodel' ? 'green' : 'blue'}>
          {PROJECT_TYPE_LABELS[record.project_type || 'insurance']}
        </Tag>
      ),
    },
    {
      title: 'Customer',
      dataIndex: 'client_name',
      key: 'client',
      render: (name: string) => name || '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status] || 'default'}>
          {status?.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Total',
      key: 'total',
      align: 'right' as const,
      render: (_: any, record: BathroomEstimate) => {
        const note = optionsNote(record);
        return (
          <div style={{ fontVariantNumeric: 'tabular-nums' }}>
            <div>{jobTotal(record)}</div>
            {note && <Text type="secondary" style={{ fontSize: 12 }}>{note}</Text>}
          </div>
        );
      },
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) =>
        date ? new Date(date).toLocaleDateString() : '-',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_: any, record: BathroomEstimate) => (
        <Space size="small">
          <Button
            size="small"
            icon={<FilePdfOutlined />}
            onClick={() => bathroomEstimateService.exportPdf(record.id, { address: record.property_address })}
            disabled={record.status === 'draft'}
          />
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => cloneMutation.mutate(record.id)}
          />
          <Popconfirm
            title={deletePrompt(record)}
            onConfirm={() => deleteMutation.mutate(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const renderMobileItem = (record: BathroomEstimate) => {
    const desc = (record.designation || '').replace(/_/g, ' ');
    const func = (record.bath_function || '').replace(/_/g, ' ');
    const bathLabel = `${desc} ${func}`.trim();

    return (
      <List.Item
        style={{ padding: '12px 0' }}
        actions={[
          <Dropdown
            key="actions"
            menu={{
              items: [
                {
                  key: 'pdf',
                  icon: <FilePdfOutlined />,
                  label: 'Export PDF',
                  disabled: record.status === 'draft',
                  onClick: () => bathroomEstimateService.exportPdf(record.id, { address: record.property_address }),
                },
                {
                  key: 'clone',
                  icon: <CopyOutlined />,
                  label: 'Clone',
                  onClick: () => cloneMutation.mutate(record.id),
                },
                { type: 'divider' as const },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: 'Delete',
                  danger: true,
                  onClick: () => {
                    if (window.confirm(deletePrompt(record))) {
                      deleteMutation.mutate(record.id);
                    }
                  },
                },
              ],
            }}
            trigger={['click']}
          >
            <Button type="text" icon={<MoreOutlined />} />
          </Dropdown>,
        ]}
      >
        <div
          style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}
          onClick={() => navigate(bathroomEstimatePath(record.id))}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <Tag color={STATUS_COLORS[record.status] || 'default'}>{record.status?.toUpperCase()}</Tag>
            <Tag color={record.project_type === 'remodel' ? 'green' : 'blue'}>
              {PROJECT_TYPE_LABELS[record.project_type || 'insurance']}
            </Tag>
            {bathLabel && <Text type="secondary" style={{ fontSize: 12 }}>{bathLabel}</Text>}
          </div>
          <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 2 }}>
            {[
              record.property_address,
              [record.city, record.state ? (record.zip_code ? `${record.state} ${record.zip_code}` : record.state) : record.zip_code].filter(Boolean).join(', '),
            ].filter(Boolean).join(', ') || 'No address'}
          </Text>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {record.client_name && (
              <Text type="secondary" style={{ fontSize: 12 }}>{record.client_name}</Text>
            )}
            {jobTotal(record) !== '-' && (
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
                {jobTotal(record)}
              </Text>
            )}
            {optionsNote(record) && (
              <Text type="secondary" style={{ fontSize: 12 }}>{optionsNote(record)}</Text>
            )}
            {record.created_at && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(record.created_at).toLocaleDateString()}
              </Text>
            )}
          </div>
        </div>
      </List.Item>
    );
  };

  return (
    <div>
      <Card
        title={<Title level={5} style={{ margin: 0 }}>Bathroom jobs</Title>}
        extra={
          <Space>
            <Tooltip title="Your company's prices for bathroom estimates">
              <Button icon={<DollarOutlined />} onClick={() => navigate(BATHROOM_PRICES_PATH)} aria-label="Prices">
                {isMobile ? null : 'Prices'}
              </Button>
            </Tooltip>
            <Tooltip title="The products upgrade options are built from">
              <Button icon={<AppstoreOutlined />} onClick={() => navigate(BATHROOM_PRODUCT_LIBRARY_PATH)}>
                {isMobile ? 'Products' : 'Product library'}
              </Button>
            </Tooltip>
            <Dropdown menu={createMenu} trigger={['click']} placement="bottomRight">
              <Button type="primary" icon={<PlusOutlined />}>
                {isMobile ? 'New' : 'New estimate'}
              </Button>
            </Dropdown>
          </Space>
        }
        styles={{
          header: isMobile ? { padding: '0 12px' } : undefined,
          body: isMobile ? { padding: '12px' } : undefined,
        }}
      >
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: 8,
          marginBottom: 16,
        }}>
          <Input
            placeholder="Search by address, customer or claim #…"
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            allowClear
            style={{ flex: 1 }}
          />
          <Select
            placeholder="Status"
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            allowClear
            style={{ width: isMobile ? '100%' : 150 }}
            options={[
              { label: 'Draft', value: 'draft' },
              { label: 'Calculated', value: 'calculated' },
              { label: 'Approved', value: 'approved' },
              { label: 'Exported', value: 'exported' },
            ]}
          />
        </div>

        {isMobile ? (
          <List
            dataSource={data?.items || []}
            loading={isLoading}
            renderItem={renderMobileItem}
            pagination={{
              current: page,
              pageSize,
              total: data?.total || 0,
              size: 'small',
              showTotal: (total) => `${total} estimates`,
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            }}
          />
        ) : (
          <Table
            columns={columns}
            dataSource={data?.items || []}
            rowKey="id"
            loading={isLoading}
            pagination={{
              current: page,
              pageSize,
              total: data?.total || 0,
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
              showSizeChanger: true,
              showTotal: (total) => `Total ${total} estimates`,
            }}
          />
        )}
      </Card>
    </div>
  );
};

export default BathroomEstimateList;
