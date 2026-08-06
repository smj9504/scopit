/**
 * ScopeIt - Tool Service
 */
import api from './api';
import type {
  Tool,
  ToolSession,
  ToolSessionCreate,
  ToolSessionUpdate,
  CreateEstimateFromToolRequest,
  CreateEstimateFromToolResponse,
  CreateInvoiceFromToolRequest,
  CreateInvoiceFromToolResponse,
} from '@/types/tools';

const transformTool = (data: any): Tool => ({
  id: data.id,
  name: data.name,
  description: data.description,
  icon: data.icon,
  category: data.category,
  requiredPlan: data.required_plan,
  version: data.version,
  tags: data.tags || [],
  hasAccess: data.has_access,
  canCreateEstimate: data.can_create_estimate,
});

const transformSession = (data: any): ToolSession => ({
  id: data.id,
  toolId: data.tool_id,
  name: data.name,
  data: data.data || {},
  createdAt: data.created_at,
  updatedAt: data.updated_at,
});

export const toolService = {
  // Tool registry
  listTools: async (): Promise<Tool[]> => {
    const response = await api.get<any[]>('/tools');
    return response.data.map(transformTool);
  },

  checkAccess: async (toolId: string): Promise<boolean> => {
    const response = await api.get<{ has_access: boolean }>(`/tools/${toolId}/access`);
    return response.data.has_access;
  },

  // Session management
  listSessions: async (toolId?: string): Promise<ToolSession[]> => {
    const response = await api.get<any[]>('/tools/sessions', {
      params: toolId ? { tool_id: toolId } : undefined,
    });
    return response.data.map(transformSession);
  },

  listSessionsPaged: async (params: {
    toolId?: string;
    skip?: number;
    limit?: number;
  }): Promise<{ sessions: ToolSession[]; total: number }> => {
    const response = await api.get<any[]>('/tools/sessions', {
      params: {
        tool_id: params.toolId,
        skip: params.skip ?? 0,
        limit: params.limit ?? 20,
      },
    });
    const total = Number(response.headers['x-total-count'] ?? response.data.length);
    return { sessions: response.data.map(transformSession), total };
  },

  createSession: async (data: ToolSessionCreate): Promise<ToolSession> => {
    const response = await api.post<any>('/tools/sessions', data);
    return transformSession(response.data);
  },

  getSession: async (sessionId: string): Promise<ToolSession> => {
    const response = await api.get<any>(`/tools/sessions/${sessionId}`);
    return transformSession(response.data);
  },

  updateSession: async (sessionId: string, data: ToolSessionUpdate): Promise<ToolSession> => {
    const response = await api.patch<any>(`/tools/sessions/${sessionId}`, data);
    return transformSession(response.data);
  },

  deleteSession: async (sessionId: string): Promise<void> => {
    await api.delete(`/tools/sessions/${sessionId}`);
  },

  // Tool → Estimate bridge
  createEstimateFromSession: async (
    sessionId: string,
    data?: CreateEstimateFromToolRequest,
  ): Promise<CreateEstimateFromToolResponse> => {
    const response = await api.post<any>(`/tools/sessions/${sessionId}/create-estimate`, data || {});
    return {
      estimateId: response.data.estimate_id,
      estimateNumber: response.data.estimate_number,
    };
  },
  // Tool → Invoice bridge
  createInvoiceFromSession: async (
    sessionId: string,
    data?: CreateInvoiceFromToolRequest,
  ): Promise<CreateInvoiceFromToolResponse> => {
    const response = await api.post<any>(`/tools/sessions/${sessionId}/create-invoice`, data || {});
    return {
      invoiceId: response.data.invoice_id,
      invoiceNumber: response.data.invoice_number,
    };
  },
};

export default toolService;
