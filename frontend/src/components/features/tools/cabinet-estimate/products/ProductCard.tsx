/**
 * ProductCard
 *
 * One library product as a card: picture, category, name, brand and
 * finish, price and size, and a link to the listing. Used by the library
 * page and by ProductPicker.
 */

import React from 'react';
import { Card, Typography } from 'antd';
import { CheckCircleFilled, LinkOutlined, PictureOutlined } from '@ant-design/icons';
import { useProductImage } from '@/components/features/tools/cabinet-estimate/products/productImages';
import type { Product, ProductFields, ProductMeta } from '@/types/productLibrary';

const { Text } = Typography;
const UNIT_SHORT: Record<string, string> = { each: 'ea', sf: 'sq ft', box: 'box', lf: 'lin ft' };

const inches = (v?: number | null) => (v ? `${Number(v.toFixed(2))}"` : null);

/** "36" × 22" × 34.5"", or a tile's piece size. */
export function sizeLine(p: Pick<ProductFields, 'width_in' | 'depth_in' | 'height_in' | 'tile_width_in' | 'tile_length_in'>): string | null {
  const dims = [inches(p.width_in), inches(p.depth_in), inches(p.height_in)].filter(Boolean);
  if (dims.length >= 2) return `${dims.join(' × ')}`;
  if (p.tile_width_in && p.tile_length_in) return `${inches(p.tile_width_in)} × ${inches(p.tile_length_in)} piece`;
  return dims[0] ?? null;
}

/** "$18.99 / box (12.5 sq ft)". */
export function priceLine(p: Pick<ProductFields, 'price' | 'price_unit' | 'box_sf'>): string | null {
  if (p.price == null || p.price === '') return null;
  const n = Number(p.price);
  const base = `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const unit = UNIT_SHORT[p.price_unit] ?? p.price_unit;
  return `${base} / ${unit}${p.price_unit === 'box' && p.box_sf ? ` (${p.box_sf} sq ft)` : ''}`;
}

export interface ProductCardProps {
  product: Product;
  meta?: ProductMeta;
  onOpen: () => void;
  /** Marked as the one already chosen (ProductPicker). */
  selected?: boolean;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, meta, onOpen, selected }) => {
  const category = meta?.categories.find((c) => c.key === product.category)?.label ?? product.category;
  const retailer = meta?.retailers.find((r) => r.key === product.retailer)?.label;
  const image = useProductImage(product.image_file_ids[0]);
  const size = sizeLine(product);
  const price = priceLine(product);
  return (
    <Card
      hoverable
      size="small"
      onClick={onOpen}
      style={selected ? { borderColor: '#2563eb', boxShadow: '0 0 0 1px #2563eb' } : undefined}
      styles={{ body: { padding: 10 } }}
      cover={
        <div
          style={{
            aspectRatio: '4 / 3',
            background: '#fafaf8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {image ? (
            <img
              src={image}
              alt=""
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8 }}
            />
          ) : (
            <PictureOutlined style={{ fontSize: 28, color: '#c9c7c2' }} />
          )}
          {selected && (
            <CheckCircleFilled style={{ position: 'absolute', top: 8, right: 8, fontSize: 20, color: '#2563eb' }} />
          )}
        </div>
      }
    >
      <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {category}
      </Text>
      <div
        style={{
          fontWeight: 600,
          fontSize: 13,
          lineHeight: 1.35,
          margin: '2px 0 4px',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: 35,
        }}
      >
        {product.title}
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block' }} ellipsis>
        {[product.brand, product.finish].filter(Boolean).join(' · ') || ' '}
      </Text>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, gap: 6 }}>
        <Text strong style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          {price ?? <Text type="secondary">No price</Text>}
        </Text>
        <Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          {size}
        </Text>
      </div>
      {product.source_url && (
        <a
          href={product.source_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ fontSize: 12, display: 'inline-block', marginTop: 4 }}
        >
          <LinkOutlined /> {retailer ?? 'Listing'}
        </a>
      )}
    </Card>
  );
};

export default ProductCard;
