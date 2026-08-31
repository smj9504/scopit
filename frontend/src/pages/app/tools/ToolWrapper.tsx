/**
 * Scopit - Tool Wrapper
 * Resolves toolId from URL, checks access, renders the appropriate tool component.
 */
import React, { Suspense } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, Button } from 'antd';
import { ToolAccessGate } from '@/components/features/tools/ToolAccessGate';
import { getToolComponent } from '@/components/features/tools/registry';
import { useTools } from '@/hooks/useTools';
import { useBackNav } from '@/hooks/useHeaderNav';
import { fonts } from '@/styles/theme';

const ToolWrapper: React.FC = () => {
  const params = useParams<{ toolId?: string; sessionId?: string }>();
  // The `tools/packing/:sessionId` route matches toolId-less — resolve it here.
  const toolId = params.toolId ?? (params.sessionId ? 'packing' : undefined);
  const navigate = useNavigate();
  const { data: tools } = useTools();
  // Optional ?sessionId= query param — lets external flows (e.g. a claimed
  // anonymous packing lead) deep-link straight into an existing tool session.
  // The `:sessionId` path param (from `tools/packing/:sessionId`) takes
  // precedence once a session has its own URL.
  const [searchParams] = useSearchParams();
  const sessionId = params.sessionId ?? searchParams.get('sessionId') ?? undefined;

  const tool = tools?.find(t => t.id === toolId);
  const ToolComponent = toolId ? getToolComponent(toolId) : null;

  useBackNav('Tools', '/app/tools');

  if (!toolId || !ToolComponent) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <p>Tool not found.</p>
        <Button onClick={() => navigate('/app/tools')}>Back to Tools</Button>
      </div>
    );
  }

  return (
    <ToolAccessGate toolId={toolId}>
      <div>
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontWeight: 600, fontFamily: fonts.heading, fontSize: 18 }}>
            {tool?.name ?? toolId}
          </span>
        </div>

        <Suspense fallback={
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin size="large" />
          </div>
        }>
          <ToolComponent sessionId={sessionId} />
        </Suspense>
      </div>
    </ToolAccessGate>
  );
};

export default ToolWrapper;
