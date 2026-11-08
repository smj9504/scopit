/**
 * What an option's layout changes from the bathroom as it is — fixtures
 * moved, added or taken out, a tub turned into a shower, walls and doors
 * moved — each priced on Calculate unless unticked here. Read from the saved
 * sketch, so it catches up on Save or Calculate.
 */

import React from 'react';
import { Checkbox, Skeleton, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { bathroomEstimateService } from '@/services/bathroomEstimateService';
import type { BathroomLayoutChange } from '@/types/bathroomEstimate';

const { Text } = Typography;

const WHAT_IT_PRICES: Record<BathroomLayoutChange['kind'], string> = {
  moved: 'relocation',
  added: 'new rough-in',
  removed: 'cap / infill',
  converted: 'conversion',
  sinks_added: 'new rough-in',
  drain_moved: 'drain relocation',
  valve_moved: 'valve relocation',
  wall_added: 'framing',
  wall_removed: 'wall removal',
};

interface BELayoutChangesProps {
  estimateId: string;
  isRemodel: boolean;
  /** Keys of the changes left out of the price (plumbing_spec.layout_change_skips). */
  skips: string[];
  onSkipsChange: (skips: string[]) => void;
}

const BELayoutChanges: React.FC<BELayoutChangesProps> = ({ estimateId, isRemodel, skips, onSkipsChange }) => {
  const { data: report, isLoading } = useQuery({
    queryKey: ['bathroom-layout-changes', estimateId],
    queryFn: () => bathroomEstimateService.getLayoutChanges(estimateId),
  });

  if (isLoading) return <Skeleton active paragraph={{ rows: 2 }} />;
  if (!report) return null;

  const heading = (
    <div style={{ borderBottom: '1px solid var(--color-neutral-200)', paddingBottom: 6, marginBottom: 8, fontSize: 16, fontWeight: 600 }}>
      Layout changes{report.baseline ? ` from the ${report.baseline.name.toLowerCase()}` : ''}
    </div>
  );

  if (!report.baseline) {
    return isRemodel ? (
      <section style={{ marginBottom: 24 }}>
        {heading}
        <Text type="secondary">
          Moved plumbing and walls aren't priced yet: this remodel has no current layout to compare with.
          Add one with "Current layout" above and draw the bathroom as it is today.
        </Text>
      </section>
    ) : null;
  }

  return (
    <section style={{ marginBottom: 24 }}>
      {heading}
      {report.changes.length === 0 ? (
        <Text type="secondary">Same layout as the {report.baseline.name.toLowerCase()}: nothing moved.</Text>
      ) : (
        <>
          {report.changes.map((c) => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 34, borderBottom: '1px solid var(--color-neutral-200)' }}>
              <Checkbox
                checked={!skips.includes(c.key)}
                onChange={(e) => onSkipsChange(e.target.checked ? skips.filter((k) => k !== c.key) : [...skips, c.key])}
                aria-label={`Price: ${c.label}`}
              >
                {c.label}
              </Checkbox>
              <Text type="secondary" style={{ fontSize: 12 }}>{WHAT_IT_PRICES[c.kind]}</Text>
            </div>
          ))}
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
            Ticked changes are priced on Calculate (Phase 1–3). Untick one that needs no work, e.g. a toilet nudged on its own flange.
          </Text>
        </>
      )}
    </section>
  );
};

export default BELayoutChanges;
