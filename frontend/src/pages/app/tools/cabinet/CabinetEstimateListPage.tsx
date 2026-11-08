import React, { useState, useCallback } from 'react';
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
  FileExcelOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AppstoreOutlined } from '@ant-design/icons';
import { PRODUCT_LIBRARY_PATH, cabinetEstimatePath } from '@/components/features/tools/cabinet-estimate/paths';
import { cabinetEstimateService } from '@/services/cabinetEstimateService';
import type { CabinetEstimate, EstimateStatus, KitchenProjectType } from '@/types/cabinetEstimate';
import { memberName } from '@/types/cabinetEstimate';
import { PROJECT_TYPE_HINTS, PROJECT_TYPE_LABELS } from '@/components/features/tools/cabinet-estimate/KitchenGroupBar';
import KitchenDesignQuoteModal from '@/components/features/tools/cabinet-estimate/KitchenDesignQuoteModal';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const STATUS_COLORS: Record<EstimateStatus, string> = {
  draft: 'default',
  calculated: 'processing',
  approved: 'success',
  exported: 'purple',
};

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** A job's figure: the restoration's total, or the range of a remodel's options. */
const jobTotal = (record: CabinetEstimate): string => {
  if (record.project_type !== 'remodel') return record.total ? money(record.total) : '-';
  const totals = (record.group_members || []).map((m) => m.total).filter((t) => t > 0);
  if (!totals.length) return '-';
  const low = Math.min(...totals);
  const high = Math.max(...totals);
  return low === high ? money(low) : `${dollars(low)}–${dollars(high)}`;
};

/** The job's estimates beyond the one the row's figure is. */
const optionsNote = (record: CabinetEstimate): string | null => {
  const options = (record.group_members || []).filter((m) => m.kind === 'option');
  if (record.project_type === 'remodel') return options.length > 1 ? `${options.length} options` : null;
  return options.length ? `+ ${options.length} upgrade option${options.length === 1 ? '' : 's'}` : null;
};

/** Each estimate of the job with its total, for the note's tooltip. */
const membersSummary = (record: CabinetEstimate) => (
  <div style={{ fontVariantNumeric: 'tabular-nums' }}>
    {(record.group_members || []).map((m) => (
      <div key={m.id}>{memberName(m)}: {m.total ? dollars(m.total) : 'not calculated'}</div>
    ))}
  </div>
);

const ProjectTypeTag: React.FC<{ record: CabinetEstimate }> = ({ record }) => (
  <Tag color={record.project_type === 'remodel' ? 'green' : 'blue'}>
    {PROJECT_TYPE_LABELS[record.project_type || 'insurance']}
  </Tag>
);

/** The Cabinet Estimator's home: one row per kitchen job. */
const CabinetEstimateList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [designQuoteFor, setDesignQuoteFor] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['cabinet-estimates', { search, status: statusFilter, page, page_size: pageSize }],
    queryFn: () =>
      cabinetEstimateService.list({
        search: search || undefined,
        status: statusFilter,
        grouped: true,
        page,
        page_size: pageSize,
      }),
  });

  // A row is a whole kitchen job, so deleting it deletes all its estimates
  const deleteMutation = useMutation({
    mutationFn: (id: string) => cabinetEstimateService.delete(id, { wholeGroup: true }),
    onSuccess: () => {
      message.success('Estimate deleted');
      queryClient.invalidateQueries({ queryKey: ['cabinet-estimates'] });
    },
  });

  const deletePrompt = (record: CabinetEstimate) => {
    const count = record.group_members?.length || 1;
    return count > 1 ? `Delete this job and all ${count} of its estimates?` : 'Delete this estimate?';
  };

  const cloneMutation = useMutation({
    mutationFn: (id: string) => cabinetEstimateService.clone(id),
    onSuccess: (result) => {
      message.success('Estimate cloned');
      navigate(cabinetEstimatePath(result.id));
    },
  });

  const handleCreate = useCallback(async (projectType: KitchenProjectType) => {
    try {
      const result = await cabinetEstimateService.create({ boxes: [], project_type: projectType });
      navigate(cabinetEstimatePath(result.id));
    } catch {
      message.error('Failed to create estimate');
    }
  }, [navigate]);

  // A new job: an insurance claim starts with its restoration, a remodel with Option A
  const createMenu = {
    items: (['insurance', 'remodel'] as const).map((type) => ({
      key: type,
      label: (
        <div>
          <div>{PROJECT_TYPE_LABELS[type]}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{PROJECT_TYPE_HINTS[type]}</Text>
        </div>
      ),
    })),
    onClick: ({ key }: { key: string }) => handleCreate(key as KitchenProjectType),
  };

  const columns = [
    {
      title: 'Property Address',
      dataIndex: 'property_address',
      key: 'property_address',
      render: (text: string, record: CabinetEstimate) => (
        <a onClick={() => navigate(cabinetEstimatePath(record.id))}>
          {text || 'Untitled'}
        </a>
      ),
    },
    {
      title: 'Type',
      key: 'type',
      width: 130,
      render: (_: any, record: CabinetEstimate) => <ProjectTypeTag record={record} />,
    },
    {
      title: 'Customer',
      dataIndex: 'client_name',
      key: 'client_name',
      render: (text: string) => text || '-',
    },
    {
      title: 'Claim #',
      dataIndex: 'claim_number',
      key: 'claim_number',
      render: (text: string) => text || '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: EstimateStatus) => (
        <Tag color={STATUS_COLORS[status] || 'default'}>{status.toUpperCase()}</Tag>
      ),
    },
    {
      title: 'Tier',
      dataIndex: 'tier',
      key: 'tier',
      width: 120,
      render: (text: string) => text || '-',
    },
    {
      title: 'Total',
      key: 'total',
      width: 150,
      align: 'right' as const,
      render: (_: any, record: CabinetEstimate) => {
        const note = optionsNote(record);
        return (
          <div style={{ fontVariantNumeric: 'tabular-nums' }}>
            <div>{jobTotal(record)}</div>
            {note && (
              <Tooltip title={membersSummary(record)}>
                <Text type="secondary" style={{ fontSize: 12 }}>{note}</Text>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 110,
      render: (text: string) => (text ? new Date(text).toLocaleDateString() : '-'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_: any, record: CabinetEstimate) => (
        <Space size="small">
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => cloneMutation.mutate(record.id)}
            title="Clone"
          />
          {/* A click is the itemized quote, as ever; the other format is on hover. */}
          <Dropdown
            disabled={record.status === 'draft'}
            menu={{
              items: [{ key: 'design', label: 'Design quote (drawings optional)…' }],
              onClick: () => setDesignQuoteFor(record.id),
            }}
          >
            <Button
              size="small"
              icon={<FilePdfOutlined />}
              onClick={() => cabinetEstimateService.exportPdf(record.id, { address: record.property_address })}
              title="Export PDF"
              disabled={record.status === 'draft'}
            />
          </Dropdown>
          <Button
            size="small"
            icon={<FileExcelOutlined />}
            onClick={() => cabinetEstimateService.exportExcel(record.id)}
            title="Export Excel"
            disabled={!record.boxes?.length}
          />
          <Popconfirm
            title={deletePrompt(record)}
            onConfirm={() => deleteMutation.mutate(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} title="Delete" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const renderMobileItem = (record: CabinetEstimate) => (
    <List.Item
      style={{ padding: '12px 0' }}
      actions={[
        <Dropdown
          key="actions"
          menu={{
            items: [
              {
                key: 'clone',
                icon: <CopyOutlined />,
                label: 'Clone',
                onClick: () => cloneMutation.mutate(record.id),
              },
              {
                key: 'pdf',
                icon: <FilePdfOutlined />,
                label: 'Export PDF',
                disabled: record.status === 'draft',
                onClick: () => cabinetEstimateService.exportPdf(record.id, { address: record.property_address }),
              },
              {
                key: 'design-quote',
                icon: <FilePdfOutlined />,
                label: 'Export design quote…',
                disabled: record.status === 'draft',
                onClick: () => setDesignQuoteFor(record.id),
              },
              {
                key: 'excel',
                icon: <FileExcelOutlined />,
                label: 'Export Excel',
                disabled: !record.boxes?.length,
                onClick: () => cabinetEstimateService.exportExcel(record.id),
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
        onClick={() => navigate(cabinetEstimatePath(record.id))}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <Tag color={STATUS_COLORS[record.status] || 'default'}>{record.status.toUpperCase()}</Tag>
          <ProjectTypeTag record={record} />
          {record.tier && <Tag>{record.tier}</Tag>}
        </div>
        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 2 }}>
          {record.property_address || 'Untitled'}
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

  return (
    <div>
      <KitchenDesignQuoteModal estimateId={designQuoteFor} onClose={() => setDesignQuoteFor(null)} />
      <Card
        title={<Title level={5} style={{ margin: 0 }}>Kitchen jobs</Title>}
        extra={
          <Space>
            <Tooltip title="The products upgrade options are built from">
              <Button icon={<AppstoreOutlined />} onClick={() => navigate(PRODUCT_LIBRARY_PATH)}>
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
            allowClear
            style={{ width: isMobile ? '100%' : 150 }}
            value={statusFilter}
            onChange={(val) => { setStatusFilter(val); setPage(1); }}
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
            dataSource={data?.items || []}
            columns={columns}
            rowKey="id"
            loading={isLoading}
            pagination={{
              current: page,
              pageSize,
              total: data?.total || 0,
              showSizeChanger: true,
              showTotal: (total) => `Total ${total} estimates`,
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            }}
            size="middle"
          />
        )}
      </Card>
    </div>
  );
};

export default CabinetEstimateList;
