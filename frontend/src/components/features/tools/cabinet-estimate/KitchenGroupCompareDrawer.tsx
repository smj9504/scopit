/**
 * Every estimate of a kitchen job side by side: their totals (and, on an
 * insurance job, each option over the restoration), the products each
 * option is built from, their sections, and the line items that differ
 * between any two of them.
 */

import React, { useMemo, useState } from 'react';
import { Button, Drawer, Empty, Grid, Select, Spin, Table, Typography, message } from 'antd';
import { FilePdfOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { CabinetEstimate } from '@/types/cabinetEstimate';
import { memberName } from '@/types/cabinetEstimate';
import { categoryTotals, lineItemChanges } from '@/components/features/tools/cabinet-estimate/groupCompare';
import { cabinetEstimateService } from '@/services/cabinetEstimateService';

const { Text } = Typography;
const { useBreakpoint } = Grid;

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
const figure: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/** Line item categories as sections, in the order the work happens. */
const SECTION_LABELS: Record<string, string> = {
  demo: 'Demolition',
  supply: 'Supply',
  premium: 'Premiums & trim',
  install: 'Installation',
  labor: 'Labor',
  plumbing: 'Plumbing',
  countertop: 'Countertop',
  backsplash: 'Backsplash',
  finishing: 'Drywall & paint',
  scope: 'Scope',
  misc: 'Other',
};
const SECTION_ORDER = Object.keys(SECTION_LABELS);
const sectionLabel = (category: string) =>
  SECTION_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ');

const Section: React.FC<{ title: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }> = ({ title, extra, children }) => (
  <section style={{ marginBottom: 28 }}>
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
      borderBottom: '1px solid var(--color-neutral-200)', paddingBottom: 6, marginBottom: 8,
    }}>
      <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
      {extra}
    </div>
    {children}
  </section>
);

interface KitchenGroupCompareDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The estimate on screen; the drawer shows its whole job. */
  estimate: CabinetEstimate;
  onOpen: (id: string) => void;
}

const KitchenGroupCompareDrawer: React.FC<KitchenGroupCompareDrawerProps> = ({ open, onClose, estimate, onOpen }) => {
  const screens = useBreakpoint();
  const { data: group, isLoading } = useQuery({
    queryKey: ['cabinet-estimate-group', estimate.id],
    queryFn: () => cabinetEstimateService.getGroup(estimate.id),
    enabled: open,
  });
  // Shared with the estimate page: the product slots' names and order
  const { data: pricingInfo } = useQuery({
    queryKey: ['cabinet-pricing-info', estimate.id],
    queryFn: () => cabinetEstimateService.getPricingInfo(estimate.id),
    staleTime: 1000 * 60 * 30,
    enabled: open,
  });
  const members = useMemo(() => group?.members ?? [], [group]);
  const restoration = members.find((m) => m.kind === 'restore');
  const insurance = group?.project_type === 'insurance';

  // Compare the estimate on screen against the restoration (or the job's first estimate)
  const [baseId, setBaseId] = useState<string | undefined>();
  const [optionId, setOptionId] = useState<string | undefined>();
  const defaultBase = restoration?.id ?? members[0]?.id;
  const base = members.find((m) => m.id === (baseId ?? defaultBase));
  const defaultOption = estimate.id !== base?.id ? estimate.id : members.find((m) => m.id !== base?.id)?.id;
  const option = members.find((m) => m.id === (optionId ?? defaultOption));

  const changes = useMemo(
    () => (base && option && base.id !== option.id ? lineItemChanges(base, option) : []),
    [base, option],
  );
  const totalsByMember = useMemo(
    () => Object.fromEntries(members.map((m) => [m.id, categoryTotals(m)])),
    [members],
  );
  const sections = useMemo(() => {
    const seen = new Set<string>();
    Object.values(totalsByMember).forEach((totals) => Object.keys(totals).forEach((c) => seen.add(c)));
    const rank = (c: string) => (SECTION_ORDER.includes(c) ? SECTION_ORDER.indexOf(c) : SECTION_ORDER.length);
    return Array.from(seen).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [totalsByMember]);

  // Each member's chosen products, in slot order
  const productsOf = (m: CabinetEstimate) => {
    const chosen = m.selections || {};
    const slots = pricingInfo?.selection_slots?.length
      ? pricingInfo.selection_slots
      : Object.keys(chosen).map((key) => ({ key, label: key.replace(/_/g, ' ') }));
    return slots
      .filter((s) => chosen[s.key])
      .map((s) => ({ key: s.key, slot: s.label, title: chosen[s.key].title }));
  };
  const anyProducts = members.some((m) => productsOf(m).length > 0);

  const memberOptions = members.map((m) => ({ value: m.id, label: memberName(m) }));
  const overRestoration = (m: CabinetEstimate) =>
    insurance && restoration && m.kind === 'option'
      ? signedMoney((m.total || 0) - (restoration.total || 0))
      : null;

  return (
    <Drawer
      title="Compare estimates"
      open={open}
      onClose={onClose}
      width={screens.md ? 880 : '100%'}
      extra={
        <Button
          icon={<FilePdfOutlined />}
          disabled={members.length < 2}
          onClick={async () => {
            const done = message.loading('Making the proposal…', 0);
            try {
              await cabinetEstimateService.exportProposalPdf(estimate.id);
            } catch {
              message.error('Could not make the proposal PDF');
            } finally {
              done();
            }
          }}
        >
          {screens.md ? 'Customer proposal PDF' : 'Proposal'}
        </Button>
      }
    >
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
      ) : members.length < 2 ? (
        <Empty description="Add an option to compare it with this estimate" />
      ) : (
        <>
          <Section title="Totals">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={members}
              onRow={(m) => ({ onClick: () => onOpen(m.id), style: { cursor: 'pointer' } })}
              columns={[
                {
                  title: 'Estimate',
                  key: 'name',
                  render: (_: unknown, m: CabinetEstimate) => (
                    <span style={{ fontWeight: m.id === estimate.id ? 600 : 400 }}>
                      {memberName(m)}
                      {m.kind === 'restore' && <Text type="secondary"> · goes to the insurance company</Text>}
                      {m.id === estimate.id && <Text type="secondary"> · open</Text>}
                    </span>
                  ),
                },
                {
                  title: 'Total',
                  key: 'total',
                  align: 'right' as const,
                  render: (_: unknown, m: CabinetEstimate) => (
                    <span style={figure}>{m.total ? money(m.total) : 'Not calculated'}</span>
                  ),
                },
                ...(insurance && restoration ? [{
                  title: 'Over restoration',
                  key: 'over',
                  align: 'right' as const,
                  render: (_: unknown, m: CabinetEstimate) => (
                    <span style={figure}>{overRestoration(m) ?? '—'}</span>
                  ),
                }] : []),
              ]}
            />
          </Section>

          {anyProducts && (
            <Section title="Products">
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={members}
                columns={[
                  {
                    title: 'Estimate',
                    key: 'name',
                    width: 160,
                    render: (_: unknown, m: CabinetEstimate) => memberName(m),
                  },
                  {
                    title: 'Chosen products',
                    key: 'products',
                    render: (_: unknown, m: CabinetEstimate) => {
                      const products = productsOf(m);
                      if (!products.length) {
                        return (
                          <Text type="secondary">
                            {m.kind === 'restore' ? 'Rate tables only' : 'None chosen — rate-table prices'}
                          </Text>
                        );
                      }
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {products.map((p) => (
                            <span key={p.key}>
                              <Text type="secondary" style={{ fontSize: 12 }}>{p.slot}: </Text>
                              {p.title}
                            </span>
                          ))}
                        </div>
                      );
                    },
                  },
                ]}
              />
            </Section>
          )}

          <Section title="By section">
            <Table
              size="small"
              rowKey="category"
              pagination={false}
              scroll={{ x: true }}
              dataSource={sections.map((category) => ({ category }))}
              columns={[
                {
                  title: 'Section',
                  key: 'category',
                  render: (_: unknown, r: { category: string }) => sectionLabel(r.category),
                },
                ...members.map((m) => ({
                  title: memberName(m),
                  key: m.id,
                  align: 'right' as const,
                  render: (_: unknown, r: { category: string }) => (
                    <span style={figure}>{money(totalsByMember[m.id]?.[r.category] || 0)}</span>
                  ),
                })),
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}><Text strong>Total</Text></Table.Summary.Cell>
                  {members.map((m, i) => (
                    <Table.Summary.Cell key={m.id} index={i + 1} align="right">
                      <Text strong style={figure}>{money(m.total || 0)}</Text>
                    </Table.Summary.Cell>
                  ))}
                </Table.Summary.Row>
              )}
            />
          </Section>

          <Section
            title="What changes"
            extra={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Select
                  size="small"
                  style={{ minWidth: 140 }}
                  value={option?.id}
                  options={memberOptions}
                  onChange={setOptionId}
                  aria-label="Estimate to look at"
                />
                <Text type="secondary">against</Text>
                <Select
                  size="small"
                  style={{ minWidth: 140 }}
                  value={base?.id}
                  options={memberOptions}
                  onChange={setBaseId}
                  aria-label="Estimate to compare against"
                />
              </span>
            }
          >
            {!base || !option || base.id === option.id ? (
              <Text type="secondary">Pick two different estimates.</Text>
            ) : changes.length === 0 ? (
              <Text type="secondary">{memberName(option)} has the same line items as {memberName(base)}.</Text>
            ) : (
              <Table
                size="small"
                rowKey={(c) => `${c.location}-${c.description}`}
                pagination={false}
                dataSource={changes}
                columns={[
                  {
                    title: 'Item',
                    key: 'item',
                    render: (_: unknown, c) => (
                      <span>
                        {c.description}
                        {c.location === 'island' && <Text type="secondary" style={{ fontSize: 12 }}> · Island</Text>}
                      </span>
                    ),
                  },
                  {
                    title: memberName(base),
                    key: 'base',
                    align: 'right' as const,
                    render: (_: unknown, c) => <span style={figure}>{c.base ? money(c.base) : '—'}</span>,
                  },
                  {
                    title: memberName(option),
                    key: 'option',
                    align: 'right' as const,
                    render: (_: unknown, c) => <span style={figure}>{c.option ? money(c.option) : '—'}</span>,
                  },
                  {
                    title: 'Difference',
                    key: 'difference',
                    align: 'right' as const,
                    render: (_: unknown, c) => <span style={figure}>{signedMoney(c.difference)}</span>,
                  },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={3}><Text strong>Total difference</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <Text strong style={figure}>{signedMoney((option.total || 0) - (base.total || 0))}</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            )}
          </Section>
        </>
      )}
    </Drawer>
  );
};

export default KitchenGroupCompareDrawer;
