import React from 'react';
import { Card, Table, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { cabinetEstimateService } from '@/services/cabinetEstimateService';
import type { PurchaseOrderItem } from '@/types/cabinetEstimate';

const { Title, Text } = Typography;

interface CabinetPurchaseOrderProps {
  estimateId: string;
}

const CabinetPurchaseOrder: React.FC<CabinetPurchaseOrderProps> = ({ estimateId }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['cabinet-purchase-order', estimateId],
    queryFn: () => cabinetEstimateService.getPurchaseOrder(estimateId),
    enabled: !!estimateId,
  });

  const columns = [
    { title: 'Code', dataIndex: 'code', key: 'code', width: 100 },
    { title: 'Type', dataIndex: 'cab_type', key: 'cab_type', width: 80 },
    { title: 'Description', dataIndex: 'description', key: 'description' },
    { title: 'Width', dataIndex: 'width_inches', key: 'width_inches', width: 80, render: (v: number) => `${v}"` },
    { title: 'Height', dataIndex: 'height_inches', key: 'height_inches', width: 80, render: (v: number) => `${v}"` },
    { title: 'Qty', dataIndex: 'qty', key: 'qty', width: 60, align: 'center' as const },
  ];

  return (
    <Card
      size="small"
      title="Purchase Order (Supplier)"
      extra={data && <Text type="secondary">Total Boxes: {data.total_boxes}</Text>}
    >
      <Table
        dataSource={data?.items || []}
        columns={columns}
        rowKey="code"
        loading={isLoading}
        pagination={false}
        size="small"
      />
    </Card>
  );
};

export default CabinetPurchaseOrder;
