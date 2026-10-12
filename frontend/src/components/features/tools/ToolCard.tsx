/**
 * Scopit - Tool Card
 */
import React from 'react';
import { Button, Tooltip } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { Tool } from '@/types/tools';
import { colors, fonts, shadows } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { GridIcon, TOOL_TINT, getJobTagLabels, getToolMeta } from './toolMeta';

interface ToolCardProps {
  tool: Tool;
  /** Footer usage line (e.g. saved-work count). Omitted when unknown. */
  usage?: React.ReactNode;
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool, usage }) => {
  const isMobile = useIsMobile();
  const meta = getToolMeta(tool.id);
  const Icon = meta?.Icon ?? GridIcon;
  // Unknown (newly added) tools fall back to the API's own copy.
  const tags = meta ? getJobTagLabels(meta) : [tool.category];
  const description = meta?.description ?? tool.description;
  const headingId = `tool-card-${tool.id}`;

  return (
    <article
      aria-labelledby={headingId}
      className="app-tile"
      style={{
        background: colors.bgWhite,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: isMobile ? 16 : 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        boxShadow: shadows.card,
        height: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: 11,
            background: TOOL_TINT.bg,
            color: TOOL_TINT.fg,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={22} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
          <h2
            id={headingId}
            style={{
              margin: 0,
              fontFamily: fonts.heading,
              fontSize: 17,
              fontWeight: 700,
              color: colors.textPrimary,
              letterSpacing: '-0.01em',
            }}
          >
            {tool.name}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#374151',
                  background: colors.bgSunken,
                  padding: '2px 8px',
                  borderRadius: 9999,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        {!tool.hasAccess && (
          <Tooltip title={`Requires ${tool.requiredPlan} plan`}>
            <LockOutlined
              aria-label={`Locked: requires ${tool.requiredPlan} plan`}
              style={{ color: colors.textSecondary, fontSize: 16, flexShrink: 0, alignSelf: 'flex-start' }}
            />
          </Tooltip>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: colors.textSecondary }}>{description}</p>

      {meta?.comingSoon && (
        <div
          style={{
            display: 'flex',
            flexWrap: isMobile ? 'wrap' : 'nowrap',
            gap: isMobile ? '2px 8px' : 8,
            alignItems: 'baseline',
            padding: '8px 12px',
            border: `1.5px dashed ${colors.textMuted}`,
            borderRadius: 8,
            fontSize: 13,
            color: '#374151',
          }}
        >
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Coming soon</span>
          <span>{meta.comingSoon}</span>
        </div>
      )}

      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          paddingTop: 4,
        }}
      >
        <span style={{ fontSize: 13, color: colors.textSecondary, minWidth: 0 }}>
          {tool.hasAccess ? usage : `Requires ${tool.requiredPlan} plan`}
        </span>
        {tool.hasAccess ? (
          <Link
            to={`/app/tools/${tool.id}`}
            aria-label={`Open ${tool.name}`}
            className="app-btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: isMobile ? 44 : 40,
              padding: '0 16px',
              borderRadius: 8,
              background: colors.primary,
              color: colors.textWhite,
              fontSize: 14,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            Open
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        ) : (
          <Button disabled style={{ height: isMobile ? 44 : 40, flexShrink: 0 }}>
            Upgrade
          </Button>
        )}
      </div>
    </article>
  );
};
