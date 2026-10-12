/**
 * Scopit - Tools Launcher Page
 */
import React, { useState } from 'react';
import { Row, Col, Skeleton } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTools, useToolSessionSummary } from '@/hooks/useTools';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ToolCard } from '@/components/features/tools/ToolCard';
import { pdfEditorApi } from '@/components/features/tools/pdf-editor/pdfEditorApi';
import {
  JOB_TYPES,
  JobTypeKey,
  compareToolOrder,
  formatRelativeShort,
  getToolMeta,
} from '@/components/features/tools/toolMeta';
import type { Tool } from '@/types/tools';
import { colors, fonts } from '@/styles/theme';

type FilterKey = 'all' | JobTypeKey;

const FILTERS: { key: FilterKey; label: string }[] = [{ key: 'all', label: 'All' }, ...JOB_TYPES];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Relative date for mid-sentence use: "newest yesterday", "newest Oct 9".
const newestLabel = (iso: string) => {
  const rel = formatRelativeShort(iso);
  return `newest ${rel === 'Yesterday' || rel === 'Just now' ? rel.toLowerCase() : rel}`;
};

// ── Usage lines ───────────────────────────────────────────────────────────────
// Real counts only: total from the list endpoint's count, "newest" from the
// most recently created item. Tools that keep no history say so plainly.

const SessionUsage: React.FC<{ toolId: string; one: string; many: string }> = ({ toolId, one, many }) => {
  const { data } = useToolSessionSummary(toolId);
  if (!data) return null;
  if (data.total === 0) return <>Nothing saved yet</>;
  const newest = data.sessions[0];
  return (
    <>
      {plural(data.total, `saved ${one}`, `saved ${many}`)}
      {newest ? ` · ${newestLabel(newest.createdAt)}` : ''}
    </>
  );
};

const PdfUsage: React.FC = () => {
  const { data } = useQuery({
    queryKey: ['pdf-documents', 'summary'],
    queryFn: () => pdfEditorApi.listDocuments(0, 1),
    staleTime: 60000,
  });
  if (!data) return null;
  if (data.total === 0) return <>No documents yet</>;
  const newest = data.items[0];
  return (
    <>
      {plural(data.total, 'document', 'documents')}
      {newest ? ` · ${newestLabel(newest.createdAt)}` : ''}
    </>
  );
};

function renderUsage(tool: Tool): React.ReactNode {
  // Locked tools show their plan requirement instead (see ToolCard).
  if (!tool.hasAccess) return undefined;
  switch (tool.id) {
    case 'packing':
      return <SessionUsage toolId="packing" one="estimate" many="estimates" />;
    case 'roof_analyzer':
      return <SessionUsage toolId="roof_analyzer" one="report" many="reports" />;
    case 'pdf_editor':
      return <PdfUsage />;
    case 'item_recommender':
      return 'No saved history';
    default:
      return undefined;
  }
}

const ToolsPage: React.FC = () => {
  const { data: tools, isLoading } = useTools();
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<FilterKey>('all');

  const visibleTools = (tools ?? [])
    .filter((tool) => {
      if (filter === 'all') return true;
      // Tools without presentation metadata only show under "All".
      return getToolMeta(tool.id)?.jobTypes.includes(filter) ?? false;
    })
    .sort((a, b) => compareToolOrder(a.id, b.id));

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            fontFamily: fonts.heading,
            fontSize: 22,
            fontWeight: 700,
            margin: '0 0 4px',
            letterSpacing: '-0.01em',
            color: colors.textPrimary,
          }}
        >
          Tools
        </h1>
        <p style={{ color: colors.textSecondary, fontSize: 14, margin: 0 }}>
          Each tool works on its own. Results land in your estimates and invoices.
        </p>
      </div>

      <div
        role="group"
        aria-label="Filter by job type"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}
      >
        {FILTERS.map(({ key, label }) => {
          const on = filter === key;
          return (
            <button
              key={key}
              type="button"
              className="app-chip"
              aria-pressed={on}
              onClick={() => setFilter(key)}
              style={{
                height: isMobile ? 44 : 40,
                padding: '0 16px',
                borderRadius: 9999,
                font: 'inherit',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                background: on ? colors.primary : colors.bgWhite,
                color: on ? colors.textWhite : '#374151',
                border: `1px solid ${on ? colors.primary : colors.borderDark}`,
                touchAction: 'manipulation',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <Row gutter={[16, 16]}>
          {[1, 2, 3, 4].map((i) => (
            <Col key={i} xs={24} md={12}>
              <div
                style={{
                  background: colors.bgWhite,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 12,
                  padding: 20,
                }}
              >
                <Skeleton active avatar={{ shape: 'square', size: 44 }} paragraph={{ rows: 3 }} />
              </div>
            </Col>
          ))}
        </Row>
      ) : visibleTools.length === 0 ? (
        <div
          style={{
            background: colors.bgWhite,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            padding: '36px 20px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>
            {tools && tools.length > 0 ? 'No tools for this job type yet' : 'No tools available'}
          </div>
          {tools && tools.length > 0 && (
            <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4 }}>
              Pick another job type, or choose All.
            </div>
          )}
        </div>
      ) : (
        <Row gutter={[16, 16]} align="stretch">
          {visibleTools.map((tool) => (
            <Col key={tool.id} xs={24} md={12}>
              <ToolCard tool={tool} usage={renderUsage(tool)} />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
};

export default ToolsPage;
