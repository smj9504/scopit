/**
 * Scopit - Entity Types
 */

// Common
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// Company
export interface Company {
  id: string;
  name: string;
  legalName?: string;
  email?: string;
  phone?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor?: string;
  defaultTaxRate: number;
  defaultTaxLabel: string;
  estimatePrefix: string;
  invoicePrefix: string;
  nextEstimateNumber: number;
  nextInvoiceNumber: number;
  defaultEstimateValidityDays: number;
  defaultInvoiceDueDays: number;
}

// PDF Template Info
export interface PdfTemplateInfo {
  id: string;
  name: string;
  description: string;
}

export type PdfTemplateId = 'classic' | 'modern' | 'professional' | 'detailed';

// Customer
export interface Customer {
  id: string;
  companyId: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  notes?: string;
  tags?: string[];
  isActive: boolean;
  createdAt: string;
}

export interface CustomerCreate {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  notes?: string;
}

// Line Item Image
export interface LineItemImage {
  filename: string;
  data: string; // base64 data URI
}

// Line Item
export type LineItemVisibility = 'company' | 'private';

export interface LineItem {
  id: string;
  code?: string;
  name: string;
  includes?: string;
  unit?: string;
  unitPrice: number;
  cat?: string;
  isTaxable: boolean;
  visibility: LineItemVisibility;
  companyId: string;
  createdBy: string;
  isActive: boolean;
  createdAt: string;
  notes?: LineItemNote[];
}

export interface LineItemNote {
  id: string;
  content: string;
  orderIndex: number;
}

export interface LineItemCreate {
  code?: string;
  name: string;
  includes?: string;
  unit?: string;
  unitPrice: number;
  cat?: string;
  isTaxable?: boolean;
  visibility?: LineItemVisibility;
  notes?: { content: string; orderIndex: number }[];
}

// Status Config (for inline display)
export interface StatusConfig {
  id: string;
  name: string;
  label: string;
  color: string;
  bgColor: string;
  isDefault?: boolean;
  isActive?: boolean;
  orderIndex?: number;
}

// Estimate
export type EstimateStatus = 'draft' | 'sent' | 'viewed' | 'approved' | 'declined' | 'expired' | 'converted';

export interface EstimateSection {
  id: string;
  name: string;
  orderIndex: number;
  isCollapsed: boolean;
  items: EstimateItem[];
  subtotal: number;
}

export interface EstimateItem {
  id: string;
  sectionId?: string;
  lineItemId?: string;
  code?: string;
  name: string;
  description?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  isTaxable: boolean;
  orderIndex: number;
  notes?: string[];
  images?: LineItemImage[];
}

export interface EstimatePayment {
  id: string;
  amount: number;
  paymentMethod?: string;
  paymentDate?: string;
  referenceNumber?: string;
  notes?: string;
  createdAt: string;
}

export interface Adjustment {
  id: string;
  type: 'premium' | 'discount';
  name: string;
  percentage: number;
  amount: number;
  orderIndex: number;
  createdAt: string;
}

export interface Estimate {
  id: string;
  estimateNumber: string;
  status?: EstimateStatus;  // Legacy enum
  statusId?: string;
  statusConfig?: StatusConfig;
  estimateDate: string;
  validUntil?: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerAddress?: string;
  title?: string;
  description?: string;
  subtotal: number;
  taxableSubtotal: number;
  adjustmentsTotal: number;
  taxRate?: number;
  taxLabel?: string;
  taxAmount: number;
  discountAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes?: string;
  terms?: string;
  sections: EstimateSection[];
  items: EstimateItem[];
  payments: EstimatePayment[];
  adjustments: Adjustment[];
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface EstimateCreate {
  customer_id?: string;
  customer_name?: string;
  customer_email?: string;
  customer_address?: string;
  estimate_date?: string;
  valid_until?: string;
  title?: string;
  description?: string;
  tax_rate?: number;
  tax_label?: string;
  notes?: string;
  terms?: string;
  sections?: {
    name: string;
    order_index: number;
    items: EstimateItemCreate[];
  }[];
  items?: EstimateItemCreate[];
}

export interface EstimateItemCreate {
  line_item_id?: string;
  name: string;
  description?: string;
  unit?: string;
  quantity: number;
  unit_price: number;
  is_taxable?: boolean;
  order_index: number;
  notes?: string[];
  images?: LineItemImage[];
}

// Invoice
export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'canceled';
export type PaymentMethod = 'cash' | 'check' | 'credit_card' | 'bank_transfer' | 'other';

export interface InvoiceSection {
  id: string;
  name: string;
  orderIndex: number;
  isCollapsed: boolean;
  items: InvoiceItem[];
  subtotal: number;
}

export interface InvoiceItem {
  id: string;
  sectionId?: string;
  lineItemId?: string;
  code?: string;
  name: string;
  description?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  isTaxable: boolean;
  orderIndex: number;
  notes?: string[];  // Array of note content strings
  images?: LineItemImage[];
}

export interface Payment {
  id: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate?: string | null;
  referenceNumber?: string;
  notes?: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status?: InvoiceStatus;  // Legacy enum
  statusId?: string;
  statusConfig?: StatusConfig;
  invoiceDate: string;
  dueDate?: string;
  estimateId?: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerAddress?: string;
  title?: string;
  subtotal: number;
  taxableSubtotal: number;
  adjustmentsTotal: number;
  taxRate?: number;
  taxLabel?: string;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes?: string;
  terms?: string;
  paymentSchedule?: PaymentScheduleItem[];
  sections: InvoiceSection[];
  items: InvoiceItem[];
  payments: Payment[];
  adjustments: Adjustment[];
  createdAt: string;
}

export interface PaymentScheduleItem {
  label: string;
  percentage: number;
  amount: number;
  dueDescription?: string;
}

export interface InvoiceCreate {
  customerId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  invoiceDate?: string;
  dueDate?: string;
  title?: string;
  taxRate?: number;
  taxLabel?: string;
  notes?: string;
  terms?: string;
  paymentSchedule?: PaymentScheduleItem[] | null;
  sections?: {
    name: string;
    orderIndex: number;
    items: InvoiceItemCreate[];
  }[];
  items?: InvoiceItemCreate[];
}

export interface InvoiceUpdate {
  customerId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  invoiceDate?: string;
  dueDate?: string;
  title?: string;
  taxRate?: number;
  taxLabel?: string;
  notes?: string;
  terms?: string;
  paymentSchedule?: PaymentScheduleItem[] | null;
  sections?: {
    name: string;
    orderIndex: number;
    items: InvoiceItemCreate[];
  }[];
  items?: InvoiceItemCreate[];
}

export interface InvoiceItemCreate {
  lineItemId?: string;
  name: string;
  description?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  isTaxable?: boolean;
  orderIndex: number;
  notes?: string[];
  images?: LineItemImage[];
}

// Subscription
export interface Plan {
  id: string;
  name: 'free' | 'pro';
  displayName: string;
  priceMonthly: number;
  priceYearly: number;
  maxEstimatesPerMonth: number | null;
  maxInvoicesPerMonth: number | null;
  canSaveLineItems: boolean;
  canSaveCustomers: boolean;
  canConvertEstimate: boolean;
  canSendEmail: boolean;
  canExportPdf: boolean;
}

export interface Subscription {
  id: string;
  planId: string;
  plan: Plan;
  status: 'active' | 'past_due' | 'canceled';
  isBetaUser: boolean;
  betaExpiresAt?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
}

export interface Usage {
  periodStart: string;
  periodEnd: string;
  estimates: {
    used: number;
    limit: number | null;
    remaining: number | null;
    unlimited: boolean;
  };
  invoices: {
    used: number;
    limit: number | null;
    remaining: number | null;
    unlimited: boolean;
  };
  isBetaUser: boolean;
}

// Settings Configuration Types
export interface EstimateStatusConfig {
  id: string;
  companyId: string;
  name: string;
  label: string;
  color: string;
  bgColor: string;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
  orderIndex: number;
  usageCount: number;
  createdAt: string;
  updatedAt?: string;
}

export interface InvoiceStatusConfig {
  id: string;
  companyId: string;
  name: string;
  label: string;
  color: string;
  bgColor: string;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
  orderIndex: number;
  usageCount: number;
  createdAt: string;
  updatedAt?: string;
}

export interface LineItemCategory {
  id: string;
  companyId: string;
  name: string;
  color?: string;
  isDefault: boolean;
  isActive: boolean;
  orderIndex: number;
  usageCount?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface StatusConfigCreate {
  name: string;
  label: string;
  color: string;
  bg_color: string;
  is_default?: boolean;
  order_index?: number;
}

export interface StatusConfigUpdate {
  label?: string;
  color?: string;
  bg_color?: string;
  is_default?: boolean;
  order_index?: number;
  is_active?: boolean;
}

export interface CategoryCreate {
  name: string;
  color?: string;
  is_default?: boolean;
  order_index?: number;
}

export interface CategoryUpdate {
  name?: string;
  color?: string;
  is_default?: boolean;
  order_index?: number;
  is_active?: boolean;
}

export interface LineItemUnit {
  id: string;
  companyId: string;
  name: string;
  label?: string;
  isDefault: boolean;
  isActive: boolean;
  orderIndex: number;
  createdAt: string;
  updatedAt?: string;
}

export interface UnitCreate {
  name: string;
  label?: string;
  is_default?: boolean;
  order_index?: number;
}

export interface UnitUpdate {
  name?: string;
  label?: string;
  is_default?: boolean;
  order_index?: number;
  is_active?: boolean;
}

// Status Usage & Migration Types
export interface AffectedItemInfo {
  id: string;
  number: string;
  customerName?: string;
}

export interface StatusUsageResponse {
  statusId: string;
  usageCount: number;
  canDelete: boolean;
  isDefault: boolean;
  isSystem: boolean;
  affectedItems: AffectedItemInfo[];
}

export interface BulkStatusMigrationRequest {
  fromStatusId: string;
  toStatusId: string;
}

export interface BulkStatusMigrationResponse {
  migratedCount: number;
  fromStatusId: string;
  toStatusId: string;
}

// Excel Import
export interface ExcelParsedItem {
  code: string | null;
  name: string;
  description: string | null;
  unit: string | null;
  quantity: number;
  unit_price: number;
  is_taxable: boolean;
  order_index: number;
}

export interface ExcelParsedSection {
  name: string;
  order_index: number;
  items: ExcelParsedItem[];
}

export interface ExcelParseResult {
  sections: ExcelParsedSection[];
  errors: string[];
  warnings: string[];
  total_items: number;
}
