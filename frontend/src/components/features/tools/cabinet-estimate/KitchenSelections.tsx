/**
 * KitchenSelections
 *
 * An upgrade option's products, one per slot (cabinets, hardware,
 * countertop, backsplash, sink, faucet), chosen from the product library.
 * Each prices its material at the product's own price, our labor staying as
 * quoted, and draws the kitchen in the Sketch tab's realistic 3D view. The
 * estimate keeps a copy of each product as it was when chosen.
 *
 * A restoration takes no products: the carrier's estimate is priced from
 * the rate tables alone, so it shows nothing here.
 */

import React, { useState } from 'react';
import { Button, Card, Popconfirm, Space, Spin, Tooltip, Typography, message } from 'antd';
import { DeleteOutlined, LinkOutlined, PictureOutlined, ShoppingOutlined, SwapOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import ProductPicker from '@/components/features/tools/cabinet-estimate/products/ProductPicker';
import { priceLine, sizeLine } from '@/components/features/tools/cabinet-estimate/products/ProductCard';
import { cabinetEstimateService } from '@/services/cabinetEstimateService';
import { useProductImage } from '@/components/features/tools/cabinet-estimate/products/productImages';
import type { CabinetEstimate, SelectionSlot } from '@/types/cabinetEstimate';
import type { ProductSnapshot } from '@/types/productLibrary';

const { Text } = Typography;

// Until pricing-info answers; the backend's selections.SLOTS is the source.
const FALLBACK_SLOTS: SelectionSlot[] = [
  { key: 'cabinets', label: 'Cabinets', category: 'cabinet', prices: 'Cabinet supply, at the product’s price per linear foot' },
  { key: 'cabinet_hardware', label: 'Hardware', category: 'cabinet_hardware', prices: 'One per door and drawer front' },
  { key: 'countertop', label: 'Countertop', category: 'countertop', prices: 'Countertop material per sq ft, plus our fabrication and install' },
  { key: 'backsplash', label: 'Backsplash', category: 'backsplash', prices: 'Tile per sq ft with overage, plus our install' },
  { key: 'kitchen_sink', label: 'Sink', category: 'kitchen_sink', prices: 'One per sink base (needs the plumbing scope)' },
  { key: 'kitchen_faucet', label: 'Faucet', category: 'kitchen_faucet', prices: 'One per sink (needs the plumbing scope)' },
];

export interface KitchenSelectionsProps {
  estimate: CabinetEstimate;
  slots?: SelectionSlot[];
  /** The option came back repriced with the change. */
  onChanged: (estimate: CabinetEstimate) => void;
  /** Run `action` once the page's unsaved edits are saved or let go (the change reprices from what's saved). */
  guardUnsaved: (action: () => void) => void;
}

const Thumb: React.FC<{ product?: ProductSnapshot }> = ({ product }) => {
  const image = useProductImage(product?.image_file_ids?.[0]);
  return (
    <div
      style={{
        width: 56,
        height: 56,
        flex: 'none',
        borderRadius: 6,
        background: '#fafaf8',
        border: '1px solid #eeece8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {image ? (
        <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        <PictureOutlined style={{ fontSize: 18, color: product ? '#c9c7c2' : '#e2e0dc' }} />
      )}
    </div>
  );
};

const KitchenSelections: React.FC<KitchenSelectionsProps> = ({ estimate, slots, onChanged, guardUnsaved }) => {
  const [picking, setPicking] = useState<SelectionSlot | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const list = slots?.length ? slots : FALLBACK_SLOTS;
  const chosen = estimate.selections || {};

  const change = useMutation({
    mutationFn: ({ slot, productId }: { slot: string; productId: string | null }) =>
      productId
        ? cabinetEstimateService.setSelection(estimate.id, slot, productId)
        : cabinetEstimateService.clearSelection(estimate.id, slot),
    onMutate: ({ slot }) => setBusySlot(slot),
    onSuccess: (updated, { productId }) => {
      onChanged(updated);
      message.success(
        updated.status === 'draft'
          ? productId ? 'Product chosen. Calculate to price it.' : 'Product removed'
          : productId ? 'Product chosen and the option repriced' : 'Product removed and the option repriced'
      );
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Could not change the product'),
    onSettled: () => setBusySlot(null),
  });

  if (estimate.kind !== 'option') return null;

  const pick = (slot: SelectionSlot, productId: string | null) =>
    guardUnsaved(() => change.mutate({ slot: slot.key, productId }));

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <ShoppingOutlined />
          Products
        </Space>
      }
      extra={
        <Text type="secondary" style={{ fontSize: 12 }}>
          Retail price + 15% handling; our labor as quoted
        </Text>
      }
      style={{ marginBottom: 16 }}
    >
      <div style={{ display: 'grid', gap: 10 }}>
        {list.map((slot) => {
          const product = chosen[slot.key];
          const busy = busySlot === slot.key && change.isPending;
          const details = product ? [priceLine(product), sizeLine(product)].filter(Boolean).join(' · ') : null;
          return (
            <div key={slot.key} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56 }}>
              <Thumb product={product} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {slot.label}
                </Text>
                {product ? (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.35 }}>
                      {[product.brand, product.title].filter(Boolean).join(' ')}
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {[product.finish, details].filter(Boolean).join(' · ')}
                      {product.source_url && (
                        <>
                          {' · '}
                          <a href={product.source_url} target="_blank" rel="noreferrer">
                            <LinkOutlined /> Listing
                          </a>
                        </>
                      )}
                    </Text>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: '#8c8b87' }}>Rate-table price. {slot.prices}.</div>
                )}
              </div>
              {busy ? (
                <Spin size="small" />
              ) : (
                <Space size={4}>
                  <Button size="small" icon={product ? <SwapOutlined /> : <ShoppingOutlined />} onClick={() => setPicking(slot)}>
                    {product ? 'Change' : 'Choose'}
                  </Button>
                  {product && (
                    <Popconfirm
                      title={`Remove the ${slot.label.toLowerCase()}?`}
                      description="That part goes back to the rate-table price."
                      okText="Remove"
                      onConfirm={() => pick(slot, null)}
                    >
                      <Tooltip title="Remove">
                        <Button size="small" type="text" icon={<DeleteOutlined />} aria-label={`Remove the ${slot.label}`} />
                      </Tooltip>
                    </Popconfirm>
                  )}
                </Space>
              )}
            </div>
          );
        })}
      </div>

      <ProductPicker
        open={!!picking}
        categories={picking ? [picking.category] : []}
        title={picking ? `Choose the ${picking.label.toLowerCase()} for ${estimate.option_label || 'this option'}` : undefined}
        selectedId={picking ? chosen[picking.key]?.product_id : null}
        onClose={() => setPicking(null)}
        onPick={(product) => {
          const slot = picking!;
          setPicking(null);
          pick(slot, product.id);
        }}
      />
    </Card>
  );
};

export default KitchenSelections;
