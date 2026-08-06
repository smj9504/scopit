/**
 * Scopit - Admin Analytics Page
 * Superuser only - detailed geography and occupation analytics
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Row,
  Col,
  Table,
  Spin,
  Alert,
  Typography,
  Statistic,
} from 'antd';
import {
  EnvironmentOutlined,
  TeamOutlined,
  BankOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { adminService } from '@/services/adminService';
import type { GeographyStat } from '@/types/admin';

const { Title, Text } = Typography;

const COLORS = [
  '#1890ff',
  '#52c41a',
  '#faad14',
  '#f5222d',
  '#722ed1',
  '#13c2c2',
  '#fa8c16',
  '#eb2f96',
  '#2f54eb',
  '#52c41a',
];

const AdminAnalyticsPage: React.FC = () => {
  const { data: geoData, isLoading: geoLoading } = useQuery({
    queryKey: ['admin', 'analytics', 'geography'],
    queryFn: adminService.getGeographyAnalytics,
  });

  const { data: occData, isLoading: occLoading } = useQuery({
    queryKey: ['admin', 'analytics', 'occupation'],
    queryFn: adminService.getOccupationAnalytics,
  });

  if (geoLoading || occLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!geoData || !occData) {
    return (
      <Alert
        type="error"
        message="Failed to load analytics data"
        showIcon
      />
    );
  }

  // Prepare data for charts
  const topStates = geoData.byState.slice(0, 10);
  const occupationChartData = occData.stats.map((stat) => ({
    name: stat.occupation === 'unknown' ? 'Unknown' : stat.occupation.replace(/_/g, ' '),
    value: stat.count,
    percentage: stat.percentage,
  }));

  const geoTableColumns = [
    {
      title: 'State',
      dataIndex: 'state',
      key: 'state',
      sorter: (a: GeographyStat, b: GeographyStat) => a.state.localeCompare(b.state),
    },
    {
      title: 'Users',
      dataIndex: 'userCount',
      key: 'userCount',
      sorter: (a: GeographyStat, b: GeographyStat) => a.userCount - b.userCount,
      defaultSortOrder: 'descend' as const,
      render: (count: number) => count.toLocaleString(),
    },
    {
      title: 'Companies',
      dataIndex: 'companyCount',
      key: 'companyCount',
      sorter: (a: GeographyStat, b: GeographyStat) => a.companyCount - b.companyCount,
      render: (count: number) => count.toLocaleString(),
    },
  ];

  const occTableColumns = [
    {
      title: 'Occupation',
      dataIndex: 'occupation',
      key: 'occupation',
      render: (occ: string) => (
        <Text strong>
          {occ === 'unknown' ? 'Unknown' : occ.replace(/_/g, ' ')}
        </Text>
      ),
    },
    {
      title: 'Count',
      dataIndex: 'count',
      key: 'count',
      render: (count: number) => count.toLocaleString(),
    },
    {
      title: 'Percentage',
      dataIndex: 'percentage',
      key: 'percentage',
      render: (pct: number) => `${pct.toFixed(1)}%`,
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2} style={{ marginBottom: 24 }}>
        <BarChartOutlined style={{ marginRight: 8 }} />
        Analytics
      </Title>

      {/* Summary Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Total States"
              value={geoData.totalStates}
              prefix={<EnvironmentOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Total Users"
              value={occData.totalUsers}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Occupation Types"
              value={occData.stats.length}
              prefix={<BankOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Geography Analytics */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={14}>
          <Card title="Top 10 States by User Count">
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={topStates}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="state" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="userCount" fill="#1890ff" name="Users" />
                <Bar dataKey="companyCount" fill="#52c41a" name="Companies" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="All States">
            <Table
              dataSource={geoData.byState}
              columns={geoTableColumns}
              rowKey="state"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              size="small"
              scroll={{ y: 300 }}
            />
          </Card>
        </Col>
      </Row>

      {/* Occupation Analytics */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title="Occupation Distribution">
            <ResponsiveContainer width="100%" height={350}>
              <PieChart>
                <Pie
                  data={occupationChartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={120}
                  label={({ name, percentage }) =>
                    `${name}: ${percentage.toFixed(1)}%`
                  }
                >
                  {occupationChartData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="Occupation Breakdown">
            <Table
              dataSource={occData.stats}
              columns={occTableColumns}
              rowKey="occupation"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AdminAnalyticsPage;
