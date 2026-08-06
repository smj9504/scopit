/**
 * Scopit - Settings Hooks
 * Hooks for fetching and caching statuses and categories
 */
import { useQuery } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';
import type { EstimateStatusConfig, InvoiceStatusConfig, LineItemCategory } from '@/types/entities';

// Default fallback values
const DEFAULT_ESTIMATE_STATUSES: EstimateStatusConfig[] = [
  { id: '1', companyId: '', name: 'draft', label: 'Draft', color: '#6b7280', bgColor: '#f3f4f6', isDefault: true, isSystem: true, isActive: true, orderIndex: 0, usageCount: 0, createdAt: '' },
  { id: '2', companyId: '', name: 'sent', label: 'Sent', color: '#1d4ed8', bgColor: '#dbeafe', isDefault: false, isSystem: true, isActive: true, orderIndex: 1, usageCount: 0, createdAt: '' },
  { id: '3', companyId: '', name: 'viewed', label: 'Viewed', color: '#7c3aed', bgColor: '#ede9fe', isDefault: false, isSystem: true, isActive: true, orderIndex: 2, usageCount: 0, createdAt: '' },
  { id: '4', companyId: '', name: 'approved', label: 'Approved', color: '#059669', bgColor: '#d1fae5', isDefault: false, isSystem: true, isActive: true, orderIndex: 3, usageCount: 0, createdAt: '' },
  { id: '5', companyId: '', name: 'declined', label: 'Declined', color: '#dc2626', bgColor: '#fee2e2', isDefault: false, isSystem: true, isActive: true, orderIndex: 4, usageCount: 0, createdAt: '' },
  { id: '6', companyId: '', name: 'expired', label: 'Expired', color: '#9ca3af', bgColor: '#f3f4f6', isDefault: false, isSystem: true, isActive: true, orderIndex: 5, usageCount: 0, createdAt: '' },
  { id: '7', companyId: '', name: 'converted', label: 'Converted', color: '#0891b2', bgColor: '#cffafe', isDefault: false, isSystem: true, isActive: true, orderIndex: 6, usageCount: 0, createdAt: '' },
];

const DEFAULT_INVOICE_STATUSES: InvoiceStatusConfig[] = [
  { id: '1', companyId: '', name: 'draft', label: 'Draft', color: '#6b7280', bgColor: '#f3f4f6', isDefault: true, isSystem: true, isActive: true, orderIndex: 0, usageCount: 0, createdAt: '' },
  { id: '2', companyId: '', name: 'sent', label: 'Sent', color: '#1d4ed8', bgColor: '#dbeafe', isDefault: false, isSystem: true, isActive: true, orderIndex: 1, usageCount: 0, createdAt: '' },
  { id: '3', companyId: '', name: 'viewed', label: 'Viewed', color: '#7c3aed', bgColor: '#ede9fe', isDefault: false, isSystem: true, isActive: true, orderIndex: 2, usageCount: 0, createdAt: '' },
  { id: '4', companyId: '', name: 'partial', label: 'Partial', color: '#d97706', bgColor: '#fef3c7', isDefault: false, isSystem: true, isActive: true, orderIndex: 3, usageCount: 0, createdAt: '' },
  { id: '5', companyId: '', name: 'paid', label: 'Paid', color: '#059669', bgColor: '#d1fae5', isDefault: false, isSystem: true, isActive: true, orderIndex: 4, usageCount: 0, createdAt: '' },
  { id: '6', companyId: '', name: 'overdue', label: 'Overdue', color: '#dc2626', bgColor: '#fee2e2', isDefault: false, isSystem: true, isActive: true, orderIndex: 5, usageCount: 0, createdAt: '' },
  { id: '7', companyId: '', name: 'canceled', label: 'Canceled', color: '#9ca3af', bgColor: '#f3f4f6', isDefault: false, isSystem: true, isActive: true, orderIndex: 6, usageCount: 0, createdAt: '' },
];

const DEFAULT_CATEGORIES: LineItemCategory[] = [
  { id: '1', companyId: '', name: 'General', isDefault: true, isActive: true, orderIndex: 0, createdAt: '' },
  { id: '2', companyId: '', name: 'Labor', isDefault: false, isActive: true, orderIndex: 1, createdAt: '' },
  { id: '3', companyId: '', name: 'Materials', isDefault: false, isActive: true, orderIndex: 2, createdAt: '' },
  { id: '4', companyId: '', name: 'Equipment', isDefault: false, isActive: true, orderIndex: 3, createdAt: '' },
];

/**
 * Hook to fetch and cache estimate statuses
 * Returns default values as fallback if API fails
 */
export function useEstimateStatuses() {
  return useQuery({
    queryKey: ['settings', 'estimateStatuses'],
    queryFn: settingsService.estimateStatuses.list,
    staleTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: DEFAULT_ESTIMATE_STATUSES,
    retry: 1,
  });
}

/**
 * Hook to fetch and cache invoice statuses
 * Returns default values as fallback if API fails
 */
export function useInvoiceStatuses() {
  return useQuery({
    queryKey: ['settings', 'invoiceStatuses'],
    queryFn: settingsService.invoiceStatuses.list,
    staleTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: DEFAULT_INVOICE_STATUSES,
    retry: 1,
  });
}

/**
 * Hook to fetch and cache line item categories
 * Returns default values as fallback if API fails
 */
export function useCategories() {
  return useQuery({
    queryKey: ['settings', 'categories'],
    queryFn: settingsService.categories.list,
    staleTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: DEFAULT_CATEGORIES,
    retry: 1,
  });
}

/**
 * Helper to convert status config to display format
 */
export function getStatusDisplay(status: string, configs: EstimateStatusConfig[] | InvoiceStatusConfig[]) {
  const config = configs.find((c) => c.name === status);
  if (config) {
    return {
      label: config.name.charAt(0).toUpperCase() + config.name.slice(1),
      color: config.color,
      bg: config.bgColor,
    };
  }
  // Fallback
  return {
    label: status,
    color: '#6b7280',
    bg: '#f3f4f6',
  };
}
