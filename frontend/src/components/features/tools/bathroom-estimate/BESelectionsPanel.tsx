/**
 * The products an option is built from: one row per slot (the vanity, the
 * floor tile…), each picked from the company's product library. A picked
 * product's price becomes the material cost, our labor stays on the rate
 * tables, and the plan and 3D view take its size and look. Only options
 * have this; the restoration stays priced from the rate tables.
 */

import React, { useState } from 'react';
import { Button, Checkbox, Skeleton, Typography } from 'antd';
import { LinkOutlined, PictureOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import ProductPicker from '@/components/features/tools/cabinet-estimate/products/ProductPicker';
import { priceLine, sizeLine } from '@/components/features/tools/cabinet-estimate/products/ProductCard';
import { bathroomEstimateService } from '@/services/bathroomEstimateService';
import { useProductImage } from '@/components/features/tools/cabinet-estimate/products/productImages';
import { productLibraryService } from '@/services/productLibraryService';
import type { BathroomEstimate, BathroomSelection, BathroomSelectionSlot } from '@/types/bathroomEstimate';

const { Text } = Typography;

interface BESelectionsPanelProps {
  estimate: BathroomEstimate;
  /**
   * Pick a product for a slot, or take it off (null). The page stores it,
   * draws the plan at the product's size and reprices the option.
   */
  onChange: (slot: string, productId: string | null, options?: { includesTop?: boolean }) => Promise<void>;
  /** The slot being stored and repriced right now. */
  busySlot?: string | null;
}

const Thumb: React.FC<{ fileId?: string }> = ({ fileId }) => {
  const src = useProductImage(fileId);
  return (
    <div style={{
      width: 56, height: 56, flex: '0 0 56px', borderRadius: 6, background: '#f9fafb',
      border: '1px solid var(--color-neutral-200)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      {src
        ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        : <PictureOutlined style={{ fontSize: 20, color: '#c9c7c2' }} />}
    </div>
  );
};

const BESelectionsPanel: React.FC<BESelectionsPanelProps> = ({ estimate, onChange, busySlot }) => {
  const [picking, setPicking] = useState<BathroomSelectionSlot | null>(null);
  const { data: slots, isLoading } = useQuery({
    queryKey: ['bathroom-selection-slots'],
    queryFn: () => bathroomEstimateService.getSelectionSlots(),
    staleTime: Infinity,
  });
  const { data: meta } = useQuery({ queryKey: ['product-meta'], queryFn: productLibraryService.getMeta, staleTime: Infinity });
  const selections = estimate.selections || {};

  if (isLoading || !slots) return <Skeleton active paragraph={{ rows: 4 }} />;

  const retailerOf = (p: BathroomSelection) => meta?.retailers.find((r) => r.key === p.retailer)?.label ?? 'Listing';

  return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Pick the products this option is built from. A product's price becomes the material cost and our labor stays
        the same; a picked vanity, tub, toilet or mirror is drawn at its real size. Anything not picked is priced at
        the usual allowance.
      </Text>
      {slots.map((slot) => {
        const p = selections[slot.key];
        const busy = busySlot === slot.key;
        const details = p ? [priceLine(p), sizeLine(p)].filter(Boolean).join(' · ') : null;
        return (
          <div
            key={slot.key}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              padding: '10px 0', borderBottom: '1px solid var(--color-neutral-100)',
            }}
          >
            <Thumb fileId={p?.image_file_ids?.[0]} />
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {slot.label}
              </Text>
              {p ? (
                <>
                  <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.35 }}>{p.title}</div>
                  <Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {[p.brand, p.finish].filter(Boolean).join(' · ')}
                    {details ? `${p.brand || p.finish ? ' · ' : ''}${details}` : ''}
                  </Text>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
                    {p.source_url && (
                      <a href={p.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                        <LinkOutlined /> {retailerOf(p)}
                      </a>
                    )}
                    {slot.key === 'vanity' && (
                      <Checkbox
                        checked={!!p.includes_top}
                        disabled={busy}
                        onChange={(e) => onChange(slot.key, p.product_id, { includesTop: e.target.checked })}
                        style={{ fontSize: 12 }}
                      >
                        Comes with its top
                      </Checkbox>
                    )}
                  </div>
                </>
              ) : (
                <div><Text type="secondary">Allowance</Text></div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="small" loading={busy} onClick={() => setPicking(slot)}>
                {p ? 'Change' : 'Choose'}
              </Button>
              {p && (
                <Button size="small" type="text" danger disabled={busy} onClick={() => onChange(slot.key, null)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <ProductPicker
        open={!!picking}
        categories={picking?.categories ?? ['other']}
        title={picking ? `Choose the ${picking.label.toLowerCase()}` : undefined}
        selectedId={picking ? selections[picking.key]?.product_id : undefined}
        onClose={() => setPicking(null)}
        onPick={(product) => {
          const slot = picking!;
          setPicking(null);
          onChange(slot.key, product.id);
        }}
      />
    </div>
  );
};

export default BESelectionsPanel;
