/**
 * Who is signing: one of the company's customers, or a new one. A new
 * customer is only saved when the documents are signed, so an abandoned
 * visit leaves nothing behind.
 */
import React, { useEffect, useState } from 'react';
import { AutoComplete, Button, Input, Skeleton } from 'antd';
import { RightOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { customerService } from '@/services/customerService';
import { packingApi } from '@/components/features/tools/packing/packingApi';
import type { Customer } from '@/types/entities';
import type { NewCustomer } from './inPersonApi';

const addressLine = (c: Customer) =>
  [c.addressLine1, c.city, [c.state, c.zipcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');

type Suggestion = { address: string; street: string; city: string; state: string; zip: string };

const NewCustomerForm: React.FC<{
  initial: NewCustomer | null;
  onDone: (customer: NewCustomer) => void;
  onCancel: () => void;
}> = ({ initial, onDone, onCancel }) => {
  const [form, setForm] = useState<NewCustomer>(initial ?? { name: '' });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const set = (patch: Partial<NewCustomer>) => setForm((prev) => ({ ...prev, ...patch }));

  // Address suggestions as the street is typed
  const street = form.address_line1 ?? '';
  useEffect(() => {
    const text = street.trim();
    if (text.length < 4) {
      setSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      packingApi.addressAutocomplete(text)
        .then((results) => { if (!cancelled) setSuggestions(results); })
        .catch(() => { if (!cancelled) setSuggestions([]); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [street]);

  const canContinue = !!form.name.trim();
  const submit = () => {
    if (!canContinue) return;
    const trimmed = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
    ) as NewCustomer;
    onDone(trimmed);
  };

  return (
    <div className="ip-panel" style={{ marginTop: 16 }}>
      <h2 className="ip-section-title" style={{ marginTop: 0 }}>New customer</h2>
      <p className="ip-note" style={{ margin: '0 0 16px' }}>
        Saved to your customers when the documents are signed.
      </p>
      <div className="ip-field">
        <label className="ip-label" htmlFor="ip-new-name">
          Name <span className="ip-required">Required</span>
        </label>
        <Input
          id="ip-new-name"
          size="large"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          onPressEnter={submit}
          autoComplete="off"
          autoFocus
        />
      </div>
      <div className="ip-field ip-grid-2">
        <div>
          <label className="ip-label" htmlFor="ip-new-phone">Phone</label>
          <Input
            id="ip-new-phone"
            size="large"
            type="tel"
            inputMode="tel"
            value={form.phone ?? ''}
            onChange={(e) => set({ phone: e.target.value })}
          />
        </div>
        <div>
          <label className="ip-label" htmlFor="ip-new-email">Email</label>
          <Input
            id="ip-new-email"
            size="large"
            type="email"
            inputMode="email"
            autoCapitalize="off"
            value={form.email ?? ''}
            onChange={(e) => set({ email: e.target.value })}
          />
        </div>
      </div>
      <div className="ip-field">
        <label className="ip-label" htmlFor="ip-new-street">Street address</label>
        <AutoComplete
          id="ip-new-street"
          className="ip-control"
          size="large"
          value={street}
          options={suggestions.map((s) => ({ value: s.address, label: s.address }))}
          onChange={(value) => set({ address_line1: value })}
          onSelect={(value: string) => {
            const picked = suggestions.find((s) => s.address === value);
            if (picked) {
              set({ address_line1: picked.street, city: picked.city, state: picked.state, zipcode: picked.zip });
            }
          }}
        />
      </div>
      <div className="ip-field ip-grid-3">
        <div>
          <label className="ip-label" htmlFor="ip-new-city">City</label>
          <Input id="ip-new-city" size="large" value={form.city ?? ''} onChange={(e) => set({ city: e.target.value })} />
        </div>
        <div>
          <label className="ip-label" htmlFor="ip-new-state">State</label>
          <Input id="ip-new-state" size="large" value={form.state ?? ''} onChange={(e) => set({ state: e.target.value })} />
        </div>
        <div>
          <label className="ip-label" htmlFor="ip-new-zip">ZIP</label>
          <Input
            id="ip-new-zip"
            size="large"
            inputMode="numeric"
            value={form.zipcode ?? ''}
            onChange={(e) => set({ zipcode: e.target.value })}
          />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <Button size="large" onClick={onCancel}>Cancel</Button>
        <Button size="large" type="primary" disabled={!canContinue} onClick={submit}>Continue</Button>
      </div>
    </div>
  );
};

const CustomerStep: React.FC<{
  newCustomer: NewCustomer | null;
  onCustomer: (customer: Customer) => void;
  onNewCustomer: (customer: NewCustomer) => void;
}> = ({ newCustomer, onCustomer, onNewCustomer }) => {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(!!newCustomer);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const results = useQuery({
    queryKey: ['in-person-customer-search', query],
    queryFn: () => customerService.search(query, 10),
    enabled: query.length >= 2,
  });
  const customers = results.data ?? [];
  const noMatch = query.length >= 2 && !results.isFetching && !results.isError && customers.length === 0;

  return (
    <>
      <h1 className="ip-title">Who is signing?</h1>
      <p className="ip-lead">Find the customer, or add a new one.</p>

      {!adding && (
        <>
          <Input
            size="large"
            prefix={<SearchOutlined aria-hidden="true" style={{ color: '#6b7280' }} />}
            placeholder="Name, email or phone"
            aria-label="Search customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            autoFocus
          />

          <div style={{ marginTop: 12 }}>
            {results.isFetching && <Skeleton active title={false} paragraph={{ rows: 3 }} />}
            {results.isError && (
              <div className="ip-alert ip-alert--error" role="alert">
                Couldn&apos;t search customers.
                <Button size="small" onClick={() => results.refetch()}>Try again</Button>
              </div>
            )}
            {!results.isFetching && customers.length > 0 && (
              <ul className="ip-rows">
                {customers.map((customer) => (
                  <li key={customer.id}>
                    <button type="button" className="ip-row" onClick={() => onCustomer(customer)}>
                      <span className="ip-row-body">
                        <span className="ip-row-title">{customer.name}</span>
                        {(addressLine(customer) || customer.phone) && (
                          <span className="ip-row-meta">{addressLine(customer) || customer.phone}</span>
                        )}
                      </span>
                      <RightOutlined className="ip-row-go" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {noMatch && (
              <p className="ip-note" style={{ marginTop: 0 }}>No customer matches &ldquo;{query}&rdquo;.</p>
            )}
          </div>

          <Button
            size="large"
            block
            style={{ marginTop: 16 }}
            onClick={() => setAdding(true)}
          >
            New customer
          </Button>
        </>
      )}

      {adding && (
        <NewCustomerForm
          initial={newCustomer ?? (search.trim() && !/^[\d(+]/.test(search.trim()) ? { name: search.trim() } : null)}
          onDone={onNewCustomer}
          onCancel={() => setAdding(false)}
        />
      )}
    </>
  );
};

export default CustomerStep;
