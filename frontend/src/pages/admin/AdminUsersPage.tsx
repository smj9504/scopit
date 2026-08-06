/**
 * Scopit - Admin Users Page
 * Superuser only - user management and listing
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Table,
  Input,
  Select,
  Space,
  Tag,
  Button,
  Switch,
  message,
  Typography,
  Avatar,
} from 'antd';
import {
  SearchOutlined,
  UserOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { adminService } from '@/services/adminService';
import type { AdminUser } from '@/types/admin';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { Title } = Typography;

const OCCUPATION_OPTIONS = [
  { value: '', label: 'All Occupations' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'public_adjuster', label: 'Public Adjuster' },
  { value: 'attorney', label: 'Attorney' },
  { value: 'other', label: 'Other' },
];

const AdminUsersPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [occupation, setOccupation] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', { page, search, occupation }],
    queryFn: () =>
      adminService.getUsers({
        page,
        limit: 20,
        search: search || undefined,
        occupation: occupation || undefined,
      }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({
      userId,
      isActive,
    }: {
      userId: string;
      isActive: boolean;
    }) => adminService.toggleUserActive(userId, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      message.success('User status updated');
    },
    onError: () => {
      message.error('Failed to update user status');
    },
  });

  const columns = [
    {
      title: 'User',
      key: 'user',
      width: 280,
      render: (_: any, record: AdminUser) => (
        <Space>
          <Avatar
            src={record.avatarUrl}
            icon={<UserOutlined />}
            size="small"
          />
          <div>
            <div style={{ fontWeight: 500 }}>
              {record.fullName || 'No name'}
            </div>
            <div style={{ fontSize: 12, color: '#888' }}>{record.email}</div>
          </div>
        </Space>
      ),
    },
    {
      title: 'Company',
      dataIndex: 'companyName',
      key: 'companyName',
      width: 180,
      render: (name: string | null) => name || '-',
    },
    {
      title: 'Occupation',
      dataIndex: 'occupation',
      key: 'occupation',
      width: 130,
      render: (occ: string | null) =>
        occ ? (
          <Tag color="blue">{occ.replace('_', ' ')}</Tag>
        ) : (
          <Tag>Unknown</Tag>
        ),
    },
    {
      title: 'Location',
      key: 'location',
      width: 140,
      render: (_: any, record: AdminUser) => {
        if (record.signupState) {
          return (
            <span>
              {record.signupCity && `${record.signupCity}, `}
              {record.signupState}
            </span>
          );
        }
        return '-';
      },
    },
    {
      title: 'Logins',
      dataIndex: 'loginCount',
      key: 'loginCount',
      width: 80,
      align: 'center' as const,
    },
    {
      title: 'Last Login',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 140,
      render: (date: string | null) =>
        date ? dayjs(date).fromNow() : 'Never',
    },
    {
      title: 'Joined',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (date: string) => dayjs(date).format('MMM D, YYYY'),
    },
    {
      title: 'Status',
      key: 'status',
      width: 100,
      render: (_: any, record: AdminUser) => (
        <Space direction="vertical" size={0}>
          {record.isActive ? (
            <Tag color="green" icon={<CheckCircleOutlined />}>
              Active
            </Tag>
          ) : (
            <Tag color="red" icon={<CloseCircleOutlined />}>
              Inactive
            </Tag>
          )}
          {record.isSuperuser && <Tag color="purple">Superuser</Tag>}
        </Space>
      ),
    },
    {
      title: 'Active',
      key: 'toggleActive',
      width: 80,
      render: (_: any, record: AdminUser) => (
        <Switch
          checked={record.isActive}
          loading={toggleActiveMutation.isPending}
          onChange={(checked) =>
            toggleActiveMutation.mutate({
              userId: record.id,
              isActive: checked,
            })
          }
          disabled={record.isSuperuser}
        />
      ),
    },
    {
      title: '',
      key: 'action',
      width: 80,
      render: (_: any, record: AdminUser) => (
        <Button
          type="link"
          size="small"
          onClick={() => navigate(`/admin/users/${record.id}`)}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2} style={{ marginBottom: 24 }}>
        User Management
      </Title>

      <Card>
        {/* Filters */}
        <Space style={{ marginBottom: 16 }} wrap>
          <Input
            placeholder="Search email or name..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ width: 250 }}
            size="large"
            allowClear
          />
          <Select
            value={occupation}
            onChange={(value) => {
              setOccupation(value);
              setPage(1);
            }}
            style={{ width: 180 }}
            size="large"
            options={OCCUPATION_OPTIONS}
          />
        </Space>

        {/* Table */}
        <Table
          dataSource={data?.items || []}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total || 0,
            showTotal: (total) => `Total ${total} users`,
            onChange: (p) => setPage(p),
          }}
          scroll={{ x: 1200 }}
          size="middle"
        />
      </Card>
    </div>
  );
};

export default AdminUsersPage;
