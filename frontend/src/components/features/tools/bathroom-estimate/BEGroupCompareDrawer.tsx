/**
 * Every estimate of a bathroom job side by side: their totals (and, on an
 * insurance job, each option over the restoration), their phases, and the
 * line items that differ between any two of them.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Empty, Grid, Segmented, Select, Spin, Table, Typography, message } from 'antd';
import { FilePdfOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { BathroomEstimate } from '@/types/bathroomEstimate';
import { PHASE_LABELS, memberName } from '@/types/bathroomEstimate';
import { exportProposalWith3D } from './bathroomPdf';
import { lineItemChanges, phaseTotals } from './groupCompare';
import { bathroomEstimateService } from '@/services/bathroomEstimateService';

const { Text } = Typography;
const { useBreakpoint } = Grid;

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
const figure: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

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

/** The two estimates in 3D side by side, from the same spot: still pictures, drawn when the pair changes. */
const Compare3D: React.FC<{ base: BathroomEstimate; option: BathroomEstimate }> = ({ base, option }) => {
  const [pose, setPose] = useState<'overview' | 'eye'>('overview');
  const [pictures, setPictures] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    let live = true;
    setPictures(null);
    import('./sketch/bathroom3dSnapshot')
      .then(({ renderBathroomSnapshots }) => renderBathroomSnapshots(
        [base, option].map((e) => ({ key: e.id, sketch: e.sketch_data as any, estimate: e })),
        { width: 640, height: 420, pose, type: 'image/png' },
      ))
      .then((p) => { if (live) setPictures(p); })
      .catch(() => { if (live) setPictures({}); });
    return () => { live = false; };
  }, [base, option, pose]);

  return (
    <div style={{ marginBottom: 12 }}>
      <Segmented
        size="small"
        value={pose}
        onChange={(v) => setPose(v as 'overview' | 'eye')}
        options={[{ value: 'overview', label: 'From above' }, { value: 'eye', label: 'Eye level' }]}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[base, option].map((e) => (
          <figure key={e.id} style={{ flex: '1 1 300px', margin: 0 }}>
            {pictures === null ? (
              <div style={{ aspectRatio: '64 / 42', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-neutral-50)' }}>
                <Spin size="small" />
              </div>
            ) : pictures[e.id] ? (
              <img
                src={`data:image/png;base64,${pictures[e.id]}`}
                alt={`${memberName(e)} in 3D`}
                style={{ width: '100%', display: 'block', border: '1px solid var(--color-neutral-200)', borderRadius: 6 }}
              />
            ) : (
              <div style={{ aspectRatio: '64 / 42', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-neutral-50)' }}>
                <Text type="secondary">No sketch to show</Text>
              </div>
            )}
            <figcaption style={{ fontSize: 12, marginTop: 4 }}>{memberName(e)}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
};

interface BEGroupCompareDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The estimate on screen; the drawer shows its whole job. */
  estimate: BathroomEstimate;
  onOpen: (id: string) => void;
}

const BEGroupCompareDrawer: React.FC<BEGroupCompareDrawerProps> = ({ open, onClose, estimate, onOpen }) => {
  const screens = useBreakpoint();
  const { data: group, isLoading } = useQuery({
    queryKey: ['bathroom-estimate-group', estimate.id],
    queryFn: () => bathroomEstimateService.getGroup(estimate.id),
    enabled: open,
  });
  // A remodel's current layout isn't priced, so it has nothing to compare
  const members = useMemo(() => (group?.members ?? []).filter((m) => m.kind !== 'existing'), [group]);
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
  const phases = useMemo(() => {
    const seen = new Set<number>();
    members.forEach((m) => (m.line_items || []).forEach((li) => seen.add(li.phase)));
    return Array.from(seen).sort((a, b) => a - b);
  }, [members]);
  const totalsByMember = useMemo(
    () => Object.fromEntries(members.map((m) => [m.id, phaseTotals(m)])),
    [members],
  );

  const memberOptions = members.map((m) => ({ value: m.id, label: memberName(m) }));
  const overRestoration = (m: BathroomEstimate) =>
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
            const done = message.loading('Drawing each estimate in 3D for the proposal…', 0);
            try {
              await exportProposalWith3D(estimate.id, estimate.property_address);
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
                  render: (_: unknown, m: BathroomEstimate) => (
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
                  render: (_: unknown, m: BathroomEstimate) => (
                    <span style={figure}>{m.total ? money(m.total) : 'Not calculated'}</span>
                  ),
                },
                ...(insurance && restoration ? [{
                  title: 'Over restoration',
                  key: 'over',
                  align: 'right' as const,
                  render: (_: unknown, m: BathroomEstimate) => (
                    <span style={figure}>{overRestoration(m) ?? '—'}</span>
                  ),
                }] : []),
              ]}
            />
          </Section>

          <Section title="By phase">
            <Table
              size="small"
              rowKey="phase"
              pagination={false}
              scroll={{ x: true }}
              dataSource={phases.map((phase) => ({ phase }))}
              columns={[
                {
                  title: 'Phase',
                  key: 'phase',
                  render: (_: unknown, r: { phase: number }) => `${r.phase}. ${PHASE_LABELS[r.phase] ?? ''}`,
                },
                ...members.map((m) => ({
                  title: memberName(m),
                  key: m.id,
                  align: 'right' as const,
                  render: (_: unknown, r: { phase: number }) => (
                    <span style={figure}>{money(totalsByMember[m.id]?.[r.phase] || 0)}</span>
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
            {base && option && base.id !== option.id && <Compare3D base={base} option={option} />}
            {!base || !option || base.id === option.id ? (
              <Text type="secondary">Pick two different estimates.</Text>
            ) : changes.length === 0 ? (
              <Text type="secondary">{memberName(option)} has the same line items as {memberName(base)}.</Text>
            ) : (
              <Table
                size="small"
                rowKey={(c) => `${c.phase}-${c.description}`}
                pagination={false}
                dataSource={changes}
                columns={[
                  {
                    title: 'Item',
                    key: 'item',
                    render: (_: unknown, c) => (
                      <span>
                        {c.description}
                        <Text type="secondary" style={{ fontSize: 12 }}> · {PHASE_LABELS[c.phase] ?? `Phase ${c.phase}`}</Text>
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

export default BEGroupCompareDrawer;
