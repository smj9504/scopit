/**
 * ScopeIt - Tools Launcher Page
 */
import React from 'react';
import { Row, Col, Spin, Empty, Typography } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';
import { useTools } from '@/hooks/useTools';
import { ToolCard } from '@/components/features/tools/ToolCard';
import { colors, fonts } from '@/styles/theme';

const { Title, Text } = Typography;

const ToolsPage: React.FC = () => {
  const { data: tools, isLoading } = useTools();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: fonts.heading, fontSize: 22, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.01em' }}>
          Tools
        </h1>
        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
          Specialized tools for restoration contractors
        </Text>
      </div>

      {!tools || tools.length === 0 ? (
        <Empty description="No tools available" />
      ) : (
        <Row gutter={[16, 16]}>
          {tools.map(tool => (
            <Col key={tool.id} xs={24} sm={12} lg={8}>
              <ToolCard tool={tool} />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
};

export default ToolsPage;
