/**
 * Scopit - Admin Dashboard Page
 * Superuser only - displays KPIs and analytics
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Tag,
  Spin,
  Alert,
  Typography,
} from 'antd';
import {
  UserOutlined,
  TeamOutlined,
  FileTextOutlined,
  RiseOutlined,
  LoginOutlined,
} from '@ant-design/icons';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { adminService } from '@/services/adminService';
import type { UserSummary } from '@/types/admin';
import dayjs from 'dayjs';

const { Title } = Typography;

const COLORS = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2'];

const AdminDashboardPage: React.FC = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: adminService.getDashboard,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        type="error"
        message="Access Denied"
        description="You do not have permission to access this page."
        showIcon
      />
    );
  }

  if (!data) return null;

  const recentUsersColumns = [
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      ellipsis: true,
    },
    {
      title: 'Name',
      dataIndex: 'fullName',
      key: 'fullName',
      render: (name: string | null) => name || '-',
    },
    {
      title: 'Company',
      dataIndex: 'companyName',
      key: 'companyName',
      render: (name: string | null) => name || '-',
    },
    {
      title: 'Occupation',
      dataIndex: 'occupation',
      key: 'occupation',
      render: (occ: string | null) =>
        occ ? <Tag color="blue">{occ}</Tag> : '-',
    },
    {
      title: 'State',
      dataIndex: 'signupState',
      key: 'signupState',
      render: (state: string | null) => state || '-',
    },
    {
      title: 'Joined',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => dayjs(date).format('MMM D, YYYY'),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2} style={{ marginBottom: 24 }}>
        Admin Dashboard
      </Title>

      {/* KPI Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total Users"
              value={data.totalUsers}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="New This Month"
              value={data.newUsersThisMonth}
              prefix={<RiseOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Active Today"
              value={data.activeUsersToday}
              prefix={<LoginOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total Companies"
              value={data.totalCompanies}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Document Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total Estimates"
              value={data.totalEstimates}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Estimates This Month"
              value={data.estimatesThisMonth}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total Invoices"
              value={data.totalInvoices}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Invoices This Month"
              value={data.invoicesThisMonth}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Charts */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={14}>
          <Card title="User Growth (Last 30 Days)">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.userGrowthData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => dayjs(d).format('M/D')}
                />
                <YAxis allowDecimals={false} />
                <Tooltip
                  labelFormatter={(d) => dayjs(d).format('MMM D, YYYY')}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#1890ff"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="New Users"
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Occupation Distribution">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={data.occupationStats}
                  dataKey="count"
                  nameKey="occupation"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ occupation, percentage }) =>
                    `${occupation}: ${percentage}%`
                  }
                >
                  {data.occupationStats.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      {/* Recent Users Table */}
      <Card title="Recent Signups">
        <Table
          dataSource={data.recentUsers}
          columns={recentUsersColumns}
          rowKey="id"
          pagination={false}
          size="small"
        />
      </Card>
    </div>
  );
};

export default AdminDashboardPage;
