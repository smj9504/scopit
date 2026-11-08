import React from 'react';
import { Alert, Card, Divider, Space, Table, Tag, Typography } from 'antd';
import type { CabinetEstimate, EstimateLineItem } from '@/types/cabinetEstimate';

const { Title, Text } = Typography;

interface CabinetEstimateResultProps {
  estimate: CabinetEstimate;
}

const CATEGORY_COLORS: Record<string, string> = {
  supply: 'blue',
  scope: 'green',
  premium: 'orange',
  labor: 'cyan',
  demo: 'red',
  install: 'geekblue',
  plumbing: 'purple',
  countertop: 'gold',
  backsplash: 'magenta',
  finishing: 'lime',
  misc: 'default',
};

const LOCATION_COLORS: Record<string, string> = {
  perimeter: '',
  island: 'volcano',
  shared: '',
};

const CabinetEstimateResult: React.FC<CabinetEstimateResultProps> = ({ estimate }) => {
  const fmtMoney = (val: number) =>
    `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const hasIsland = estimate.line_items.some((li) => li.location === 'island');

  const columns = [
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (cat: string) => cat ? (
        <Tag color={CATEGORY_COLORS[cat] || 'default'}>{cat}</Tag>
      ) : '-',
    },
    ...(hasIsland ? [{
      title: 'Location',
      dataIndex: 'location',
      key: 'location',
      width: 100,
      render: (loc: string) => {
        if (loc === 'island') return <Tag color="volcano">Island</Tag>;
        if (loc === 'shared') return <Tag>Shared</Tag>;
        return <Tag color="blue">Perimeter</Tag>;
      },
    }] : []),
    {
      title: 'Qty',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'right' as const,
      render: (val: number) => val?.toFixed(1),
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 60,
    },
    {
      title: 'Unit Price',
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: 110,
      align: 'right' as const,
      render: (val: number) => fmtMoney(val),
    },
    {
      title: 'Material',
      dataIndex: 'material_total',
      key: 'material_total',
      width: 110,
      align: 'right' as const,
      render: (val?: number) => (
        <Text type={val ? undefined : 'secondary'}>{fmtMoney(val || 0)}</Text>
      ),
    },
    {
      title: 'Labor',
      dataIndex: 'labor_total',
      key: 'labor_total',
      width: 110,
      align: 'right' as const,
      render: (val?: number) => (
        <Text type={val ? undefined : 'secondary'}>{fmtMoney(val || 0)}</Text>
      ),
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 120,
      align: 'right' as const,
      render: (val: number) => <Text strong>{fmtMoney(val)}</Text>,
    },
  ];

  const materialTotal = estimate.line_items.reduce(
    (s, li) => s + (li.material_total || 0), 0);
  const laborTotal = estimate.line_items.reduce(
    (s, li) => s + (li.labor_total || 0), 0);
  // Only worth showing once a calculation has actually filled the split in
  const hasSplit = materialTotal > 0 || laborTotal > 0;

  const splitLine = hasSplit ? (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, fontSize: 12 }}>
      <Text type="secondary">
        Material {fmtMoney(materialTotal)}{' + '}Labor {fmtMoney(laborTotal)}
        {' '}(shown combined on the estimate PDF)
      </Text>
    </div>
  ) : null;

  // If island exists, group and show subtotals per location
  const renderGroupedTable = () => {
    const perimeterItems = estimate.line_items.filter((li) => li.location === 'perimeter');
    const islandItems = estimate.line_items.filter((li) => li.location === 'island');
    const sharedItems = estimate.line_items.filter((li) => li.location === 'shared');

    const perimeterTotal = perimeterItems.reduce((s, li) => s + li.total, 0);
    const islandTotal = islandItems.reduce((s, li) => s + li.total, 0);
    const sharedTotal = sharedItems.reduce((s, li) => s + li.total, 0);

    const colSpan = columns.length - 1;

    const renderSection = (title: string, items: EstimateLineItem[], sectionTotal: number, color: string) => {
      if (!items.length) return null;
      return (
        <>
          <Divider orientation="left" style={{ margin: '8px 0', fontSize: 13 }}>
            <Tag color={color} style={{ fontSize: 12 }}>{title}</Tag>
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              {items.length} items — {fmtMoney(sectionTotal)}
            </Text>
          </Divider>
          <Table
            dataSource={items}
            columns={columns.filter((c) => c.key !== 'location')}
            rowKey="id"
            pagination={false}
            size="small"
            summary={() => (
              <Table.Summary.Row style={{ background: '#fafafa' }}>
                <Table.Summary.Cell index={0} colSpan={colSpan - 1} align="right">
                  <Text strong>{title} Subtotal</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Text strong>{fmtMoney(sectionTotal)}</Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />
        </>
      );
    };

    return (
      <Card size="small" style={{ marginBottom: 16 }}>
        {renderSection('Perimeter', perimeterItems, perimeterTotal, 'blue')}
        {renderSection('Island', islandItems, islandTotal, 'volcano')}
        {renderSection('General', sharedItems, sharedTotal, 'default')}

        <Divider style={{ margin: '12px 0' }} />

        <div style={{ textAlign: 'right', padding: '4px 16px' }}>
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 32, background: '#f0f5ff', padding: '8px 0', borderRadius: 4 }}>
              <Title level={5} style={{ margin: 0 }}>TOTAL</Title>
              <Title level={5} style={{ margin: 0 }}>{fmtMoney(estimate.total)}</Title>
            </div>
            {splitLine}
            {(estimate.overhead_pct > 0 || estimate.profit_pct > 0) && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, fontSize: 12 }}>
                <Text type="secondary">
                  O&P included: Overhead {(estimate.overhead_pct * 100).toFixed(0)}% ({fmtMoney(estimate.overhead_amount)})
                  {' + '}Profit {(estimate.profit_pct * 100).toFixed(0)}% ({fmtMoney(estimate.profit_amount)})
                </Text>
              </div>
            )}
            {estimate.adjustment_factor && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, fontSize: 12 }}>
                <Text type="secondary">
                  Target adjustment: {estimate.adjustment_factor.toFixed(4)}x
                  {estimate.target_total && ` (target: ${fmtMoney(estimate.target_total)})`}
                </Text>
              </div>
            )}
          </Space>
        </div>
      </Card>
    );
  };

  // Flat table (no island)
  const renderFlatTable = () => (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Table
        dataSource={estimate.line_items}
        columns={columns}
        rowKey="id"
        pagination={false}
        size="small"
        summary={() => (
          <>
            <Table.Summary.Row style={{ background: '#f0f5ff' }}>
              <Table.Summary.Cell index={0} colSpan={columns.length - 1} align="right">
                <Title level={5} style={{ margin: 0 }}>TOTAL</Title>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <Title level={5} style={{ margin: 0 }}>{fmtMoney(estimate.total)}</Title>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          </>
        )}
      />
      <div style={{ textAlign: 'right', padding: '8px 16px 0' }}>
        {splitLine}
        {(estimate.overhead_pct > 0 || estimate.profit_pct > 0) && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            O&P included: Overhead {(estimate.overhead_pct * 100).toFixed(0)}% ({fmtMoney(estimate.overhead_amount)})
            {' + '}Profit {(estimate.profit_pct * 100).toFixed(0)}% ({fmtMoney(estimate.profit_amount)})
          </Text>
        )}
        {estimate.adjustment_factor && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Target adjustment: {estimate.adjustment_factor.toFixed(4)}x
              {estimate.target_total && ` (target: ${fmtMoney(estimate.target_total)})`}
            </Text>
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <div>
      {hasIsland ? renderGroupedTable() : renderFlatTable()}

      {estimate.warning_flags && estimate.warning_flags.length > 0 && (
        <Card size="small" title="Notes" style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={4}>
            {estimate.warning_flags.map((w, i) => (
              <Text key={i} type="warning">- {w}</Text>
            ))}
          </Space>
        </Card>
      )}

      {estimate.methodology_notes && (
        <Card size="small" title="Methodology">
          <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
            {estimate.methodology_notes}
          </pre>
        </Card>
      )}
    </div>
  );
};

export default CabinetEstimateResult;
