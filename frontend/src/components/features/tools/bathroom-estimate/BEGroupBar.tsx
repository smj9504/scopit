/**
 * The estimates of one bathroom job, side by side above the estimate: an
 * insurance job's restoration and its upgrade options, or a remodel's
 * options. Picking one opens it; the bar also adds an option (a copy of
 * the estimate on screen), renames or deletes the open option, and switches
 * the job between insurance and remodel.
 */

import React, { useState } from 'react';
import { Button, Dropdown, Input, Modal, Segmented, Space, Tag, Tooltip, message } from 'antd';
import {
  DeleteOutlined,
  DiffOutlined,
  DownOutlined,
  EditOutlined,
  HomeOutlined,
  MoreOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bathroomEstimateService } from '@/services/bathroomEstimateService';
import type { BathroomEstimate, BathroomGroupMember, BathroomProjectType } from '@/types/bathroomEstimate';
import { memberName } from '@/types/bathroomEstimate';

export const PROJECT_TYPE_LABELS: Record<BathroomProjectType, string> = {
  insurance: 'Insurance claim',
  remodel: 'Remodel',
};

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const signedMoney = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;

interface BEGroupBarProps {
  estimate: BathroomEstimate;
  /**
   * Open another estimate of the job. The page checks for unsaved changes
   * first, unless `discard` says they no longer matter.
   */
  onOpen: (id: string, options?: { discard?: boolean }) => void;
  /** Run `action` once the page's unsaved changes are saved or discarded. */
  guardUnsaved: (action: () => void) => void;
  onCompare: () => void;
}

const BEGroupBar: React.FC<BEGroupBarProps> = ({ estimate, onOpen, guardUnsaved, onCompare }) => {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<string | null>(null);

  const projectType: BathroomProjectType = estimate.project_type || 'insurance';
  const insurance = projectType === 'insurance';
  // A remodel's current layout reads first, as the restoration does on an insurance job
  const byCurrentFirst = (a: BathroomGroupMember, b: BathroomGroupMember) =>
    Number(b.kind === 'existing') - Number(a.kind === 'existing');
  const members: BathroomGroupMember[] = estimate.group_members?.length
    ? estimate.group_members.slice().sort(byCurrentFirst)
    : [{
      id: estimate.id,
      kind: estimate.kind || 'restore',
      option_label: estimate.option_label,
      option_order: 0,
      status: estimate.status,
      total: estimate.total || 0,
    }];
  const restoration = members.find((m) => m.kind === 'restore');
  const hasCurrentLayout = members.some((m) => m.kind === 'existing');
  const isOption = estimate.kind === 'option';
  const isCurrentLayout = estimate.kind === 'existing';

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bathroom-estimate'] });
    queryClient.invalidateQueries({ queryKey: ['bathroom-estimates'] });
    queryClient.invalidateQueries({ queryKey: ['bathroom-estimate-group'] });
  };

  const addOption = useMutation({
    mutationFn: () => bathroomEstimateService.addOption(estimate.id),
    onSuccess: (created) => {
      message.success(`${memberName(created)} added — a copy of ${memberName(estimate)}`);
      refresh();
      onOpen(created.id);
    },
    onError: () => message.error('Could not add an option'),
  });

  const addCurrentLayout = useMutation({
    mutationFn: () => bathroomEstimateService.addCurrentLayout(estimate.id),
    onSuccess: (created) => {
      message.success('Current layout added — draw the bathroom as it is today in the Sketch tab');
      refresh();
      onOpen(created.id);
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Could not add the current layout'),
  });

  const rename = useMutation({
    mutationFn: (label: string) => bathroomEstimateService.renameOption(estimate.id, label),
    onSuccess: () => {
      setRenaming(null);
      refresh();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Rename failed'),
  });

  const remove = useMutation({
    mutationFn: () => bathroomEstimateService.delete(estimate.id),
    onSuccess: () => {
      message.success(`${memberName(estimate)} deleted`);
      refresh();
      const next = restoration || members.find((m) => m.id !== estimate.id);
      // Whatever was unsaved belonged to the estimate just deleted
      if (next) onOpen(next.id, { discard: true });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Delete failed'),
  });

  const switchType = useMutation({
    mutationFn: (to: BathroomProjectType) => bathroomEstimateService.setProjectType(estimate.id, to),
    onSuccess: (_, to) => {
      message.success(`This job is now a ${PROJECT_TYPE_LABELS[to].toLowerCase()}`);
      refresh();
    },
    onError: () => message.error('Could not change the job type'),
  });

  const confirmTypeChange = (to: BathroomProjectType) => {
    if (to === projectType) return;
    Modal.confirm({
      title: `Make this job a ${PROJECT_TYPE_LABELS[to].toLowerCase()}?`,
      content: to === 'remodel'
        ? 'The restoration becomes an option like the others, and the job no longer has an estimate for the insurance company.'
        : `${memberName(estimate)} becomes the restoration — the estimate the insurance company gets. Any other options stay upgrade options.`,
      okText: 'Change',
      onOk: () => switchType.mutateAsync(to),
    });
  };

  const confirmDelete = () => {
    Modal.confirm({
      title: `Delete ${memberName(estimate)}?`,
      content: 'Its scope, sketch and line items are deleted. The other estimates of this job stay as they are.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => remove.mutateAsync(),
    });
  };

  const segments = members.map((m) => {
    const overRestoration = insurance && restoration && m.kind === 'option' && m.total && restoration.total
      ? signedMoney(m.total - restoration.total)
      : null;
    return {
      value: m.id,
      label: (
        <div style={{ padding: '2px 4px', lineHeight: 1.3, textAlign: 'left' }}>
          <div style={{ fontWeight: 600 }}>{memberName(m)}</div>
          <div style={{ fontSize: 12, opacity: 0.65, whiteSpace: 'nowrap' }}>
            {m.kind === 'existing' ? 'Not priced' : m.total ? money(m.total) : 'Not calculated'}
            {overRestoration && ` · ${overRestoration}`}
          </div>
        </div>
      ),
    };
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12,
    }}>
      <Dropdown
        trigger={['click']}
        menu={{
          selectable: true,
          selectedKeys: [projectType],
          items: (Object.keys(PROJECT_TYPE_LABELS) as BathroomProjectType[]).map((t) => ({
            key: t,
            label: PROJECT_TYPE_LABELS[t],
          })),
          onClick: ({ key }) => confirmTypeChange(key as BathroomProjectType),
        }}
      >
        <Tag
          color={insurance ? 'blue' : 'green'}
          style={{ cursor: 'pointer', margin: 0, padding: '2px 8px' }}
        >
          {PROJECT_TYPE_LABELS[projectType]} <DownOutlined style={{ fontSize: 10 }} />
        </Tag>
      </Dropdown>

      <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Segmented
          value={estimate.id}
          options={segments}
          onChange={(id) => { if (id !== estimate.id) onOpen(id as string); }}
        />
      </div>

      <Space size={4} wrap>
        <Tooltip title={`New option, starting as a copy of ${memberName(estimate)}`}>
          <Button
            icon={<PlusOutlined />}
            loading={addOption.isPending}
            onClick={() => guardUnsaved(() => addOption.mutate())}
          >
            {insurance ? 'Upgrade option' : 'Option'}
          </Button>
        </Tooltip>
        {!insurance && !hasCurrentLayout && (
          <Tooltip title="Draw the bathroom as it is today. It isn't priced; options price their moved plumbing and walls against it.">
            <Button
              icon={<HomeOutlined />}
              loading={addCurrentLayout.isPending}
              onClick={() => guardUnsaved(() => addCurrentLayout.mutate())}
            >
              Current layout
            </Button>
          </Tooltip>
        )}
        {members.filter((m) => m.kind !== 'existing').length > 1 && (
          <Button icon={<DiffOutlined />} onClick={onCompare}>
            Compare
          </Button>
        )}
        {(isOption || isCurrentLayout) && (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                ...(isOption ? [{ key: 'rename', icon: <EditOutlined />, label: 'Rename option' }] : []),
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: isCurrentLayout ? 'Delete current layout' : 'Delete option',
                  danger: true,
                  // A remodel's last option is the job; it goes from the list
                  disabled: members.length < 2,
                },
              ],
              onClick: ({ key }) => {
                if (key === 'rename') setRenaming(estimate.option_label || '');
                if (key === 'delete') confirmDelete();
              },
            }}
          >
            <Button icon={<MoreOutlined />} aria-label={isCurrentLayout ? 'Current layout actions' : 'Option actions'} />
          </Dropdown>
        )}
      </Space>

      <Modal
        title="Rename option"
        open={renaming !== null}
        onCancel={() => setRenaming(null)}
        onOk={() => renaming?.trim() && rename.mutate(renaming.trim())}
        okButtonProps={{ disabled: !renaming?.trim(), loading: rename.isPending }}
        okText="Rename"
        destroyOnHidden
      >
        <Input
          autoFocus
          value={renaming ?? ''}
          maxLength={100}
          placeholder="e.g. Marble & floating vanity"
          onChange={(e) => setRenaming(e.target.value)}
          onPressEnter={() => renaming?.trim() && rename.mutate(renaming.trim())}
        />
      </Modal>
    </div>
  );
};

export default BEGroupBar;
