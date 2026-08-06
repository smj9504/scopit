/**
 * ScopeIt - Tool Card
 */
import React from 'react';
import { Card, Tag, Button, Tooltip } from 'antd';
import { LockOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { Tool } from '@/types/tools';
import { colors, fonts, borderRadius } from '@/styles/theme';

interface ToolCardProps {
  tool: Tool;
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool }) => {
  const navigate = useNavigate();

  const handleLaunch = () => {
    if (tool.hasAccess) {
      navigate(`/app/tools/${tool.id}`);
    }
  };

  return (
    <Card
      hoverable={tool.hasAccess}
      style={{
        borderRadius: borderRadius.lg,
        opacity: tool.hasAccess ? 1 : 0.6,
        cursor: tool.hasAccess ? 'pointer' : 'default',
        height: '100%',
      }}
      styles={{ body: { height: '100%', display: 'flex', flexDirection: 'column' } }}
      onClick={handleLaunch}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={{
          margin: 0,
          fontSize: 16,
          fontFamily: fonts.heading,
          fontWeight: 700,
          color: colors.textPrimary,
        }}>
          {tool.name}
        </h3>
        {!tool.hasAccess && (
          <Tooltip title={`Requires ${tool.requiredPlan} plan`}>
            <LockOutlined style={{ color: colors.textMuted, fontSize: 16, flexShrink: 0, marginLeft: 8 }} />
          </Tooltip>
        )}
      </div>

      <p style={{
        flex: 1,
        marginTop: 8,
        marginBottom: 16,
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 1.5,
      }}>
        {tool.description}
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Tag style={{
            fontSize: 11,
            margin: 0,
            fontWeight: 600,
            color: '#fff',
            background: colors.primary,
            border: 'none',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.3px',
          }}>
            {tool.category}
          </Tag>
          {tool.tags.slice(0, 2).map(tag => (
            <Tag key={tag} style={{ fontSize: 11, margin: 0 }}>{tag}</Tag>
          ))}
        </div>
        {tool.hasAccess ? (
          <Button
            type="primary"
            icon={<ArrowRightOutlined />}
            onClick={(e) => { e.stopPropagation(); handleLaunch(); }}
            style={{ minHeight: 36, minWidth: 80 }}
          >
            Launch
          </Button>
        ) : (
          <Button disabled style={{ minHeight: 36 }}>
            Upgrade
          </Button>
        )}
      </div>
    </Card>
  );
};
