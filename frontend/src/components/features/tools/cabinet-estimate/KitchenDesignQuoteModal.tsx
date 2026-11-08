/**
 * Exporting the design quote, the other format of a kitchen estimate's PDF:
 * whether it carries the kitchen's drawings and a signature block. The
 * drawings are made here in the browser from what is saved, and sent with the
 * request.
 */

import React, { useEffect, useState } from 'react';
import { Checkbox, Modal, Radio, Space, Typography, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { cabinetEstimateService } from '@/services/cabinetEstimateService';
import { cabinetSketchService } from '@/services/cabinetSketchService';
import { hasDrawing } from '@/components/features/tools/cabinet-estimate/sketch/kitchenDrawingModel';

const { Text } = Typography;

interface KitchenDesignQuoteModalProps {
  /** The estimate to export; closed while there is none. */
  estimateId: string | null;
  onClose: () => void;
}

const KitchenDesignQuoteModal: React.FC<KitchenDesignQuoteModalProps> = ({ estimateId, onClose }) => {
  const [plan, setPlan] = useState(true);
  const [elevations, setElevations] = useState(false);
  const [views3d, setViews3d] = useState(true);
  const [realistic, setRealistic] = useState(true);
  const [signature, setSignature] = useState(true);
  // What it is doing while exporting, on the button.
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!estimateId) return;
    setPlan(true);
    setElevations(false);
    setViews3d(true);
    setRealistic(true);
    setSignature(true);
  }, [estimateId]);

  // Its own key and no cache: the Sketch tab must never open on a copy from here.
  const { data: sketch, isLoading } = useQuery({
    queryKey: ['design-quote-sketch', estimateId],
    queryFn: () => cabinetSketchService.getSketch(estimateId!),
    enabled: !!estimateId,
    gcTime: 0,
  });
  const drawable = hasDrawing(sketch?.overlay_data);
  const withPlan = drawable && plan;
  const withElevations = drawable && elevations;
  const with3d = drawable && views3d;

  const exportQuote = async () => {
    const id = estimateId!;
    try {
      let drawings;
      let missed: string[] = [];
      if (withPlan || withElevations || with3d) {
        setBusy('Drawing the kitchen…');
        // Let the button show that before the drawing holds the page up.
        await new Promise((done) => window.setTimeout(done, 50));
        const [estimate, saved] = await Promise.all([cabinetEstimateService.getById(id), cabinetSketchService.getSketch(id)]);
        const { drawKitchen } = await import('@/components/features/tools/cabinet-estimate/sketch/kitchenDrawings');
        ({ drawings, missed } = await drawKitchen(saved, estimate, {
          plan: withPlan,
          elevations: withElevations,
          views3d: with3d,
          realistic,
        }));
      }
      setBusy('Making the PDF…');
      await cabinetEstimateService.exportDesignQuotePdf(id, { show_signature: signature, drawings });
      if (missed.length > 0) {
        message.warning(`The ${missed.join(' and ')} could not be drawn in this browser, so the PDF went without them`);
      }
      onClose();
    } catch {
      message.error('The PDF could not be made');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title="Design quote"
      open={!!estimateId}
      onCancel={onClose}
      onOk={exportQuote}
      okText={busy ?? 'Export PDF'}
      okButtonProps={{ loading: !!busy, disabled: isLoading }}
      cancelButtonProps={{ disabled: !!busy }}
      closable={!busy}
      maskClosable={!busy}
      destroyOnClose
    >
      <Text type="secondary">
        Each section of the work with its price and what’s in it, without unit prices, for the customer to read. The
        itemized quote stays the one for the carrier.
      </Text>
      <Space direction="vertical" size={8} style={{ display: 'flex', marginTop: 16 }}>
        <Checkbox checked={withPlan} disabled={!drawable || !!busy} onChange={(e) => setPlan(e.target.checked)}>
          Floor plan
        </Checkbox>
        <Checkbox checked={withElevations} disabled={!drawable || !!busy} onChange={(e) => setElevations(e.target.checked)}>
          Front elevations
        </Checkbox>
        <Checkbox checked={with3d} disabled={!drawable || !!busy} onChange={(e) => setViews3d(e.target.checked)}>
          3D views
        </Checkbox>
        {with3d && (
          <Radio.Group
            size="small"
            style={{ marginLeft: 24 }}
            value={realistic ? 'realistic' : 'drawing'}
            disabled={!!busy}
            onChange={(e) => setRealistic(e.target.value === 'realistic')}
            options={[
              { label: 'Realistic, in the kitchen’s finishes', value: 'realistic' },
              { label: 'Outlined drawing', value: 'drawing' },
            ]}
          />
        )}
        {!isLoading && !drawable && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Nothing is drawn for this estimate yet. Lay it out on its Sketch tab to add drawings.
          </Text>
        )}
        <Checkbox checked={signature} disabled={!!busy} onChange={(e) => setSignature(e.target.checked)}>
          Signature block
        </Checkbox>
      </Space>
    </Modal>
  );
};

export default KitchenDesignQuoteModal;
