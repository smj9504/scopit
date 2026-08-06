/**
 * Scopit - Tool Access Gate
 */
import React from 'react';
import { Result, Button, Spin } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTools } from '@/hooks/useTools';

interface ToolAccessGateProps {
  toolId: string;
  children: React.ReactNode;
}

export const ToolAccessGate: React.FC<ToolAccessGateProps> = ({ toolId, children }) => {
  const navigate = useNavigate();
  const { data: tools, isLoading } = useTools();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  const tool = tools?.find(t => t.id === toolId);
  const hasAccess = tool?.hasAccess ?? false;

  if (!hasAccess) {
    return (
      <Result
        icon={<LockOutlined />}
        title="Tool Not Available"
        subTitle={
          tool
            ? `${tool.name} requires the ${tool.requiredPlan} plan.`
            : 'This tool is not available.'
        }
        extra={
          <Button type="primary" onClick={() => navigate('/app/tools')}>
            Back to Tools
          </Button>
        }
      />
    );
  }

  return <>{children}</>;
};
