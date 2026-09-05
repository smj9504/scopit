/**
 * Mobile Document Items
 * Read-only line items for the Estimate and Invoice detail pages on mobile.
 *
 * The desktop Table can't survive a phone: global.css forces
 * `white-space: nowrap` on every table cell, so a long description makes the
 * table wider than the viewport, and the page's own `overflow-x: hidden`
 * ancestor then clips the Qty/Price/Total columns with no way to scroll to
 * them. Stacking each item instead keeps every number on screen — the same
 * pattern the editor pages use via MobileLineItemCard.
 */
import React from 'react';
import { colors, fonts } from '@/styles/theme';
import { formatCurrency } from '@/utils/formatters';

export interface MobileDocumentItem {
  id: string;
  name?: string;
  description?: string | null;
  unit?: string | null;
  quantity?: number;
  unitPrice?: number;
  total?: number;
  notes?: string[];
}

interface MobileDocumentItemsProps {
  items: MobileDocumentItem[];
  /** Decimals on the quantity — invoices show 2, estimates show as entered. */
  quantityPrecision?: number;
}

export const MobileDocumentItems: React.FC<MobileDocumentItemsProps> = ({
  items,
  quantityPrecision,
}) => {
  if (items.length === 0) return null;

  return (
    <div>
      {items.map((item, index) => {
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.unitPrice || 0);
        const notes = item.notes ?? [];

        return (
          <div
            key={item.id}
            style={{
              padding: '12px 0',
              borderTop: index === 0 ? 'none' : `1px solid ${colors.border}`,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>
              {item.name || 'Untitled item'}
            </div>

            {/* Desktop keeps these in a hover tooltip; there is no hover here. */}
            {item.description && (
              <div
                style={{
                  fontSize: 12,
                  color: colors.textSecondary,
                  marginTop: 4,
                  overflowWrap: 'anywhere',
                }}
              >
                {item.description}
              </div>
            )}
            {notes.map((note, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  color: colors.textMuted,
                  marginTop: 2,
                  overflowWrap: 'anywhere',
                }}
              >
                {note}
              </div>
            ))}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 12,
                marginTop: 6,
              }}
            >
              <span style={{ fontSize: 13, color: colors.textSecondary, minWidth: 0 }}>
                {quantityPrecision != null ? quantity.toFixed(quantityPrecision) : quantity}
                {item.unit ? ` ${item.unit}` : ''} × {formatCurrency(unitPrice)}
              </span>
              <span
                style={{
                  fontFamily: fonts.heading,
                  fontWeight: 600,
                  fontSize: 14,
                  letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {formatCurrency(Number(item.total || 0))}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default MobileDocumentItems;
