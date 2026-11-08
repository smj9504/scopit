import React from 'react';
import { Card, Timeline, Typography } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { cabinetEstimateService } from '@/services/cabinetEstimateService';

const { Text } = Typography;

interface CabinetEstimateHistoryProps {
  estimateId: string;
}

const CabinetEstimateHistory: React.FC<CabinetEstimateHistoryProps> = ({ estimateId }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['cabinet-estimate-history', estimateId],
    queryFn: () => cabinetEstimateService.getHistory(estimateId),
    enabled: !!estimateId,
  });

  if (isLoading) return <Card size="small" loading />;

  if (!data?.length) {
    return (
      <Card size="small" title={<><HistoryOutlined /> Version History</>}>
        <Text type="secondary">No history yet. Run a calculation to create the first version.</Text>
      </Card>
    );
  }

  return (
    <Card size="small" title={<><HistoryOutlined /> Version History</>}>
      <Timeline
        items={data.map((h) => ({
          children: (
            <div>
              <Text strong>Version {h.version_number}</Text>
              <br />
              <Text type="secondary">{h.change_description || 'No description'}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {h.created_at ? new Date(h.created_at).toLocaleString() : ''}
              </Text>
              {h.snapshot_data?.total && (
                <>
                  <br />
                  <Text>
                    Total: ${h.snapshot_data.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </>
              )}
            </div>
          ),
        }))}
      />
    </Card>
  );
};

export default CabinetEstimateHistory;
