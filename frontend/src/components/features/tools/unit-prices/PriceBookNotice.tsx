/**
 * Says when an estimate's prices are older than today's, and offers to
 * reprice its job at today's prices.
 *
 * An estimate keeps the prices it was first priced with (its price book),
 * so a company price change or a default update never moves a quote that
 * has gone out. Nothing shows while its prices are today's. Ported from MJ
 * Estimate.
 */

import React from 'react';
import { Alert, Button, Popconfirm, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unitPriceService } from '@/services/unitPriceService';
import type { PriceBookSummary, PriceDomain } from '@/types/unitPrices';

interface PriceBookNoticeProps {
  domain: PriceDomain;
  estimateId: string;
  priceBook?: PriceBookSummary | null;
  /** Query keys to refresh after repricing */
  refreshKeys: unknown[][];
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const PriceBookNotice: React.FC<PriceBookNoticeProps> = ({ domain, estimateId, priceBook, refreshKeys }) => {
  const queryClient = useQueryClient();
  const reprice = useMutation({
    mutationFn: () => unitPriceService.useCurrentPrices(domain, estimateId),
    onSuccess: () => {
      refreshKeys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      message.success('Repriced at current prices');
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Could not reprice the estimate'),
  });

  if (!priceBook || priceBook.is_current) return null;
  const since = fmtDate(priceBook.priced_at);

  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 12 }}
      message={since ? `Priced with the prices in use since ${since}` : 'Priced with earlier prices'}
      description="Your company's prices or the default prices have changed since. This estimate keeps the prices it was priced with until you reprice it."
      action={(
        <Popconfirm
          title="Reprice at current prices?"
          description="Every calculated estimate in this job, options included, is recalculated at today's prices. Totals may change."
          okText="Reprice"
          cancelText="Cancel"
          onConfirm={() => reprice.mutate()}
        >
          <Button size="small" loading={reprice.isPending}>Use current prices</Button>
        </Popconfirm>
      )}
    />
  );
};

export default PriceBookNotice;
