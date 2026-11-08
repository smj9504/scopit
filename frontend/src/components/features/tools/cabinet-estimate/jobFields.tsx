/**
 * The job's own fields on the cabinet estimate, wired to Scopit: the
 * customer it's for (from the Customers list), the property address (with
 * the address lookup the other tools use), and the status pill.
 *
 * In MJ Estimate an estimate hung off a claim picked through a client
 * search; in Scopit it links a customer and keeps the claim number itself.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AutoComplete, Select, Spin, Tag, Typography } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { customerService } from '@/services/customerService';
import { packingApi } from '@/components/features/tools/packing/packingApi';
import type { Customer } from '@/types/entities';

// ── Status ──

export type TagTone = 'gray' | 'blue' | 'green' | 'purple' | 'orange' | 'red';

const TAG_COLORS: Record<TagTone, string | undefined> = {
  gray: undefined,
  blue: 'blue',
  green: 'green',
  purple: 'purple',
  orange: 'orange',
  red: 'red',
};

/** A status value as a borderless tag. */
export const Pill: React.FC<{ tone?: TagTone; children: React.ReactNode }> = ({ tone = 'gray', children }) => (
  <Tag bordered={false} color={TAG_COLORS[tone]} style={{ marginInlineEnd: 0 }}>
    {children}
  </Tag>
);

/** "awaiting_response" → "Awaiting response" */
export const humanize = (value: string): string => {
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// ── Customer ──

const customerAddress = (c: Customer) =>
  [c.addressLine1, c.city, [c.state, c.zipcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');

export interface CustomerFieldProps {
  /** The customer id (a Form.Item control) */
  value?: string | null;
  onChange?: (id: string | null) => void;
  /** The linked customer's name, shown before any search */
  initialName?: string | null;
  /** A customer was picked: the page may take their address */
  onPick?: (customer: Customer) => void;
}

/** One of the company's customers, searched by name. */
export const CustomerField: React.FC<CustomerFieldProps> = ({ value, onChange, initialName, onPick }) => {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Customer | null>(null);
  const { data: found = [], isFetching } = useQuery({
    queryKey: ['cabinet-customer-search', search],
    queryFn: () => customerService.search(search, 20),
    enabled: search.trim().length >= 2,
    staleTime: 60_000,
  });

  const options = found.map((c) => ({
    value: c.id,
    label: (
      <div style={{ lineHeight: 1.3 }}>
        <div>{c.name}</div>
        {customerAddress(c) && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {customerAddress(c)}
          </Typography.Text>
        )}
      </div>
    ),
    customer: c,
  }));
  // The linked customer, so the field shows a name rather than an id
  const currentName = picked && picked.id === value ? picked.name : initialName;
  if (value && currentName && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: <div>{currentName}</div>, customer: picked ?? ({ id: value, name: currentName } as Customer) });
  }

  return (
    <Select
      showSearch
      allowClear
      value={value || undefined}
      placeholder="Search your customers…"
      filterOption={false}
      onSearch={setSearch}
      optionLabelProp="title"
      options={options.map((o) => ({ ...o, title: o.customer.name }))}
      notFoundContent={
        search.trim().length < 2 ? (
          <Typography.Text type="secondary">Type 2+ letters of a name</Typography.Text>
        ) : isFetching ? (
          <Spin size="small" />
        ) : (
          <Typography.Text type="secondary">No customers found. Add them under Customers.</Typography.Text>
        )
      }
      onChange={(id: string | undefined, option) => {
        const customer = (Array.isArray(option) ? undefined : (option as { customer?: Customer } | undefined))?.customer;
        setPicked(customer ?? null);
        onChange?.(id ?? null);
        if (customer && id) onPick?.(customer);
      }}
    />
  );
};

/** A customer's address as one line, for the estimate's property address. */
export const addressOfCustomer = customerAddress;

// ── Address ──

interface AddressResult {
  address: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface AddressFieldProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** An address was picked from the lookup */
  onPick?: (address: AddressResult) => void;
}

/** The property address, with the address lookup. */
export const AddressField: React.FC<AddressFieldProps> = ({ value, onChange, placeholder, onPick }) => {
  const [results, setResults] = useState<AddressResult[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const lookUp = (text: string) => {
    clearTimeout(timer.current);
    if (text.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => {
      packingApi.addressAutocomplete(text).then(setResults, () => setResults([]));
    }, 300);
  };

  return (
    <AutoComplete
      value={value}
      placeholder={placeholder}
      onSearch={lookUp}
      onChange={(v) => onChange?.(v)}
      onSelect={(v: string) => {
        const hit = results.find((r) => r.address === v);
        if (hit) onPick?.(hit);
      }}
      options={results.map((r) => ({
        value: r.address,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <EnvironmentOutlined style={{ color: '#999', flexShrink: 0 }} />
            <span>{r.address}</span>
          </div>
        ),
      }))}
    />
  );
};
