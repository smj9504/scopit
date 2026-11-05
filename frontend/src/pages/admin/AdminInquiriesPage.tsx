/**
 * Scopit - Admin Inquiries Page
 * Superuser only - messages users sent from the in-app Help form.
 *
 * Each inquiry is also emailed to the support address with the user as
 * Reply-To; this page is the record of what is still open.
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, Table, Tag, Button, Space, Segmented, Tooltip, Typography, message } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { adminService } from '@/services/adminService';
import type { AdminInquiry, InquiryStatus } from '@/types/admin';

dayjs.extend(relativeTime);

const { Title, Paragraph, Text } = Typography;

type Filter = InquiryStatus | 'all';

const TOPIC_TAGS: Record<string, { label: string; color: string }> = {
  question: { label: 'Question', color: 'blue' },
  problem: { label: 'Problem', color: 'red' },
  idea: { label: 'Idea', color: 'green' },
  other: { label: 'Other', color: 'default' },
};

const replyHref = (inquiry: AdminInquiry) =>
  `mailto:${encodeURIComponent(inquiry.email)}?subject=${encodeURIComponent(
    'Re: your message to Scopit',
  )}`;

const AdminInquiriesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('open');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'inquiries', { filter, page }],
    queryFn: () =>
      adminService.getInquiries({
        status: filter === 'all' ? undefined : filter,
        page,
        limit: 20,
      }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: InquiryStatus }) =>
      adminService.setInquiryStatus(id, status),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'inquiries'] });
      message.success(updated.status === 'resolved' ? 'Marked resolved' : 'Reopened');
    },
    onError: () => {
      message.error('Failed to update the inquiry');
    },
  });

  const columns = [
    {
      title: 'Received',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 130,
      render: (date: string) => (
        <Tooltip title={dayjs(date).format('MMM D, YYYY h:mm A')}>
          <span>{dayjs(date).fromNow()}</span>
        </Tooltip>
      ),
    },
    {
      title: 'From',
      key: 'from',
      width: 240,
      render: (_: unknown, record: AdminInquiry) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>
            {record.userId ? (
              <Link to={`/admin/users/${record.userId}`}>{record.name || 'No name'}</Link>
            ) : (
              record.name || 'No name'
            )}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', wordBreak: 'break-all' }}>
            {record.email}
          </div>
          {record.companyName && (
            <div style={{ fontSize: 12, color: '#6b7280' }}>{record.companyName}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Topic',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (category: string) => {
        const tag = TOPIC_TAGS[category] ?? { label: category, color: 'default' };
        return <Tag color={tag.color}>{tag.label}</Tag>;
      },
    },
    {
      title: 'Message',
      key: 'message',
      render: (_: unknown, record: AdminInquiry) => (
        <div style={{ minWidth: 260 }}>
          <Paragraph
            ellipsis={{ rows: 3, expandable: true, symbol: 'more' }}
            style={{ marginBottom: 4, whiteSpace: 'pre-wrap' }}
          >
            {record.message}
          </Paragraph>
          {(record.pageUrl || record.userAgent) && (
            <Tooltip title={record.userAgent || undefined}>
              <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {record.pageUrl ? `Sent from ${record.pageUrl}` : 'Browser info'}
              </Text>
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      render: (_: unknown, record: AdminInquiry) =>
        record.status === 'resolved' ? (
          <Tooltip
            title={
              record.resolvedAt
                ? `Resolved ${dayjs(record.resolvedAt).format('MMM D, YYYY')}`
                : undefined
            }
          >
            <Tag color="green">Resolved</Tag>
          </Tooltip>
        ) : (
          <Tag color="gold">Open</Tag>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 190,
      render: (_: unknown, record: AdminInquiry) => {
        const next: InquiryStatus = record.status === 'resolved' ? 'open' : 'resolved';
        const pending =
          statusMutation.isPending && statusMutation.variables?.id === record.id;
        return (
          <Space size={4} wrap>
            <Button type="link" size="small" icon={<MailOutlined />} href={replyHref(record)}>
              Reply
            </Button>
            <Button
              size="small"
              loading={pending}
              onClick={() => statusMutation.mutate({ id: record.id, status: next })}
            >
              {next === 'resolved' ? 'Mark resolved' : 'Reopen'}
            </Button>
          </Space>
        );
      },
    },
  ];

  const openCount = data?.openCount;

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2} style={{ marginBottom: 8 }}>
        Inquiries
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Messages sent from the Help button in the app. Each one is also emailed to the support
        address; replying to that email answers the user.
      </Paragraph>

      <Card>
        <Segmented
          value={filter}
          onChange={(value) => {
            setFilter(value as Filter);
            setPage(1);
          }}
          options={[
            { value: 'open', label: openCount != null ? `Open (${openCount})` : 'Open' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all', label: 'All' },
          ]}
          style={{ marginBottom: 16 }}
        />

        <Table
          dataSource={data?.items || []}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          locale={{
            emptyText:
              filter === 'open' ? 'No open inquiries.' : 'No inquiries yet.',
          }}
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total || 0,
            showTotal: (total) => `Total ${total}`,
            onChange: (p) => setPage(p),
          }}
          scroll={{ x: 1100 }}
          size="middle"
        />
      </Card>
    </div>
  );
};

export default AdminInquiriesPage;
