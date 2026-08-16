/**
 * Scopit - Tools Types
 */

export interface Tool {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  requiredPlan: 'free' | 'pro' | 'enterprise';
  version: string;
  tags: string[];
  hasAccess: boolean;
  canCreateEstimate: boolean;
}

export interface ToolSession {
  id: string;
  toolId: string;
  name: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string | null;
}

export interface ToolSessionCreate {
  tool_id: string;
  name?: string;
  data?: Record<string, unknown>;
}

export interface ToolSessionUpdate {
  name?: string;
  data?: Record<string, unknown>;
  /** Shallow-merge `data` into the existing session data instead of replacing it. */
  merge?: boolean;
}

export interface CreateEstimateFromToolRequest {
  customer_id?: string;
  customer_name?: string;
  title?: string;
  update_existing?: boolean;
}

export interface CreateEstimateFromToolResponse {
  estimateId: string;
  estimateNumber: string;
  updated: boolean;
}

export interface CreateInvoiceFromToolRequest {
  customer_id?: string;
  customer_name?: string;
  title?: string;
}

export interface CreateInvoiceFromToolResponse {
  invoiceId: string;
  invoiceNumber: string;
}
