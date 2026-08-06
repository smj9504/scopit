/**
 * Scopit - Admin User Detail Page
 * Superuser only - detailed user view with login history
 */
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Row,
  Col,
  Descriptions,
  Table,
  Tag,
  Button,
  Switch,
  Spin,
  Alert,
  Avatar,
  Statistic,
  Space,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  EnvironmentOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { adminService } from '@/services/adminService';
import type { LoginLog } from '@/types/admin';
import dayjs from 'dayjs';

const { Title } = Typography;

const AdminUserDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: user, isLoading, error } = useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: () => adminService.getUserDetail(id!),
    enabled: !!id,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      adminService.toggleUserActive(userId, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'user', id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      message.success('User status updated');
    },
    onError: () => {
      message.error('Failed to update user status');
    },
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <Alert
        type="error"
        message="User Not Found"
        description="The requested user could not be found."
        showIcon
      />
    );
  }

  const loginLogColumns = [
    {
      title: 'Date',
      dataIndex: 'loginAt',
      key: 'loginAt',
      render: (date: string) => dayjs(date).format('MMM D, YYYY h:mm A'),
    },
    {
      title: 'Method',
      dataIndex: 'loginMethod',
      key: 'loginMethod',
      render: (method: string | null) => (
        <Tag color={method === 'google' ? 'blue' : 'default'}>
          {method || 'email'}
        </Tag>
      ),
    },
    {
      title: 'Location',
      key: 'location',
      render: (_: any, record: LoginLog) => {
        if (record.city || record.state) {
          return `${record.city || ''} ${record.state || ''}, ${record.country || ''}`.trim();
        }
        return record.country || '-';
      },
    },
    {
      title: 'Device',
      key: 'device',
      render: (_: any, record: LoginLog) => (
        <Space direction="vertical" size={0}>
          <span>{record.deviceType || 'Unknown'}</span>
          <span style={{ fontSize: 12, color: '#888' }}>
            {record.browser} / {record.os}
          </span>
        </Space>
      ),
    },
    {
      title: 'IP Address',
      dataIndex: 'ipAddress',
      key: 'ipAddress',
      render: (ip: string | null) => (
        <code style={{ fontSize: 12 }}>{ip || '-'}</code>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <Space style={{ marginBottom: 24 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/admin/users')}
        >
          Back to Users
        </Button>
      </Space>

      {/* User Info Card */}
      <Card style={{ marginBottom: 24 }}>
        <Row gutter={24} align="middle">
          <Col>
            <Avatar
              src={user.avatarUrl}
              icon={<UserOutlined />}
              size={80}
            />
          </Col>
          <Col flex={1}>
            <Title level={3} style={{ margin: 0 }}>
              {user.fullName || 'No name'}
            </Title>
            <Space style={{ marginTop: 8 }}>
              <MailOutlined /> {user.email}
              {user.phone && (
                <>
                  <PhoneOutlined style={{ marginLeft: 16 }} /> {user.phone}
                </>
              )}
            </Space>
            <div style={{ marginTop: 8 }}>
              {user.isActive ? (
                <Tag color="green" icon={<CheckCircleOutlined />}>
                  Active
                </Tag>
              ) : (
                <Tag color="red" icon={<CloseCircleOutlined />}>
                  Inactive
                </Tag>
              )}
              {user.isVerified && <Tag color="blue">Verified</Tag>}
              {user.isSuperuser && <Tag color="purple">Superuser</Tag>}
              <Tag>{user.role}</Tag>
            </div>
          </Col>
          <Col>
            <Space direction="vertical" align="end">
              <span>Account Status</span>
              <Switch
                checked={user.isActive}
                loading={toggleActiveMutation.isPending}
                onChange={(checked) =>
                  toggleActiveMutation.mutate({
                    userId: user.id,
                    isActive: checked,
                  })
                }
                disabled={user.isSuperuser}
                checkedChildren="Active"
                unCheckedChildren="Inactive"
              />
            </Space>
          </Col>
        </Row>
      </Card>

      <Row gutter={[24, 24]}>
        {/* Stats */}
        <Col xs={24} lg={8}>
          <Card title="Activity Statistics">
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Statistic title="Logins" value={user.loginCount} />
              </Col>
              <Col span={12}>
                <Statistic title="Estimates" value={user.estimateCount} />
              </Col>
              <Col span={12}>
                <Statistic title="Invoices" value={user.invoiceCount} />
              </Col>
              <Col span={12}>
                <Statistic title="Customers" value={user.customerCount} />
              </Col>
            </Row>
          </Card>
        </Col>

        {/* Profile Details */}
        <Col xs={24} lg={16}>
          <Card title="Profile Details">
            <Descriptions column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="Company">
                {user.companyName || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Occupation">
                {user.occupation?.replace('_', ' ') || '-'}
                {user.occupationOther && ` (${user.occupationOther})`}
              </Descriptions.Item>
              <Descriptions.Item label="Business Type">
                {user.businessType || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Years in Business">
                {user.yearsInBusiness ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Signup Location">
                <EnvironmentOutlined style={{ marginRight: 4 }} />
                {user.signupCity && `${user.signupCity}, `}
                {user.signupState || '-'}
                {user.signupCountry && `, ${user.signupCountry}`}
              </Descriptions.Item>
              <Descriptions.Item label="Last Login Location">
                <EnvironmentOutlined style={{ marginRight: 4 }} />
                {user.lastLoginCity && `${user.lastLoginCity}, `}
                {user.lastLoginState || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Joined">
                {dayjs(user.createdAt).format('MMMM D, YYYY')}
              </Descriptions.Item>
              <Descriptions.Item label="Last Login">
                {user.lastLoginAt
                  ? dayjs(user.lastLoginAt).format('MMMM D, YYYY h:mm A')
                  : 'Never'}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* Login History */}
      <Card title="Login History" style={{ marginTop: 24 }}>
        <Table
          dataSource={user.recentLogins}
          columns={loginLogColumns}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          size="small"
        />
      </Card>
    </div>
  );
};

export default AdminUserDetailPage;
