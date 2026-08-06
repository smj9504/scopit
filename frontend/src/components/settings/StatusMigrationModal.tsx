/**
 * Scopit - Status Migration Modal
 * Shows when deleting a status that's in use, allowing user to select a replacement status
 */
import React, { useState, useEffect } from 'react';
import { Modal, Select, Alert, Spin, List, Typography } from 'antd';
import { ExclamationCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import { colors, fonts } from '@/styles/theme';
import type {
  StatusUsageResponse,
  EstimateStatusConfig,
  InvoiceStatusConfig,
} from '@/types/entities';

const { Text } = Typography;

export type StatusType = 'estimate' | 'invoice';

interface StatusMigrationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (migrateToId: string) => void;
  loading?: boolean;
  statusType: StatusType;
  statusToDelete: EstimateStatusConfig | InvoiceStatusConfig | null;
  usageInfo: StatusUsageResponse | null;
  availableStatuses: (EstimateStatusConfig | InvoiceStatusConfig)[];
}

export const StatusMigrationModal: React.FC<StatusMigrationModalProps> = ({
  open,
  onClose,
  onConfirm,
  loading = false,
  statusType,
  statusToDelete,
  usageInfo,
  availableStatuses,
}) => {
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null);

  // Reset selection when modal opens with new status
  useEffect(() => {
    if (open) {
      setSelectedStatusId(null);
    }
  }, [open, statusToDelete?.id]);

  // Filter out the status being deleted from available options
  const migrationOptions = availableStatuses.filter(
    (s) => s.id !== statusToDelete?.id && s.isActive
  );

  const handleConfirm = () => {
    if (selectedStatusId) {
      onConfirm(selectedStatusId);
    }
  };

  const entityName = statusType === 'estimate' ? 'estimate' : 'invoice';
  const entityNamePlural = statusType === 'estimate' ? 'estimates' : 'invoices';

  if (!statusToDelete || !usageInfo) {
    return null;
  }

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ExclamationCircleOutlined style={{ color: colors.warning, fontSize: 20 }} />
          <span>Migrate {entityNamePlural} before deleting</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      onOk={handleConfirm}
      okText={`Migrate and Delete`}
      okButtonProps={{
        danger: true,
        disabled: !selectedStatusId,
        loading,
      }}
      cancelButtonProps={{ disabled: loading }}
      width={520}
      maskClosable={!loading}
      closable={!loading}
    >
      <div style={{ marginTop: 16 }}>
        {/* Status being deleted */}
        <div style={{ marginBottom: 20 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            Status to delete:
          </Text>
          <div
            style={{
              display: 'inline-block',
              padding: '6px 16px',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              color: statusToDelete.color,
              background: statusToDelete.bgColor,
            }}
          >
            {statusToDelete.name}
          </div>
        </div>

        {/* Warning message */}
        <Alert
          type="warning"
          showIcon
          message={
            <span>
              This status is currently used by{' '}
              <strong>{usageInfo.usageCount} {entityName}{usageInfo.usageCount !== 1 ? 's' : ''}</strong>.
              You must select a replacement status before deleting.
            </span>
          }
          style={{ marginBottom: 20 }}
        />

        {/* Migration target selection */}
        <div style={{ marginBottom: 20 }}>
          <Text style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
            Migrate to status: <span style={{ color: colors.error }}>*</span>
          </Text>
          <Select
            style={{ width: '100%' }}
            placeholder={`Select a status for affected ${entityNamePlural}`}
            value={selectedStatusId}
            onChange={setSelectedStatusId}
            options={migrationOptions.map((status) => ({
              value: status.id,
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      color: status.color,
                      background: status.bgColor,
                    }}
                  >
                    {status.name}
                  </span>
                  {status.isDefault && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      (default)
                    </Text>
                  )}
                </div>
              ),
            }))}
          />
        </div>

        {/* Affected items preview */}
        {usageInfo.affectedItems && usageInfo.affectedItems.length > 0 && (
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              Affected {entityNamePlural} (showing up to 5):
            </Text>
            <List
              size="small"
              bordered
              dataSource={usageInfo.affectedItems.slice(0, 5)}
              renderItem={(item) => (
                <List.Item style={{ padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileTextOutlined style={{ color: colors.textMuted }} />
                    <Text strong>{item.number}</Text>
                    {item.customerName && (
                      <Text type="secondary">- {item.customerName}</Text>
                    )}
                  </div>
                </List.Item>
              )}
              style={{ maxHeight: 200, overflow: 'auto' }}
            />
            {usageInfo.affectedItems.length > 5 && (
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                ...and {usageInfo.affectedItems.length - 5} more
              </Text>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default StatusMigrationModal;
