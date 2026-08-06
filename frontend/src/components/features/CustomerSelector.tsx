/**
 * ScopeIt - Customer Selector Component
 * Allows users to select an existing customer or input customer details directly
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Select,
  Input,
  AutoComplete,
  Spin,
  Empty,
  Typography,
  Modal,
  Button,
  App,
} from 'antd';
import { SearchOutlined, SaveOutlined, PlusOutlined, ArrowLeftOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerService } from '@/services/customerService';
import type { Customer, CustomerCreate } from '@/types/entities';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { packingApi } from '@/components/features/tools/packing/packingApi';

// Simple debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

const { Text } = Typography;

// Customer data for direct input or from selection
export interface CustomerData {
  customerId?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

interface CustomerSelectorProps {
  value?: CustomerData;
  onChange?: (data: CustomerData) => void;
  disabled?: boolean;
  /** Called when a new customer is created from direct input */
  onCustomerCreated?: (customer: Customer) => void;
}

const CustomerSelector: React.FC<CustomerSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  onCustomerCreated,
}) => {
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  // State
  const [isManualEntry, setIsManualEntry] = useState(!value?.customerId && !!value?.name);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearchQuery = useDebounce(searchInput, 300);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(
    value?.customerId
  );
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  // Direct input state
  const [directInput, setDirectInput] = useState<CustomerData>({
    customerId: value?.customerId,
    name: value?.name || '',
    email: value?.email || '',
    phone: value?.phone || '',
    address: value?.address || '',
  });

  // Address autocomplete
  const [addressOptions, setAddressOptions] = useState<{ value: string; label: React.ReactNode }[]>([]);
  const addressTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleAddressSearch = useCallback((text: string) => {
    handleDirectInputChange('address', text);
    clearTimeout(addressTimerRef.current);
    if (text.trim().length < 3) {
      setAddressOptions([]);
      return;
    }
    addressTimerRef.current = setTimeout(() => {
      packingApi.addressAutocomplete(text).then((results) => {
        setAddressOptions(
          results.map((r) => ({
            value: r.address,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <EnvironmentOutlined style={{ color: '#999', flexShrink: 0 }} />
                <span>{r.address}</span>
              </div>
            ),
          })),
        );
      }).catch(() => setAddressOptions([]));
    }, 300);
  }, []);

  const handleAddressSelect = useCallback((address: string) => {
    handleDirectInputChange('address', address);
    setAddressOptions([]);
  }, []);

  // Sync internal state when value prop changes (e.g., when loading existing estimate)
  // Use a ref to avoid re-syncing values we just pushed up via onChange
  const lastPushedRef = useRef<string>('');

  useEffect(() => {
    if (!value) return;
    // Normalize undefined and '' to the same value so fingerprints match
    const norm = (v: string | undefined) => v || '';
    const fingerprint = `${norm(value.customerId)}|${norm(value.name)}|${norm(value.email)}|${norm(value.phone)}|${norm(value.address)}`;
    if (fingerprint === lastPushedRef.current) return; // skip — we caused this change
    setSelectedCustomerId(value.customerId);
    // Only switch away from manual mode if this is an external change (e.g. loading a saved session),
    // not when the parent echoes back our own edits with slightly different values.
    if (!isManualEntry) {
      setIsManualEntry(!value.customerId && !!value.name);
    }
    setDirectInput({
      customerId: value.customerId,
      name: value.name || '',
      email: value.email || '',
      phone: value.phone || '',
      address: value.address || '',
    });
  }, [value?.customerId, value?.name, value?.email, value?.phone, value?.address]);

  // Query for searching customers
  const {
    data: customers,
    isLoading: isSearching,
  } = useQuery({
    queryKey: ['customers', 'search', debouncedSearchQuery],
    queryFn: () => customerService.search(debouncedSearchQuery, 20),
    enabled: !isManualEntry,
  });

  // Query for getting full customer details when selected
  const { data: selectedCustomer, isLoading: isLoadingCustomer } = useQuery({
    queryKey: ['customer', selectedCustomerId],
    queryFn: () => customerService.getById(selectedCustomerId!),
    enabled: !!selectedCustomerId && !isManualEntry,
  });

  // Mutation for creating customer
  const createCustomerMutation = useMutation({
    mutationFn: (data: CustomerCreate) => customerService.create(data),
    onSuccess: (newCustomer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      message.success('Customer saved successfully');

      // Update the selection to the new customer
      setSelectedCustomerId(newCustomer.id);
      setIsManualEntry(false);

      // Clear direct input
      setDirectInput({ name: '', email: '', phone: '', address: '' });

      // Notify parent
      const fullAddress = [
        newCustomer.addressLine1,
        newCustomer.city,
        newCustomer.state,
        newCustomer.zipcode,
      ]
        .filter(Boolean)
        .join(', ');

      onChange?.({
        customerId: newCustomer.id,
        name: newCustomer.name,
        email: newCustomer.email,
        phone: newCustomer.phone,
        address: fullAddress,
      });

      onCustomerCreated?.(newCustomer);
      setSaveModalOpen(false);
    },
    onError: () => {
      message.error('Failed to save customer');
    },
  });

  // Mutation for updating an already-linked customer
  const updateCustomerMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CustomerCreate> }) =>
      customerService.update(id, data),
    onSuccess: (updatedCustomer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', updatedCustomer.id] });
      message.success('Customer updated successfully');

      setSelectedCustomerId(updatedCustomer.id);
      setIsManualEntry(false);
      setDirectInput({ name: '', email: '', phone: '', address: '' });

      const fullAddress = [
        updatedCustomer.addressLine1,
        updatedCustomer.city,
        updatedCustomer.state,
        updatedCustomer.zipcode,
      ]
        .filter(Boolean)
        .join(', ');

      onChange?.({
        customerId: updatedCustomer.id,
        name: updatedCustomer.name,
        email: updatedCustomer.email,
        phone: updatedCustomer.phone,
        address: fullAddress,
      });

      setSaveModalOpen(false);
    },
    onError: () => {
      message.error('Failed to update customer');
    },
  });

  // Normalize undefined and '' for consistent fingerprint comparison
  const pushFingerprint = (data: CustomerData) => {
    const norm = (v: string | undefined) => v || '';
    lastPushedRef.current = `${norm(data.customerId)}|${norm(data.name)}|${norm(data.email)}|${norm(data.phone)}|${norm(data.address)}`;
  };

  // Update parent when selection changes
  useEffect(() => {
    if (!isManualEntry && selectedCustomer) {
      const fullAddress = [
        selectedCustomer.addressLine1,
        selectedCustomer.addressLine2,
        selectedCustomer.city,
        selectedCustomer.state,
        selectedCustomer.zipcode,
      ]
        .filter(Boolean)
        .join(', ');

      const data: CustomerData = {
        customerId: selectedCustomer.id,
        name: selectedCustomer.name,
        email: selectedCustomer.email,
        phone: selectedCustomer.phone,
        address: fullAddress,
      };
      pushFingerprint(data);
      onChange?.(data);
    }
  }, [selectedCustomer, isManualEntry, onChange]);

  // Update parent when direct input changes
  useEffect(() => {
    if (isManualEntry) {
      const data: CustomerData = { ...directInput };
      pushFingerprint(data);
      onChange?.(data);
    }
  }, [directInput, isManualEntry, onChange]);

  // Handle manual entry toggle
  const handleManualEntryChange = (checked: boolean) => {
    setIsManualEntry(checked);
    if (checked) {
      // Carry the currently selected customer's data (and id) into the editable form,
      // so editing an existing customer's details updates that record instead of creating a duplicate.
      if (selectedCustomer) {
        const fullAddress = [
          selectedCustomer.addressLine1,
          selectedCustomer.addressLine2,
          selectedCustomer.city,
          selectedCustomer.state,
          selectedCustomer.zipcode,
        ]
          .filter(Boolean)
          .join(', ');
        setDirectInput({
          customerId: selectedCustomer.id,
          name: selectedCustomer.name,
          email: selectedCustomer.email,
          phone: selectedCustomer.phone,
          address: fullAddress,
        });
      }
      setSelectedCustomerId(undefined);
      setSearchInput('');
    } else {
      setDirectInput({ name: '', email: '', phone: '', address: '' });
    }
  };

  // Handle customer selection
  const handleCustomerSelect = (customerId: string) => {
    setSelectedCustomerId(customerId);
  };

  // Handle clear selection
  const handleClearSelection = () => {
    setSelectedCustomerId(undefined);
    onChange?.({
      customerId: undefined,
      name: '',
      email: '',
      phone: '',
      address: '',
    });
  };

  // Handle direct input change
  const handleDirectInputChange = (field: keyof CustomerData, value: string) => {
    setDirectInput((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Whether the currently edited manual entry corresponds to an already-saved customer
  const isExistingCustomer = !!directInput.customerId;

  // Handle save customer
  const handleSaveCustomer = () => {
    if (!directInput.name.trim()) {
      message.warning('Customer name is required');
      return;
    }

    // Parse address into components (simple approach)
    const addressParts = directInput.address?.split(',').map(s => s.trim()) || [];

    const customerData: CustomerCreate = {
      name: directInput.name.trim(),
      email: directInput.email?.trim() || undefined,
      phone: directInput.phone?.trim() || undefined,
      addressLine1: addressParts[0] || undefined,
      city: addressParts[1] || undefined,
      state: addressParts[2] || undefined,
      zipcode: addressParts[3] || undefined,
    };

    if (directInput.customerId) {
      updateCustomerMutation.mutate({ id: directInput.customerId, data: customerData });
    } else {
      createCustomerMutation.mutate(customerData);
    }
  };

  // Show save modal prompt
  const promptSaveCustomer = useCallback(() => {
    if (isManualEntry && directInput.name.trim()) {
      setSaveModalOpen(true);
    }
  }, [isManualEntry, directInput.name]);

  // Expose promptSaveCustomer for parent component
  useEffect(() => {
    // Attach to window for parent access (alternative to forwardRef)
    (window as any).__customerSelectorPromptSave = promptSaveCustomer;
    return () => {
      delete (window as any).__customerSelectorPromptSave;
    };
  }, [promptSaveCustomer]);

  // Build select options
  const selectOptions = customers?.map((customer) => ({
    value: customer.id,
    label: customer.name,
    searchValue: `${customer.name} ${customer.email || ''}`.toLowerCase(),
    customer: customer,
  }));

  return (
    <>
      <Card
        style={{
          borderRadius: borderRadius.lg,
          border: `1px solid ${colors.border}`,
        }}
        styles={{ body: { padding: 16 } }}
      >
        {/* Customer Search - Always visible when not in manual mode */}
        {!isManualEntry && (
          <div style={{ marginBottom: 12 }}>
            <Select
              placeholder="Search customers by name or email..."
              showSearch
              allowClear
              value={selectedCustomerId}
              onChange={handleCustomerSelect}
              onClear={handleClearSelection}
              onSearch={setSearchInput}
              filterOption={false}
              disabled={disabled}
              style={{ width: '100%' }}
              size="large"
              suffixIcon={<SearchOutlined />}
              loading={isSearching}
              notFoundContent={
                isSearching ? (
                  <Spin size="small" />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No customers found"
                  />
                )
              }
              options={selectOptions}
              optionFilterProp="searchValue"
              optionRender={(option) => {
                const customer = (option.data as { customer: Customer }).customer;
                return (
                  <div style={{ padding: '4px 0' }}>
                    <div style={{ fontWeight: 500, color: colors.textPrimary }}>
                      {customer.name}
                    </div>
                    {customer.email && (
                      <div style={{ fontSize: 12, color: colors.textMuted }}>
                        {customer.email}
                      </div>
                    )}
                  </div>
                );
              }}
            />

            {/* Selected Customer Preview */}
            {selectedCustomer && !isLoadingCustomer && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: colors.bgLight,
                  borderRadius: borderRadius.md,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <Text
                  strong
                  style={{
                    display: 'block',
                    marginBottom: 4,
                    fontFamily: fonts.heading,
                  }}
                >
                  {selectedCustomer.name}
                </Text>
                {selectedCustomer.email && (
                  <Text
                    style={{
                      display: 'block',
                      fontSize: 13,
                      color: colors.textSecondary,
                    }}
                  >
                    {selectedCustomer.email}
                  </Text>
                )}
                {selectedCustomer.phone && (
                  <Text
                    style={{
                      display: 'block',
                      fontSize: 13,
                      color: colors.textSecondary,
                    }}
                  >
                    {selectedCustomer.phone}
                  </Text>
                )}
                {(selectedCustomer.addressLine1 || selectedCustomer.city) && (
                  <Text
                    style={{
                      display: 'block',
                      fontSize: 13,
                      color: colors.textSecondary,
                      marginTop: 4,
                    }}
                  >
                    {[
                      selectedCustomer.addressLine1,
                      selectedCustomer.city,
                      selectedCustomer.state,
                      selectedCustomer.zipcode,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </Text>
                )}
              </div>
            )}

            {isLoadingCustomer && (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <Spin size="small" />
              </div>
            )}
          </div>
        )}

        {/* Enter Manually Link - shown when in search mode */}
        {!isManualEntry && (
          <Button
            type="link"
            icon={<PlusOutlined />}
            onClick={() => handleManualEntryChange(true)}
            disabled={disabled}
            style={{
              padding: '0 4px',
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              color: colors.primary,
              fontWeight: 500,
            }}
          >
            Enter details manually
          </Button>
        )}

        {/* Direct Input Fields - Shown when manual entry is active */}
        {isManualEntry && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Back to Search Link */}
            <Button
              type="link"
              icon={<ArrowLeftOutlined />}
              onClick={() => handleManualEntryChange(false)}
              disabled={disabled}
              style={{
                padding: '0 4px',
                minHeight: 44,
                display: 'inline-flex',
                alignItems: 'center',
                color: colors.textSecondary,
                alignSelf: 'flex-start',
                marginBottom: 4,
              }}
            >
              Back to search
            </Button>

            <Input
              value={directInput.name}
              onChange={(e) => handleDirectInputChange('name', e.target.value)}
              placeholder="Customer Name *"
              disabled={disabled}
              size="large"
              style={{
                fontFamily: fonts.body,
                fontSize: 15,
              }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              <Input
                type="email"
                value={directInput.email}
                onChange={(e) => handleDirectInputChange('email', e.target.value)}
                placeholder="Email"
                disabled={disabled}
                size="large"
                style={{
                  fontFamily: fonts.body,
                  fontSize: 15,
                }}
              />

              <Input
                value={directInput.phone}
                onChange={(e) => handleDirectInputChange('phone', e.target.value)}
                placeholder="Phone"
                disabled={disabled}
                size="large"
                style={{
                  fontFamily: fonts.body,
                  fontSize: 15,
                }}
              />
            </div>

            <AutoComplete
              value={directInput.address}
              options={addressOptions}
              onSearch={handleAddressSearch}
              onSelect={handleAddressSelect}
              disabled={disabled}
              style={{ width: '100%' }}
            >
              <Input
                placeholder="Address (start typing to search...)"
                suffix={<EnvironmentOutlined style={{ color: '#bbb' }} />}
                style={{
                  fontFamily: fonts.body,
                  fontSize: 15,
                }}
              />
            </AutoComplete>

            {/* Save/Update Customer Button */}
            {directInput.name.trim() && (
              <Button
                type="default"
                icon={<SaveOutlined />}
                onClick={() => setSaveModalOpen(true)}
                style={isMobile ? { width: '100%', minHeight: 44 } : { alignSelf: 'flex-start' }}
              >
                {isExistingCustomer ? 'Update Customer' : 'Save to Customer List'}
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* Save/Update Customer Modal */}
      <Modal
        title={isExistingCustomer ? 'Update Customer' : 'Save Customer'}
        open={saveModalOpen}
        onCancel={() => setSaveModalOpen(false)}
        footer={
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <Button
              key="cancel"
              onClick={() => setSaveModalOpen(false)}
              style={{ flex: '1 1 auto' }}
            >
              {isExistingCustomer ? 'Cancel' : 'No, Just Use Once'}
            </Button>
            <Button
              key="save"
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveCustomer}
              loading={isExistingCustomer ? updateCustomerMutation.isPending : createCustomerMutation.isPending}
              style={{ background: colors.primary, flex: '1 1 auto' }}
            >
              {isExistingCustomer ? 'Yes, Update Customer' : 'Yes, Save Customer'}
            </Button>
          </div>
        }
      >
        <div style={{ padding: '16px 0' }}>
          <Text style={{ fontSize: 15 }}>
            {isExistingCustomer
              ? 'Update this customer’s info in your customer list with the changes below?'
              : 'Would you like to save this customer to your customer list for future use?'}
          </Text>

          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: colors.bgLight,
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
            }}
          >
            <Text
              strong
              style={{
                display: 'block',
                marginBottom: 4,
                fontFamily: fonts.heading,
              }}
            >
              {directInput.name}
            </Text>
            {directInput.email && (
              <Text
                style={{
                  display: 'block',
                  fontSize: 13,
                  color: colors.textSecondary,
                }}
              >
                {directInput.email}
              </Text>
            )}
            {directInput.phone && (
              <Text
                style={{
                  display: 'block',
                  fontSize: 13,
                  color: colors.textSecondary,
                }}
              >
                {directInput.phone}
              </Text>
            )}
            {directInput.address && (
              <Text
                style={{
                  display: 'block',
                  fontSize: 13,
                  color: colors.textSecondary,
                  marginTop: 4,
                }}
              >
                {directInput.address}
              </Text>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
};

export default CustomerSelector;
export { CustomerSelector };
export type { CustomerSelectorProps };
