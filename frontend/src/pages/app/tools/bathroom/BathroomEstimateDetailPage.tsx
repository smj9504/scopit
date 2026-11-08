import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Divider,
  Form,
  Input,
  InputNumber,
  message,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  Modal,
  Dropdown,
  Popconfirm,
} from 'antd';
import {
  CalculatorOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  FilePdfOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  RobotOutlined,
  EditOutlined,
  BookOutlined,
  AimOutlined,
  AuditOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { bathroomEstimateService } from '@/services/bathroomEstimateService';
import { useBackNav } from '@/hooks/useHeaderNav';
import {
  AddressField,
  CustomerField,
} from '@/components/features/tools/cabinet-estimate/jobFields';
import { useSheetModal } from '@/components/features/tools/bathroom-estimate/useSheetModal';
import { BATHROOM_TOOL_PATH, bathroomEstimatePath } from '@/components/features/tools/bathroom-estimate/paths';
import type {
  BathroomEstimate,
  BathroomEstimateUpdate,
  BathroomEstimateLineItem,
  BathroomEstimateHistory,
  BathroomPricingInfo,
} from '@/types/bathroomEstimate';
import { PHASE_LABELS, isCustomTileShower, memberName } from '@/types/bathroomEstimate';
import BESketchTab, { buildSketchSync } from '@/components/features/tools/bathroom-estimate/sketch/BESketchTab';
import type { SketchFixtureSync } from '@/components/features/tools/bathroom-estimate/sketch/BESketchTab';
import { fitFixturesToProducts } from '@/components/features/tools/bathroom-estimate/sketch/utils/productFit';
import BESelectionsPanel from '@/components/features/tools/bathroom-estimate/BESelectionsPanel';
import BEGroupBar from '@/components/features/tools/bathroom-estimate/BEGroupBar';
import BEGroupCompareDrawer from '@/components/features/tools/bathroom-estimate/BEGroupCompareDrawer';
import BELayoutChanges from '@/components/features/tools/bathroom-estimate/BELayoutChanges';
import BEFixtureRows from '@/components/features/tools/bathroom-estimate/BEFixtureRows';
import BEMirrorRows from '@/components/features/tools/bathroom-estimate/BEMirrorRows';
import { mergeMirrorsFromSketch } from '@/components/features/tools/bathroom-estimate/mirrorRows';
import { CABINET_KINDS, LIGHT_KINDS, mergeFromSketch, withLightRows } from '@/components/features/tools/bathroom-estimate/fixtureRows';
import { exportProposalWith3D, optionRender } from '@/components/features/tools/bathroom-estimate/bathroomPdf';
import PriceBookNotice from '@/components/features/tools/unit-prices/PriceBookNotice';
// The shared tokens and ui-* pieces the ported tools draw with, then the bathroom's own
import '@/components/features/tools/cabinet-estimate/cabinetEstimate.css';
import '@/components/features/tools/bathroom-estimate/bathroomEstimate.css';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Panel } = Collapse;
const round2 = (n: number) => Math.round(n * 100) / 100;

const formatLabel = (s: string) => s?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '';

// ── Cost Guide rate fallbacks ──
// The guide quotes live rates from GET /tools/bathroom-estimate/pricing-info so they
// cannot drift from what the backend charges. These copies only cover the
// window before that query resolves.
const FALLBACK_PLUMBING_RATES: Record<string, number> = {
  shutoff_valve_each: 204, supply_line_each: 72, drain_modification: 386,
  pressure_balance_valve: 466, rough_inspection_fee: 163,
};
const FALLBACK_ELECTRICAL_RATES: Record<string, number | Record<string, number>> = {
  gfci_outlet_each: 181, vanity_light_install: 227, ceiling_fixture_install: 236,
  exhaust_fan: { 50: 357, 80: 466, 110: 599, 150: 756 },
  exhaust_fan_switch: { standard: 39, timer: 83, humidity: 138 },
  heated_floor_per_sf: 13.25, heated_floor_thermostat: 211,
  heated_floor_circuit: 421, electrical_inspection_fee: 137,
};

const BathroomEstimateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  useBackNav('Bathroom Estimator', BATHROOM_TOOL_PATH);
  // Opening another estimate of the job keeps the tab you were on
  const [activeTab, setActiveTab] = useState<string>(
    (location.state as { tab?: string } | null)?.tab || 'project'
  );
  const [compareOpen, setCompareOpen] = useState(false);
  // An option's product slot being stored and repriced
  const [selectionBusy, setSelectionBusy] = useState<string | null>(null);
  // Bumped when a picked product resized the plan here, so the sketch loads it
  const [sketchReload, setSketchReload] = useState(0);
  // Edits made on this page since the last save or calculate: typed into the
  // form or drawn on the sketch. Fields the page fills in itself don't count.
  const unsavedRef = useRef(false);
  const { isPhone, sheetProps } = useSheetModal();

  // Phones keep the tab bar stuck under the app header. A tab opens at its
  // top rather than wherever the last one was scrolled to, and the sketch
  // also scrolls up so its canvas fills the screen.
  useEffect(() => {
    if (!isPhone) return;
    const nav = document.querySelector('.be-tabs > .ant-tabs-nav');
    const content = document.querySelector('.be-tabs > .ant-tabs-content-holder');
    if (!nav || !content) return;
    if (activeTab === 'sketch' || content.getBoundingClientRect().top < nav.getBoundingClientRect().bottom) {
      content.scrollIntoView({ block: 'start' });
    }
  }, [activeTab, isPhone]);

  // The changes an option's layout makes that are left out of its price
  const layoutSkips: string[] = Form.useWatch(['plumbing_spec', 'layout_change_skips'], { form, preserve: true }) ?? [];

  // ── Queries ──
  const { data: estimate, isLoading } = useQuery({
    queryKey: ['bathroom-estimate', id],
    queryFn: () => bathroomEstimateService.getById(id!),
    enabled: !!id,
  });

  // A remodel's current layout: the bathroom as it is, drawn but not priced
  const isCurrentLayout = estimate?.kind === 'existing';
  // What an option's layout is compared with: the restoration, or a remodel's current layout
  const baselineId = estimate?.kind === 'option'
    ? (estimate.group_members?.find((m) => m.kind === 'restore')
      ?? estimate.group_members?.find((m) => m.kind === 'existing'))?.id
    : undefined;
  const { data: baseline } = useQuery({
    queryKey: ['bathroom-estimate', baselineId],
    queryFn: () => bathroomEstimateService.getById(baselineId!),
    enabled: !!baselineId,
  });

  // The rates this estimate is priced with (its price book, or the company's today)
  const { data: pricingInfo } = useQuery({
    queryKey: ['bathroom-pricing-info', id],
    queryFn: () => bathroomEstimateService.getPricingInfo(id),
  });

  // Cost Guide rows and scenario totals, computed from the live rate tables.
  const costGuide = useMemo(() => {
    const p = pricingInfo?.plumbing_rates ?? FALLBACK_PLUMBING_RATES;
    const eRates = pricingInfo?.electrical_rates ?? FALLBACK_ELECTRICAL_RATES;
    const e = (key: string): number => {
      const v = eRates[key];
      return typeof v === 'number' ? v : 0;
    };
    const eTable = (key: string): Record<string, number> => {
      const v = eRates[key];
      return typeof v === 'object' && v !== null ? v : {};
    };
    const fan = Object.values(eTable('exhaust_fan'));
    const fan80 = eTable('exhaust_fan')['80'] ?? 0;
    const sw = Object.values(eTable('exhaust_fan_switch'));
    const heatedFloorBase = e('heated_floor_thermostat') + e('heated_floor_circuit');
    const range = (vals: number[]) =>
      vals.length ? `$${Math.min(...vals)}-${Math.max(...vals)}` : '—';

    // Each scenario adds to the one above it, matching the wording of its row.
    const basic =
      p.shutoff_valve_each * 3 + p.supply_line_each * 3 + e('gfci_outlet_each') + fan80;
    const standard = basic + p.pressure_balance_valve + e('vanity_light_install');
    const full =
      standard + e('gfci_outlet_each') + e('heated_floor_per_sf') * 50 + heatedFloorBase +
      p.rough_inspection_fee + e('electrical_inspection_fee');
    const approx = (n: number) => `~$${(Math.round(n / 10) * 10).toLocaleString('en-US')}`;

    return {
      plumbing: [
        { key: '1', item: 'Shutoff Valve', when: '15yr+ homes nearly always. Toilet×1 + Vanity×2 = 3', cost: `$${p.shutoff_valve_each}/EA` },
        { key: '2', item: 'Supply Line', when: 'Replace with valve. Same count as valves', cost: `$${p.supply_line_each}/EA` },
        { key: '3', item: 'Drain Modification', when: 'Tub→Shower conversion, vanity relocation', cost: `$${p.drain_modification}/EA` },
        { key: '4', item: 'Pressure Balance Valve', when: 'All shower remodels (code required)', cost: `$${p.pressure_balance_valve}/EA` },
        { key: '5', item: 'Rough Inspection', when: 'Any plumbing work (county inspection)', cost: `$${p.rough_inspection_fee}/EA` },
      ],
      electrical: [
        { key: '1', item: 'GFCI Outlet', when: 'Min 1 per bath (code). Dual sink = 2', cost: `$${e('gfci_outlet_each')}/EA` },
        { key: '2', item: 'Vanity Light', when: 'Vanity replacement typically includes lighting', cost: `$${e('vanity_light_install')}/EA` },
        { key: '3', item: 'Ceiling Fixture', when: 'Existing light replacement or addition', cost: `$${e('ceiling_fixture_install')}/EA` },
        { key: '4', item: 'Exhaust Fan', when: 'No window = code required. Recommend 80CFM', cost: range(fan) },
        { key: '5', item: 'Fan Switch', when: 'Upgrade: standard / timer / humidity sensor', cost: range(sw) },
        { key: '6', item: 'Heated Floor', when: 'Optional (client request)', cost: `$${e('heated_floor_per_sf')}/SF+$${heatedFloorBase}` },
        { key: '7', item: 'Elec. Inspection', when: 'Any electrical work (county inspection)', cost: `$${e('electrical_inspection_fee')}/EA` },
      ],
      scenarios: { basic: approx(basic), standard: approx(standard), full: approx(full) },
    };
  }, [pricingInfo]);

  const { data: history } = useQuery({
    queryKey: ['bathroom-estimate-history', id],
    queryFn: () => bathroomEstimateService.getHistory(id!),
    enabled: !!id && activeTab === 'history',
  });

  const [guideOpen, setGuideOpen] = useState(false);

  // ── Mutations ──
  const saveMutation = useMutation({
    mutationFn: (payload: BathroomEstimateUpdate) =>
      bathroomEstimateService.update(id!, payload),
    onSuccess: () => {
      unsavedRef.current = false;
      message.success('Saved');
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimate', id] });
      queryClient.invalidateQueries({ queryKey: ['bathroom-layout-changes', id] });
    },
    onError: () => message.error('Save failed'),
  });

  const calculateMutation = useMutation({
    mutationFn: (payload: BathroomEstimateUpdate) =>
      bathroomEstimateService.calculate(id!, payload),
    onSuccess: () => {
      unsavedRef.current = false;
      message.success('Calculated successfully');
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimate', id] });
      // Job facts are shared, so the job's other estimates may have changed
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimate-group'] });
      queryClient.invalidateQueries({ queryKey: ['bathroom-layout-changes', id] });
      setActiveTab('result');
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Calculation failed'),
  });

  const overviewMutation = useMutation({
    mutationFn: () => bathroomEstimateService.generateOverview(id!),
    onSuccess: (data) => {
      form.setFieldsValue({ overview_text: data.overview_text });
      message.success('Overview generated');
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimate', id] });
    },
    onError: () => message.error('Overview generation failed'),
  });

  const cloneMutation = useMutation({
    mutationFn: () => bathroomEstimateService.clone(id!),
    onSuccess: (result) => {
      message.success('Cloned');
      navigate(bathroomEstimatePath(result.id));
    },
  });

  // ── Form sync ──
  useEffect(() => {
    if (estimate) {
      // Preset default accessories only if spec is completely empty (never saved)
      const acc = estimate.accessories_spec;
      if (!acc || (acc.towel_bars == null && acc.tp_holders == null && acc.hand_towel_rings == null && acc.finish == null)) {
        estimate.accessories_spec = {
          ...acc,
          towel_bars: 1,
          tp_holders: 1,
          hand_towel_rings: 1,
          robe_hooks: 1,
          finish: 'chrome',
          grade: 'mid',
        };
      }
      // Ensure auto-include flags have explicit boolean values
      // so unchecking properly sends false (not undefined) to backend.
      // Fixture auto-includes (GFCI, fan, vanity light) default OFF — user opts in.
      // Finish/substrate auto-includes default ON — commonly needed.
      // Ensure JSONB spec fields are objects (not null) for Ant Design nested form paths
      estimate.floor_spec = estimate.floor_spec || {};
      estimate.walls_spec = estimate.walls_spec || {};
      estimate.shower_spec = estimate.shower_spec || {};
      estimate.bathtub_spec = estimate.bathtub_spec || {};
      // Default curtain_rod to true for bathtub replacements (opt-out)
      if (estimate.replace_tub) {
        estimate.bathtub_spec = {
          ...estimate.bathtub_spec,
          curtain_rod: estimate.bathtub_spec.curtain_rod ?? true,
        };
      }
      estimate.vanity_spec = estimate.vanity_spec || {};
      estimate.toilet_spec = estimate.toilet_spec || {};
      estimate.accessories_spec = estimate.accessories_spec || {};
      estimate.plumbing_spec = estimate.plumbing_spec || {};
      estimate.electrical_spec = {
        ...(estimate.electrical_spec || {}),
        megohmmeter_check: (estimate.electrical_spec || {}).megohmmeter_check ?? false,
      };
      estimate.substrate_spec = estimate.substrate_spec || {};
      estimate.walls_spec = {
        ...(estimate.walls_spec || {}),
        paint_ceiling: (estimate.walls_spec || {}).paint_ceiling ?? true,
      };
      // One vanity light and one ceiling light, saved before lights went by kind: as rows
      Object.assign(estimate, withLightRows(estimate));

      const hc = estimate.hidden_costs || {};
      estimate.hidden_costs = {
        ...hc,
        // Auto-include items
        drywall_skim_coat: hc.drywall_skim_coat ?? true,
        subfloor_allowance: hc.subfloor_allowance ?? false,
        auto_gfci: hc.auto_gfci ?? false,
        auto_exhaust_fan: hc.auto_exhaust_fan ?? false,
        auto_tub_valve: hc.auto_tub_valve ?? true,
        auto_shower_valve: hc.auto_shower_valve ?? true,
        exclude_trim_kit: hc.exclude_trim_kit ?? false,
        auto_ceiling_paint: hc.auto_ceiling_paint ?? true,
        mold_resistant_drywall: hc.mold_resistant_drywall ?? true,
      };
      form.setFieldsValue(estimate);
    }
  }, [estimate, form]);

  const handleSave = useCallback(() => {
    const values = form.getFieldsValue(true);
    saveMutation.mutate(values);
  }, [form, saveMutation]);

  const handleCalculate = useCallback(() => {
    const values = form.getFieldsValue(true);
    calculateMutation.mutate(values);
  }, [form, calculateMutation]);

  // ── PDFs ──
  // The plan as drawn, and on an option its 3D view too (drawn here, which takes a moment)
  const exportEstimatePdf = useCallback(async (opts: { show_breakdown_prices: boolean; show_signature: boolean }) => {
    const capture = (window as any).__beSketchCapture;
    const sketchImage = typeof capture === 'function' ? capture() : undefined;
    const done = estimate?.kind === 'option' ? message.loading('Drawing the 3D view for the PDF…', 0) : undefined;
    try {
      await bathroomEstimateService.exportPdf(id!, {
        ...opts,
        sketch_image: sketchImage,
        render_image: await optionRender(estimate),
        address: estimate?.property_address,
      });
    } finally {
      done?.();
    }
  }, [estimate, id]);

  const exportProposal = useCallback(async () => {
    const done = message.loading('Drawing each estimate in 3D for the proposal…', 0);
    try {
      await exportProposalWith3D(id!, estimate?.property_address);
    } catch {
      message.error('Could not make the proposal PDF');
    } finally {
      done();
    }
  }, [estimate, id]);

  // ── The job's other estimates ──
  // Run `action` once this estimate's unsaved edits are saved or let go.
  const guardUnsaved = useCallback((action: () => void) => {
    if (!unsavedRef.current) {
      action();
      return;
    }
    const modal = Modal.confirm({
      title: 'Save your changes first?',
      content: `${estimate ? memberName(estimate) : 'This estimate'} has changes that aren't saved yet.`,
      okText: 'Save',
      cancelText: 'Stay here',
      footer: (_, { OkBtn, CancelBtn }) => (
        <>
          <CancelBtn />
          <Button
            danger
            onClick={() => {
              unsavedRef.current = false;
              modal.destroy();
              action();
            }}
          >
            Discard changes
          </Button>
          <OkBtn />
        </>
      ),
      onOk: async () => {
        await saveMutation.mutateAsync(form.getFieldsValue(true));
        action();
      },
    });
  }, [estimate, form, saveMutation]);
  const openMember = useCallback((memberId: string, options?: { discard?: boolean }) => {
    const go = () => navigate(bathroomEstimatePath(memberId), { state: { tab: activeTab } });
    if (options?.discard) {
      unsavedRef.current = false;
      go();
    } else {
      guardUnsaved(go);
    }
  }, [activeTab, guardUnsaved, navigate]);

  // The calculated line items into a Scopit estimate: a new one, or the one sent to before
  const sendMutation = useMutation({
    mutationFn: (updateExisting: boolean) => bathroomEstimateService.sendToEstimate(id!, updateExisting),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimate', id] });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      // The message renders outside the router, so the link navigates by hand
      const key = `sent-${result.estimate_id}`;
      message.success({
        key,
        content: (
          <span>
            {result.updated ? 'Updated' : 'Created'} estimate {result.estimate_number}.{' '}
            <a
              href={`/app/estimates/${result.estimate_id}`}
              onClick={(e) => {
                e.preventDefault();
                message.destroy(key);
                guardUnsaved(() => navigate(`/app/estimates/${result.estimate_id}`));
              }}
            >
              Open it
            </a>
          </span>
        ),
        duration: 6,
      });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'The estimate could not be made'),
  });

  // ── Sketch → Form sync ──
  const handleSketchChange = useCallback((sketchData: any) => {
    unsavedRef.current = true;
    form.setFieldValue('sketch_data', sketchData);
  }, [form]);

  const handleFixtureSync = useCallback((sync: SketchFixtureSync) => {
    const current = form.getFieldsValue(true);
    const updates: Record<string, any> = {};

    // Room dimensions
    if (sync.length_ft) updates.length_ft = sync.length_ft;
    if (sync.width_ft) updates.width_ft = sync.width_ft;
    if (sync.floor_sf) updates.floor_sf = sync.floor_sf;
    if (sync.wall_sf) updates.wall_sf = sync.wall_sf;
    if (sync.paint_wall_sf != null) updates.paint_wall_sf = sync.paint_wall_sf;

    // Replace & demo flags
    // When sketch adds/removes a fixture, sync the action flags.
    // A fixture on the sketch gets its usual action only while neither
    // Replace nor D&R is chosen, so the person's choice is never overridden.
    const syncFixtureAction = (
      fixture: string,
      hasFixture?: boolean,
      usualAction: 'replace' | 'detach_reset' = 'replace',
    ) => {
      if (hasFixture === undefined) return;
      if (hasFixture) {
        if (!current[`replace_${fixture}`] && !current[`detach_reset_${fixture}`]) {
          updates[`${usualAction}_${fixture}`] = true;
        }
      } else {
        // Fixture removed from sketch: clear both flags
        updates[`replace_${fixture}`] = false;
        updates[`detach_reset_${fixture}`] = false;
      }
    };
    syncFixtureAction('tub', sync.replace_tub);
    syncFixtureAction('shower', sync.replace_shower);
    syncFixtureAction('vanity', sync.replace_vanity);
    syncFixtureAction('toilet', sync.replace_toilet);
    // A vanity mirror is usually taken down and hung back, not replaced
    syncFixtureAction('mirror', sync.replace_mirror, 'detach_reset');
    if (sync.height_ft) updates.height_ft = sync.height_ft;
    if (sync.demo_walls !== undefined) updates.demo_walls = sync.demo_walls;

    // Water damage repair flags (auto-set from drywall repair zones)
    if (sync.water_damage) updates.water_damage = true;
    if (sync.repair_drywall_walls) {
      updates.repair_drywall_walls = true;
      if (sync.repair_drywall_walls_sf) updates.repair_drywall_walls_sf = sync.repair_drywall_walls_sf;
    }
    if (sync.repair_drywall_ceiling) {
      updates.repair_drywall_ceiling = true;
      if (sync.repair_drywall_ceiling_sf) updates.repair_drywall_ceiling_sf = sync.repair_drywall_ceiling_sf;
    }

    // Insulation flags (auto-set from insulation zones)
    if (sync.demo_insulation_walls) {
      updates.demo_insulation_walls = true;
      if (sync.demo_insulation_walls_sf) updates.demo_insulation_walls_sf = sync.demo_insulation_walls_sf;
    }
    if (sync.demo_insulation_ceiling) {
      updates.demo_insulation_ceiling = true;
      if (sync.demo_insulation_ceiling_sf) updates.demo_insulation_ceiling_sf = sync.demo_insulation_ceiling_sf;
    }
    if (sync.install_insulation_walls) {
      updates.install_insulation_walls = true;
      if (sync.install_insulation_walls_sf) updates.install_insulation_walls_sf = sync.install_insulation_walls_sf;
    }
    if (sync.install_insulation_ceiling) {
      updates.install_insulation_ceiling = true;
      if (sync.install_insulation_ceiling_sf) updates.install_insulation_ceiling_sf = sync.install_insulation_ceiling_sf;
    }

    // Merge specs (keep existing form values, override with sketch values)
    if (sync.bathtub_spec) {
      updates.bathtub_spec = { ...(current.bathtub_spec || {}), ...sync.bathtub_spec };
    }
    if (sync.shower_spec) {
      updates.shower_spec = {
        ...(current.shower_spec || {}),
        ...sync.shower_spec,
        tile_spec: { ...(current.shower_spec?.tile_spec || {}), ...(sync.shower_spec.tile_spec || {}) },
      };
    }
    if (sync.vanity_spec) {
      // Merge vanity items: sketch provides dimensions, keep user's other settings
      const curItems: any[] = current.vanity_spec?.items || [];
      const syncItems: any[] = sync.vanity_spec.items || [];
      const mergedItems = syncItems.map((si: any, i: number) => ({
        ...(curItems[i] || { sinks: 1 }),
        ...si,
      }));
      updates.vanity_spec = { items: mergedItems };
    }

    if (sync.toilet_spec) {
      updates.toilet_spec = { ...(current.toilet_spec || {}), ...sync.toilet_spec };
    }
    if (sync.electrical_spec || sync.sketch_lights) {
      const elec = { ...(current.electrical_spec || {}), ...(sync.electrical_spec || {}) };
      if (sync.sketch_lights) elec.lights = mergeFromSketch(current.electrical_spec?.lights, sync.sketch_lights);
      updates.electrical_spec = elec;
    }
    if (sync.sketch_cabinets) {
      updates.accessories_spec = {
        ...(current.accessories_spec || {}),
        cabinets: mergeFromSketch(current.accessories_spec?.cabinets, sync.sketch_cabinets),
      };
    }
    if (sync.sketch_mirrors) {
      updates.accessories_spec = {
        ...(updates.accessories_spec ?? current.accessories_spec ?? {}),
        mirrors: mergeMirrorsFromSketch(current.accessories_spec?.mirrors, sync.sketch_mirrors),
      };
    }
    if (sync.walls_spec) {
      updates.walls_spec = { ...(current.walls_spec || {}), ...sync.walls_spec };
    }
    if (sync.tile_wall_sf != null) updates.tile_wall_sf = sync.tile_wall_sf;

    if (sync.hidden_costs) {
      updates.hidden_costs = { ...(current.hidden_costs || {}), ...sync.hidden_costs };
    }

    // Auto-calculate substrate_spec from shower/tub dimensions
    const mergedShower = updates.shower_spec || current.shower_spec || {};
    const mergedTub = updates.bathtub_spec || current.bathtub_spec || {};
    const replaceShower = updates.replace_shower ?? current.replace_shower;
    let wetSF = 0;

    // Shower tile walls (site-built tiled showers need backer board)
    const sType = mergedShower.type || '';
    if (replaceShower && isCustomTileShower(sType)) {
      const sw = mergedShower.width_in || 0;
      const sd = mergedShower.depth_in || 0;
      const sh = mergedShower.tile_height_in || 0;
      if (sw && sd && sh) {
        wetSF += (sw + 2 * sd) * sh / 144;
      }
    }

    // Tub surround tile
    if (mergedTub.surround_tile) {
      const tl = mergedTub.tub_length_in || 0;
      const td = mergedTub.tub_depth_in || 30;
      const tsh = mergedTub.surround_height_in || 0;
      if (tl && tsh) {
        wetSF += (tl + 2 * td) * tsh / 144;
      }
    }

    wetSF = Math.round(wetSF * 10) / 10;

    if (wetSF > 0) {
      const curSub = current.substrate_spec || {};
      updates.substrate_spec = {
        ...curSub,
        durock_sf: wetSF,
        waterproof_type: curSub.waterproof_type || 'paint_on',
        waterproof_sf: wetSF,
      };
    }

    form.setFieldsValue(updates);
  }, [form]);

  // ── An option's products ──
  // Store the pick, draw the plan at the product's size, and reprice with the page's values (as Calculate does)
  const changeSelection = useCallback(async (slot: string, productId: string | null, opts?: { includesTop?: boolean }) => {
    setSelectionBusy(slot);
    try {
      const picked = productId
        ? await bathroomEstimateService.setSelection(id!, slot, productId, opts?.includesTop)
        : await bathroomEstimateService.clearSelection(id!, slot);
      const sketch = form.getFieldValue('sketch_data') ?? picked.sketch_data;
      const fitted = sketch ? fitFixturesToProducts(sketch, picked.selections) : sketch;
      if (fitted !== sketch) {
        form.setFieldValue('sketch_data', fitted);
        handleFixtureSync(buildSketchSync(fitted));
      }
      const priced = await bathroomEstimateService.calculate(id!, form.getFieldsValue(true));
      unsavedRef.current = false;
      queryClient.setQueryData(['bathroom-estimate', id], priced);
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimate-group'] });
      queryClient.invalidateQueries({ queryKey: ['bathroom-layout-changes', id] });
      if (fitted !== sketch) setSketchReload((n) => n + 1);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Could not update the product');
    } finally {
      setSelectionBusy(null);
    }
  }, [form, handleFixtureSync, id, queryClient]);

  // ── Line Item mutations (must be before early return) ──
  const [editingItem, setEditingItem] = useState<any>(null);
  const [addingPhase, setAddingPhase] = useState<number | null>(null);

  const lineItemMutation = useMutation({
    mutationFn: async (args: { action: string; itemId?: string; phase?: number; data?: any }) => {
      if (args.action === 'update') return bathroomEstimateService.updateLineItem(id!, args.itemId!, args.data);
      if (args.action === 'delete') return bathroomEstimateService.deleteLineItem(id!, args.itemId!);
      if (args.action === 'add') return bathroomEstimateService.addLineItem(id!, args.data);
      if (args.action === 'deletePhase') return bathroomEstimateService.deletePhase(id!, args.phase!);
      throw new Error('Unknown action');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimate', id] });
      setEditingItem(null);
      setAddingPhase(null);
    },
    onError: () => message.error('Operation failed'),
  });

  const selectOpts = (items: string[] | undefined) =>
    (items || []).map(v => ({ label: formatLabel(v), value: v }));

  const numOpts = (items: number[] | undefined) =>
    (items || []).map(v => ({ label: `${v}`, value: v }));

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  // ── Line items table columns (per-phase, editable) ──
  const lineItemColumns = [
    { title: 'Description', dataIndex: 'description', key: 'description' },
    { title: 'Qty', dataIndex: 'quantity', key: 'qty', width: 70, align: 'right' as const,
      render: (v: number) => v?.toFixed(1) },
    { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 50 },
    { title: 'Rate', dataIndex: 'unit_price', key: 'rate', width: 90, align: 'right' as const,
      render: (v: number) => `$${v?.toFixed(2)}` },
    { title: 'Total', dataIndex: 'total', key: 'total', width: 100, align: 'right' as const,
      render: (v: number) => `$${v?.toLocaleString('en-US', { minimumFractionDigits: 2 })}` },
    { title: '', key: 'actions', width: 70, render: (_: any, record: any) => (
      <Space size={4}>
        <Button type="text" size="small" icon={<EditOutlined />}
          onClick={(e) => { e.stopPropagation(); setEditingItem({ ...record }); }} />
        <Popconfirm title="Delete this item?" onConfirm={() => lineItemMutation.mutate({ action: 'delete', itemId: record.id })}
          okButtonProps={{ loading: lineItemMutation.isPending }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )},
  ];

  // A phone has no room for the Cost Guide's "When Needed" column, so the
  // condition sits under the item's name
  const guidePhoneColumns = [
    {
      title: 'Item',
      dataIndex: 'item',
      render: (item: string, row: { when: string }) => (
        <>
          <div>{item}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.when}</Text>
        </>
      ),
    },
    { title: 'Cost', dataIndex: 'cost', align: 'right' as const },
  ];

  // Group line items by phase for summary
  const lineItems = estimate?.line_items || [];
  const phaseSummary = Object.entries(PHASE_LABELS).map(([phase, label]) => {
    const items = lineItems.filter(li => li.phase === Number(phase));
    const total = items.reduce((s, li) => s + li.total, 0);
    return { phase: Number(phase), label, total, count: items.length };
  }).filter(p => p.count > 0);

  // ── PDF menu ──
  // Each estimate PDF asks the backend which brands and models are still
  // missing first, and lets the export go ahead anyway.
  const pdfItem = (key: string, label: string, opts: { show_breakdown_prices: boolean; show_signature: boolean }) => ({
    key,
    label,
    icon: <FilePdfOutlined />,
    onClick: async () => {
      const doExport = () => exportEstimatePdf(opts);
      try {
        const result = await bathroomEstimateService.validateForExport(id!);
        if (result.warnings.length > 0) {
          Modal.confirm({
            title: 'Material allowance warnings',
            content: (
              <ul style={{ paddingLeft: 16, margin: '8px 0' }}>
                {result.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
              </ul>
            ),
            okText: 'Export anyway',
            cancelText: 'Cancel',
            onOk: doExport,
          });
        } else {
          doExport();
        }
      } catch { doExport(); }
    },
  });
  const pdfItems = [
    pdfItem('pdf-detailed', 'PDF - Detailed (with signature)', { show_breakdown_prices: true, show_signature: true }),
    pdfItem('pdf-detailed-nosig', 'PDF - Detailed (no signature)', { show_breakdown_prices: true, show_signature: false }),
    { type: 'divider' as const },
    pdfItem('pdf-clean', 'PDF - Clean (with signature)', { show_breakdown_prices: false, show_signature: true }),
    pdfItem('pdf-clean-nosig', 'PDF - Clean (no signature)', { show_breakdown_prices: false, show_signature: false }),
    // The customer's side-by-side of the whole job; never for the carrier
    ...((estimate?.group_members?.length ?? 0) > 1 ? [
      { type: 'divider' as const },
      {
        key: 'pdf-proposal',
        label: 'Customer proposal (all estimates)',
        icon: <FilePdfOutlined />,
        onClick: () => exportProposal(),
      },
    ] : []),
  ];

  // ── To estimate ──
  // Into a Scopit estimate, from what was last calculated. The current
  // layout isn't priced, so it has nothing to send.
  const sentBefore = !!estimate?.scopit_estimate_id;
  const notReadyToSend = !estimate || estimate.status === 'draft' ? 'Calculate first' : null;
  const sendItems = [
    { key: 'send-new', label: 'Create a new estimate', disabled: !!notReadyToSend },
    ...(sentBefore
      ? [
          { key: 'send-update', label: 'Update the estimate sent before', disabled: !!notReadyToSend },
          { type: 'divider' as const },
          { key: 'send-open', label: 'Open the estimate sent before' },
        ]
      : []),
    ...(notReadyToSend ? [{ type: 'divider' as const }, { key: 'send-why', label: notReadyToSend, disabled: true }] : []),
  ];
  const onSend = ({ key }: { key: string }) => {
    if (key === 'send-open' && estimate?.scopit_estimate_id) {
      const target = `/app/estimates/${estimate.scopit_estimate_id}`;
      guardUnsaved(() => navigate(target));
      return;
    }
    if (key !== 'send-new' && key !== 'send-update') return;
    // What goes over is the last calculation, so edits made since must be calculated first
    if (unsavedRef.current) {
      message.warning('Calculate your latest changes first, so the estimate gets them.');
      return;
    }
    sendMutation.mutate(key === 'send-update');
  };

  const statusColor =
    estimate?.status === 'draft' ? 'default'
      : estimate?.status === 'calculated' ? 'processing'
        : estimate?.status === 'approved' ? 'success' : 'purple';

  return (
    <div className="be-page">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isPhone ? 12 : 16, flexWrap: 'wrap', gap: 8 }}>
        <Space wrap align="center">
          <Title level={isPhone ? 5 : 4} style={{ margin: 0 }}>
            {estimate?.property_address || 'Bathroom estimate'}
          </Title>
          {estimate?.status && (
            <Tag bordered={false} color={statusColor} style={{ marginInlineEnd: 0 }}>
              {formatLabel(estimate.status)}
            </Tag>
          )}
        </Space>
        <Space wrap>
            {/* Phones get Save and Calculate in the action bar at the bottom */}
            {!isPhone && (
              <Button icon={<SaveOutlined />} onClick={handleSave} loading={saveMutation.isPending}>
                Save
              </Button>
            )}
            {/* The current layout isn't priced */}
            {!isPhone && !isCurrentLayout && (
              <Button type="primary" icon={<CalculatorOutlined />} onClick={handleCalculate}
                loading={calculateMutation.isPending}>
                Calculate
              </Button>
            )}
            <Dropdown
              trigger={isPhone ? ['click'] : undefined}
              disabled={estimate?.status === 'draft'}
              menu={{ items: pdfItems }}
            >
              <Button icon={<FilePdfOutlined />} aria-label={isPhone ? 'PDF' : undefined}>
                {!isPhone && <>PDF <DownOutlined /></>}
              </Button>
            </Dropdown>
            {!isPhone && !isCurrentLayout && (
              <Dropdown
                trigger={['click']}
                disabled={sendMutation.isPending}
                menu={{ items: sendItems, onClick: onSend }}
              >
                <Button loading={sendMutation.isPending}>
                  To estimate <DownOutlined style={{ fontSize: 12 }} />
                </Button>
              </Dropdown>
            )}
            {!isPhone && (
              <Button
                icon={<CopyOutlined />}
                onClick={() => cloneMutation.mutate()}
                title="Copy this estimate into a new job, e.g. another bathroom"
              >
                Clone
              </Button>
            )}
            {!isPhone && (
              <Button icon={<BookOutlined />} onClick={() => setGuideOpen(true)}>
                Guide
              </Button>
            )}
            {isPhone && (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    ...(!isCurrentLayout ? [{
                      key: 'send',
                      label: 'To estimate',
                      children: sendItems,
                    }] : []),
                    {
                      key: 'clone',
                      icon: <CopyOutlined />,
                      label: 'Clone',
                    },
                    {
                      key: 'guide',
                      icon: <BookOutlined />,
                      label: 'Guide',
                    },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'clone') cloneMutation.mutate();
                    else if (key === 'guide') setGuideOpen(true);
                    else onSend({ key });
                  },
                }}
              >
                <Button icon={<MoreOutlined />} aria-label="More actions" loading={sendMutation.isPending} />
              </Dropdown>
            )}
        </Space>
      </div>

      {estimate && (
        <>
          <BEGroupBar
            estimate={estimate}
            onOpen={openMember}
            guardUnsaved={guardUnsaved}
            onCompare={() => setCompareOpen(true)}
          />
          <BEGroupCompareDrawer
            open={compareOpen}
            onClose={() => setCompareOpen(false)}
            estimate={estimate}
            onOpen={(memberId) => {
              setCompareOpen(false);
              if (memberId !== estimate.id) openMember(memberId);
            }}
          />
          {isCurrentLayout && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="The bathroom as it is today"
              description="Draw the room as it is now in the Sketch tab. It isn't priced; each option prices the plumbing, walls and doors it moves against it."
            />
          )}
        </>
      )}

      <Modal
        title="Plumbing & Electrical Guide"
        open={guideOpen}
        onCancel={() => setGuideOpen(false)}
        footer={null}
        width={720}
        {...sheetProps}
      >
        {/* A phone sheet scrolls its own body */}
        <div style={isPhone ? undefined : { maxHeight: 500, overflowY: 'auto' }}>
          <Title level={5}>Plumbing (Phase 2)</Title>
          <Table
            size="small"
            pagination={false}
            dataSource={costGuide.plumbing}
            columns={isPhone ? guidePhoneColumns : [
              { title: 'Item', dataIndex: 'item', width: 170 },
              { title: 'When Needed', dataIndex: 'when' },
              { title: 'Cost', dataIndex: 'cost', width: 90, align: 'right' as const },
            ]}
          />
          <Divider style={{ margin: '12px 0' }} />
          <Title level={5}>Electrical (Phase 2)</Title>
          <Table
            size="small"
            pagination={false}
            dataSource={costGuide.electrical}
            columns={isPhone ? guidePhoneColumns : [
              { title: 'Item', dataIndex: 'item', width: 140 },
              { title: 'When Needed', dataIndex: 'when' },
              { title: 'Cost', dataIndex: 'cost', width: 100, align: 'right' as const },
            ]}
          />
          <Divider style={{ margin: '12px 0' }} />
          <Title level={5}>Common Scenarios</Title>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <p style={{ margin: '4px 0' }}><Tag color="blue">Basic</Tag> Toilet + Vanity only: Valve×3 + Supply×3 + GFCI + Fan 80CFM = <strong>{costGuide.scenarios.basic}</strong></p>
            <p style={{ margin: '4px 0' }}><Tag color="green">Standard</Tag> + Shower: + Pressure Balance + Vanity Light = <strong>{costGuide.scenarios.standard}</strong></p>
            <p style={{ margin: '4px 0' }}><Tag color="orange">Full</Tag> + Heated Floor 50SF: + GFCI×2 + Heated + Inspections = <strong>{costGuide.scenarios.full}</strong></p>
          </div>
          <Divider style={{ margin: '12px 0' }} />
          <Title level={5}>Auto-Set Rules</Title>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <p style={{ margin: '4px 0' }}>Shower Replace → <Tag>pressure_balance_valve</Tag> <Tag>valve×1</Tag></p>
            <p style={{ margin: '4px 0' }}>Toilet Replace → <Tag>valve×1</Tag> <Tag>supply×1</Tag></p>
            <p style={{ margin: '4px 0' }}>Vanity Replace → <Tag>valve×2</Tag> <Tag>supply×2</Tag></p>
            <p style={{ margin: '4px 0' }}>All Remodels → <Tag color="red">GFCI ≥ 1</Tag> <Tag color="red">exhaust fan</Tag></p>
            <p style={{ margin: '4px 0' }}>Custom Tile Shower → <Tag>rough_inspection</Tag></p>
          </div>
        </div>
      </Modal>

      {/* Phones get thumb-sized fields; the size also reaches the tabs and panels */}
      <Form form={form} layout="vertical" size={isPhone ? 'middle' : 'small'} onValuesChange={() => { unsavedRef.current = true; }}>
        <Tabs className="be-tabs" activeKey={activeTab} onChange={setActiveTab} destroyOnHidden={false}
          tabBarGutter={isPhone ? 20 : undefined} items={[
          // ════════ TAB 1: Project Info ════════
          {
            key: 'project',
            forceRender: true,
            label: 'Project Info',
            children: (
              <Card className="be-tab-card">
                {/* Customer & claim: shared by every estimate of the job */}
                <Divider orientation="left">Customer &amp; Claim</Divider>
                <Row gutter={16}>
                  <Col xs={24} md={14}>
                    <Form.Item
                      name="customer_id"
                      label="Customer"
                      tooltip="Printed on the PDFs, and carried to the estimate when you send it."
                    >
                      <CustomerField
                        initialName={estimate?.client_name}
                        onPick={(customer) => {
                          // Their address, unless the job already has one
                          if (!form.getFieldValue('property_address')) {
                            form.setFieldsValue({
                              property_address: customer.addressLine1 || undefined,
                              city: form.getFieldValue('city') || customer.city,
                              state: form.getFieldValue('state') || customer.state,
                              zip_code: form.getFieldValue('zip_code') || customer.zipcode,
                            });
                          }
                        }}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={10}>
                    <Form.Item name="claim_number" label="Claim # (insurance jobs)">
                      <Input placeholder="e.g. 0123456789" maxLength={100} allowClear />
                    </Form.Item>
                  </Col>
                </Row>
                <Divider orientation="left">Property</Divider>
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item label="Property Address" name="property_address">
                      <AddressField
                        placeholder="Street address"
                        onPick={(addr) => form.setFieldsValue({
                          // The street here; city, state and zip have their own fields
                          property_address: addr.street || addr.address,
                          city: addr.city,
                          state: addr.state,
                          zip_code: addr.zip,
                        })}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="City" name="city"><Input /></Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="State" name="state">
                      {/* The rates are set for MD / VA / DC; any state can be typed */}
                      <AutoComplete
                        maxLength={5}
                        options={['MD', 'VA', 'DC'].map((v) => ({ value: v }))}
                        filterOption={(input, option) => (option?.value ?? '').toUpperCase().startsWith(input.toUpperCase())}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Zip Code" name="zip_code"><Input /></Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Building Type" name="building_type">
                      <Select options={selectOpts(pricingInfo?.building_types)} allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Year Built" name="year_built">
                      <InputNumber style={{ width: '100%' }} min={1800} max={2030} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Bathroom Type" name="designation">
                      <Select options={selectOpts(pricingInfo?.designations)} allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Function" name="bath_function">
                      <Select options={selectOpts(pricingInfo?.bath_functions)} allowClear />
                    </Form.Item>
                  </Col>
                </Row>
                <Divider orientation="left">Dimensions</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Length (ft)" name="length_ft">
                      <InputNumber style={{ width: '100%' }} min={0} step={0.5} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Width (ft)" name="width_ft">
                      <InputNumber style={{ width: '100%' }} min={0} step={0.5} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Height (ft)" name="height_ft">
                      <InputNumber style={{ width: '100%' }} min={7} max={12} step={0.5} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Floor SF" name="floor_sf">
                      <InputNumber style={{ width: '100%' }} min={0} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Wall SF" name="wall_sf">
                      <InputNumber style={{ width: '100%' }} min={0} />
                    </Form.Item>
                  </Col>
                </Row>
                {/* Room breakdown from sketch */}
                <Form.Item noStyle shouldUpdate={(prev, cur) =>
                  prev?.sketch_data !== cur?.sketch_data ||
                  prev?.floor_sf !== cur?.floor_sf ||
                  prev?.wall_sf !== cur?.wall_sf
                }>
                  {({ getFieldValue }) => {
                    const sketchRooms = (getFieldValue('sketch_data') || {}).rooms || [];
                    const allRooms = sketchRooms.filter((r: any) => !r.parentRoomId);
                    if (allRooms.length < 2) return null;
                    const primary = allRooms.find((r: any) => r.roomType === 'bathroom') || allRooms[0];
                    return (
                      <div style={{ background: '#f5f5f5', borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontSize: 12 }}>
                        {allRooms.map((r: any) => {
                          const name = (r.name || r.roomType || 'Room').replace(/_/g, ' ');
                          const fl = Math.round((r.netFloorAreaSF || r.floorAreaSF || 0) * 10) / 10;
                          const wl = Math.round((r.wallAreaSF || 0) * 10) / 10;
                          const isPrimary = r.id === primary?.id;
                          return (
                            <div key={r.id} style={{ color: isPrimary ? '#262626' : '#595959' }}>
                              {isPrimary ? '' : '+ '}{name}: Floor {fl} SF, Wall {wl} SF
                            </div>
                          );
                        })}
                        <div style={{ fontWeight: 600, marginTop: 4, borderTop: '1px solid #d9d9d9', paddingTop: 4 }}>
                          Total: Floor {getFieldValue('floor_sf') || 0} SF, Wall {getFieldValue('wall_sf') || 0} SF
                        </div>
                      </div>
                    );
                  }}
                </Form.Item>
              </Card>
            ),
          },

          // ════════ TAB 2: Demo Scope ════════
          {
            key: 'demo',
            forceRender: true,
            label: 'Demo Scope',
            children: (
              <Card className="be-tab-card">
                <Divider orientation="left" plain>Demolition Areas</Divider>
                <Form.Item noStyle shouldUpdate={(prev, cur) =>
                  prev.demo_ceiling !== cur.demo_ceiling ||
                  prev.floor_spec?.material !== cur.floor_spec?.material ||
                  prev.replace_shower !== cur.replace_shower ||
                  prev.shower_spec?.type !== cur.shower_spec?.type ||
                  prev.bathtub_spec?.surround_tile !== cur.bathtub_spec?.surround_tile
                }>
                  {() => {
                    const hasFloorMaterial = !!form.getFieldValue(['floor_spec', 'material']);
                    const showerType = form.getFieldValue(['shower_spec', 'type']);
                    const hasCustomShower = form.getFieldValue('replace_shower') && isCustomTileShower(showerType);
                    const hasSurroundTile = !!form.getFieldValue(['bathtub_spec', 'surround_tile']);
                    const autoFloor = hasFloorMaterial;
                    const autoWalls = hasCustomShower || hasSurroundTile;
                    const autoLabel = <Tag color="blue" style={{ marginLeft: 4, fontSize: 10, lineHeight: '16px' }}>auto</Tag>;
                    return (
                      <Row gutter={16} align="middle">
                        {autoFloor && (
                          <Col xs={12} sm={8} md={5}>
                            <Form.Item
                              label={<>{`Floor SF`}{autoLabel}</>}
                              name="demo_floor_sf"
                              style={{ marginBottom: 8 }}
                            >
                              <InputNumber style={{ width: '100%' }} min={0} placeholder="= room SF" />
                            </Form.Item>
                          </Col>
                        )}
                        {autoWalls && (
                          <Col xs={12} sm={8} md={5}>
                            <Form.Item
                              label={<>{`Wall SF`}{autoLabel}</>}
                              name="demo_wall_sf"
                              style={{ marginBottom: 8 }}
                            >
                              <InputNumber style={{ width: '100%' }} min={0} placeholder="= room SF" />
                            </Form.Item>
                          </Col>
                        )}
                        <Col xs={12} sm={6} md={4}>
                          <Form.Item name="demo_ceiling" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Demo Ceiling</Checkbox>
                          </Form.Item>
                        </Col>
                        {form.getFieldValue('demo_ceiling') && (
                          <Col xs={12} sm={8} md={5}>
                            <Form.Item label="Ceiling SF" name="demo_ceiling_sf" style={{ marginBottom: 8 }}>
                              <InputNumber style={{ width: '100%' }} min={0} placeholder="= room SF" />
                            </Form.Item>
                          </Col>
                        )}
                        {!autoFloor && !autoWalls && (
                          <Col span={24}>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              Floor and wall demo are auto-included when floor material or tile shower/surround is set.
                            </Text>
                          </Col>
                        )}
                      </Row>
                    );
                  }}
                </Form.Item>

                <Divider orientation="left" plain>Fixture Scope</Divider>
                <Form.Item noStyle shouldUpdate={(prev: any, cur: any) =>
                  prev.replace_shower !== cur.replace_shower ||
                  prev.replace_tub !== cur.replace_tub ||
                  prev.replace_vanity !== cur.replace_vanity ||
                  prev.replace_toilet !== cur.replace_toilet ||
                  prev.detach_reset_shower !== cur.detach_reset_shower ||
                  prev.detach_reset_tub !== cur.detach_reset_tub ||
                  prev.detach_reset_vanity !== cur.detach_reset_vanity ||
                  prev.detach_reset_toilet !== cur.detach_reset_toilet ||
                  prev.replace_mirror !== cur.replace_mirror ||
                  prev.detach_reset_mirror !== cur.detach_reset_mirror
                }>
                  {() => {
                    const getAction = (fixture: string) => {
                      if (form.getFieldValue(`replace_${fixture}`)) return 'replace';
                      if (form.getFieldValue(`detach_reset_${fixture}`)) return 'detach_reset';
                      return 'none';
                    };
                    const setAction = (fixture: string, action: string) => {
                      const updates: Record<string, any> = {
                        [`replace_${fixture}`]: action === 'replace',
                        [`detach_reset_${fixture}`]: action === 'detach_reset',
                      };
                      if (fixture === 'tub' && action === 'replace') {
                        const spec = form.getFieldValue('bathtub_spec') || {};
                        if (spec.curtain_rod === undefined || spec.curtain_rod === null) {
                          updates.bathtub_spec = { ...spec, curtain_rod: true };
                        }
                      }
                      form.setFieldsValue(updates);
                    };
                    return (
                      <Row gutter={[16, 8]}>
                        {[
                          ['shower', 'Shower'],
                          ['tub', 'Bathtub'],
                          ['vanity', 'Vanity'],
                          ['toilet', 'Toilet'],
                        ].map(([key, label]) => (
                          <Col xs={24} sm={12} md={6} key={key}>
                            <div style={{ marginBottom: 8 }}>
                              <Text strong style={{ display: 'block', marginBottom: 4 }}>{label}</Text>
                              <Radio.Group
                                value={getAction(key)}
                                onChange={(e) => setAction(key, e.target.value)}
                              >
                                <Radio.Button value="none">None</Radio.Button>
                                <Radio.Button value="replace">Replace</Radio.Button>
                                <Radio.Button value="detach_reset">D&R</Radio.Button>
                              </Radio.Group>
                            </div>
                          </Col>
                        ))}
                        {/* Shown whatever the vanity's action: a mirror is often D&R
                            while the vanity is D&R or not touched at all */}
                        <Col xs={24} sm={12} md={6}>
                          <div style={{ marginBottom: 8 }}>
                            <Text strong style={{ display: 'block', marginBottom: 4 }}>Mirror</Text>
                            <Radio.Group
                              value={getAction('mirror')}
                              onChange={(e) => setAction('mirror', e.target.value)}
                            >
                              <Radio.Button value="none">None</Radio.Button>
                              <Radio.Button value="replace">New</Radio.Button>
                              <Radio.Button value="detach_reset">D&R</Radio.Button>
                            </Radio.Group>
                            {/* Each mirror by width: a double vanity has one wide mirror or a
                                small one over each sink, and D&R is priced per mirror by width */}
                            {getAction('mirror') !== 'none' && (
                              <Form.Item name={['accessories_spec', 'mirrors']} noStyle>
                                <BEMirrorRows />
                              </Form.Item>
                            )}
                          </div>
                        </Col>
                      </Row>
                    );
                  }}
                </Form.Item>
                <Row gutter={[16, 12]} style={{ marginBottom: 8 }}>
                  <Col xs={24} lg={12}>
                    <Text strong style={{ display: 'block', marginBottom: 4 }}>Lights</Text>
                    <Form.Item name={['electrical_spec', 'lights']} noStyle>
                      <BEFixtureRows kinds={LIGHT_KINDS} noun="light" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Text strong style={{ display: 'block', marginBottom: 4 }}>Wall cabinets</Text>
                    <Form.Item name={['accessories_spec', 'cabinets']} noStyle>
                      <BEFixtureRows kinds={CABINET_KINDS} noun="cabinet" typeWidth={250} />
                    </Form.Item>
                  </Col>
                </Row>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                  Replace = new fixture (material + labor) | D&R = Detach & Reset (labor only, reinstall same fixture)
                </Text>

                <Divider orientation="left" plain>Conditions</Divider>
                <Row gutter={[16, 8]}>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item name="water_damage" valuePropName="checked" style={{ marginBottom: 8 }}>
                      <Checkbox>Water Damage</Checkbox>
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item name="mold_suspected" valuePropName="checked" style={{ marginBottom: 8 }}>
                      <Checkbox>Mold Suspected</Checkbox>
                    </Form.Item>
                  </Col>
                </Row>

                <Form.Item noStyle shouldUpdate={(prev, cur) =>
                  prev.water_damage !== cur.water_damage ||
                  prev.demo_already_done !== cur.demo_already_done ||
                  prev.repair_drywall_walls !== cur.repair_drywall_walls ||
                  prev.repair_drywall_ceiling !== cur.repair_drywall_ceiling ||
                  prev.repair_subfloor !== cur.repair_subfloor ||
                  prev.demo_cement_board !== cur.demo_cement_board ||
                  prev.install_insulation_walls !== cur.install_insulation_walls ||
                  prev.install_insulation_ceiling !== cur.install_insulation_ceiling ||
                  prev.demo_insulation_walls !== cur.demo_insulation_walls ||
                  prev.demo_insulation_ceiling !== cur.demo_insulation_ceiling
                }>
                  {() => form.getFieldValue('water_damage') ? (
                    <>
                      <Row gutter={[16, 8]} style={{ marginBottom: 8 }}>
                        <Col xs={24} sm={16} md={12}>
                          <Form.Item
                            name="water_damage_source"
                            label="Damage Source (plumber already repaired)"
                            style={{ marginBottom: 8 }}
                            tooltip="Plumbing for selected fixtures is excluded from the estimate"
                            getValueFromEvent={(vals: string[]) => vals?.length ? vals.join(',') : null}
                            getValueProps={(val: string) => ({ value: val ? val.split(',') : [] })}
                          >
                            <Select
                              mode="multiple"
                              allowClear
                              placeholder="Select damage source(s)"
                              options={[
                                { label: 'Shower', value: 'shower' },
                                { label: 'Bathtub', value: 'bathtub' },
                                { label: 'Vanity / Sink', value: 'vanity' },
                                { label: 'Toilet', value: 'toilet' },
                                { label: 'Supply Line', value: 'supply_line' },
                                { label: 'Other', value: 'other' },
                              ]}
                            />
                          </Form.Item>
                        </Col>
                      </Row>

                      <Divider orientation="left" plain>Water Damage Repair</Divider>
                      <Row gutter={[16, 8]} style={{ marginBottom: 8 }}>
                        <Col xs={24}>
                          <Form.Item name="demo_already_done" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Demo Already Completed (by mitigation team)</Checkbox>
                          </Form.Item>
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                            {form.getFieldValue('demo_already_done')
                              ? 'The ceiling demo is excluded (mitigation tore it out). Tile removal for the remodel — floor tile and tub/shower wall tile — is still charged. Select the repairs needed below.'
                              : 'Uncheck if demo has not been done yet — demo costs will be included in the estimate.'}
                          </Text>
                        </Col>
                      </Row>
                      <Row gutter={16} align="middle">
                        <Col xs={12} sm={8} md={5}>
                          <Form.Item name="repair_drywall_walls" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Repair Walls (Drywall)</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={4} style={{ display: form.getFieldValue('repair_drywall_walls') ? undefined : 'none' }}>
                          <Form.Item label="Wall SF" name="repair_drywall_walls_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={5}>
                          <Form.Item name="repair_drywall_ceiling" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Repair Ceiling (Drywall)</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={4} style={{ display: form.getFieldValue('repair_drywall_ceiling') ? undefined : 'none' }}>
                          <Form.Item label="Ceiling SF" name="repair_drywall_ceiling_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={5}>
                          <Form.Item name="repair_subfloor" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Repair Subfloor</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={4} style={{ display: form.getFieldValue('repair_subfloor') ? undefined : 'none' }}>
                          <Form.Item label="Floor SF" name="repair_subfloor_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                        Leave SF blank to use bathroom dimensions. Walls use moisture-resistant drywall; ceiling uses mold-resistant when water damage present.
                      </Text>

                      <Row gutter={16} align="middle" style={{ marginTop: 4 }}>
                        <Col xs={12} sm={8} md={5}>
                          <Form.Item name="demo_cement_board" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Cement Board Repair</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={4} style={{ display: form.getFieldValue('demo_cement_board') ? undefined : 'none' }}>
                          <Form.Item label="Damaged SF" name="demo_cement_board_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="SF" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={16} md={10} style={{ display: form.getFieldValue('demo_cement_board') ? undefined : 'none' }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            Damaged section will be removed and replaced with new Durock. When the wet area gets new cement board, that board replaces it (no separate line); otherwise only the damaged area + overlap to nearest studs is replaced — undamaged board is reused.
                          </Text>
                        </Col>
                      </Row>

                      <Divider orientation="left" plain style={{ marginTop: 12, marginBottom: 8 }}>Insulation</Divider>
                      <Row gutter={16} align="middle">
                        <Col xs={12} sm={8} md={5}>
                          <Form.Item name="install_insulation_walls" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Install Wall Insulation</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={6} md={3} style={{ display: form.getFieldValue('install_insulation_walls') ? undefined : 'none' }}>
                          <Form.Item label="SF" name="install_insulation_walls_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={6} md={3} style={{ display: form.getFieldValue('install_insulation_walls') ? undefined : 'none' }}>
                          <Form.Item name="demo_insulation_walls" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Demo Existing</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={6} md={3} style={{ display: form.getFieldValue('demo_insulation_walls') ? undefined : 'none' }}>
                          <Form.Item label="Demo SF" name="demo_insulation_walls_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row gutter={16} align="middle">
                        <Col xs={12} sm={8} md={5}>
                          <Form.Item name="install_insulation_ceiling" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Install Ceiling Insulation</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={6} md={3} style={{ display: form.getFieldValue('install_insulation_ceiling') ? undefined : 'none' }}>
                          <Form.Item label="SF" name="install_insulation_ceiling_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={6} md={3} style={{ display: form.getFieldValue('install_insulation_ceiling') ? undefined : 'none' }}>
                          <Form.Item name="demo_insulation_ceiling" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Demo Existing</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={6} md={3} style={{ display: form.getFieldValue('demo_insulation_ceiling') ? undefined : 'none' }}>
                          <Form.Item label="Demo SF" name="demo_insulation_ceiling_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                        Check "Demo Existing" if old insulation must be removed before installing new. Insulation type & R-value are set in the Floor & Walls tab.
                      </Text>
                    </>
                  ) : null}
                </Form.Item>

              </Card>
            ),
          },

          // ════════ TAB 3: Sketch ════════
          {
            key: 'sketch',
            forceRender: true,
            label: (
              <span>
                <EditOutlined style={{ marginRight: 4 }} />
                Sketch
              </span>
            ),
            children: (
              <Card
                className="be-sketch-card"
                title={isPhone ? undefined : 'Bathroom Floor Plan & Tile Estimation'}
                styles={{ body: { padding: 0 } }}
              >
                {/* 700px tall; on a phone, the screen under the tab bar */}
                <div className="be-sketch-frame">
                  <BESketchTab
                    estimateId={id!}
                    estimateData={{ ...form.getFieldsValue(), selections: estimate?.selections }}
                    reloadKey={sketchReload}
                    initialSketchData={estimate?.sketch_data as any}
                    baselineSketch={baseline?.sketch_data as any}
                    baselineName={baseline ? memberName(baseline) : undefined}
                    isActive={activeTab === 'sketch'}
                    onSketchChange={handleSketchChange}
                    onFixtureSync={handleFixtureSync}
                  />
                </div>
              </Card>
            ),
          },

          // ════════ Products: what an option is built from ════════
          ...(estimate?.kind === 'option' ? [{
            key: 'products',
            forceRender: true,
            label: 'Products',
            children: (
              <Card className="be-tab-card">
                <BESelectionsPanel estimate={estimate} onChange={changeSelection} busySlot={selectionBusy} />
              </Card>
            ),
          }] : []),

          // ════════ TAB 4: Shower & Tub ════════
          {
            key: 'shower_tub',
            forceRender: true,
            label: 'Shower & Tub',
            children: (
              <Card className="be-tab-card">
                <Collapse defaultActiveKey={['shower', 'bathtub']}>
                  <Panel header="Shower" key="shower">
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Type" name={['shower_spec', 'type']}>
                          <Select options={selectOpts(pricingInfo?.shower_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Door Type" name={['shower_spec', 'door_type']}>
                          <Select options={selectOpts(pricingInfo?.shower_door_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Door Opening (in)" name={['shower_spec', 'door_width_in']}>
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="e.g. 60" />
                        </Form.Item>
                      </Col>
                      <Form.Item noStyle shouldUpdate={(prev: any, cur: any) =>
                        prev?.shower_spec?.showerhead_action !== cur?.shower_spec?.showerhead_action}>
                        {() => {
                          const shAction = form.getFieldValue(['shower_spec', 'showerhead_action']) || 'replace';
                          return (
                            <>
                              <Col xs={24} sm={12} md={6}>
                                <Text style={{ display: 'block', marginBottom: 4 }}>Showerhead</Text>
                                <Radio.Group
                                  value={shAction}
                                  onChange={(e) => form.setFieldsValue({
                                    shower_spec: { ...form.getFieldValue('shower_spec'), showerhead_action: e.target.value }
                                  })}
                                >
                                  <Radio.Button value="replace">Replace</Radio.Button>
                                  <Radio.Button value="detach_reset">D&R</Radio.Button>
                                  <Radio.Button value="none">None</Radio.Button>
                                </Radio.Group>
                              </Col>
                              {shAction === 'replace' && (
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Showerhead Type" name={['shower_spec', 'showerhead_type']}>
                                    <Select options={selectOpts(pricingInfo?.showerhead_types)} allowClear />
                                  </Form.Item>
                                </Col>
                              )}
                            </>
                          );
                        }}
                      </Form.Item>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Trim Grade" name={['shower_spec', 'trim_grade']}>
                          <Select options={selectOpts(pricingInfo?.trim_grades)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Niches" name={['shower_spec', 'niches']}>
                          <InputNumber style={{ width: '100%' }} min={0} max={3} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['shower_spec', 'bench']} valuePropName="checked">
                          <Checkbox>Bench</Checkbox>
                        </Form.Item>
                      </Col>
                      <Form.Item noStyle shouldUpdate={(prev: any, cur: any) =>
                        prev?.shower_spec?.bench !== cur?.shower_spec?.bench}>
                        {({ getFieldValue }: any) => getFieldValue(['shower_spec', 'bench']) ? (
                          <>
                            <Col xs={12} sm={8} md={4}>
                              <Form.Item label="Bench Position" name={['shower_spec', 'bench_position']}>
                                <Select
                                  options={[
                                    { label: 'Left Wall', value: 'left' },
                                    { label: 'Right Wall', value: 'right' },
                                    { label: 'Back Wall', value: 'back' },
                                  ]}
                                  placeholder="left"
                                />
                              </Form.Item>
                            </Col>
                            <Col xs={12} sm={8} md={4}>
                              <Form.Item label="Bench Length (in)" name={['shower_spec', 'bench_length']}>
                                <InputNumber style={{ width: '100%' }} min={12} max={60} placeholder="36" />
                              </Form.Item>
                            </Col>
                          </>
                        ) : null}
                      </Form.Item>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['shower_spec', 'valve_replace']} valuePropName="checked">
                          <Checkbox>Replace Valve</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain>Custom Tile (if applicable)</Divider>
                    <Row gutter={16}>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Width (in)" name={['shower_spec', 'width_in']}>
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="e.g. 60" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Depth (in)" name={['shower_spec', 'depth_in']}>
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="e.g. 36" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Tile Height (in)" name={['shower_spec', 'tile_height_in']}>
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="e.g. 84" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Tile SF" name={['shower_spec', 'tile_spec', 'sf']}
                          tooltip="Leave blank to auto-calculate from dimensions">
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Tile Material" name={['shower_spec', 'tile_spec', 'material']}>
                          <Select options={selectOpts(pricingInfo?.tile_materials)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Pattern" name={['shower_spec', 'tile_spec', 'pattern']}>
                          <Select options={selectOpts(pricingInfo?.tile_patterns)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Tile Size" name={['shower_spec', 'tile_spec', 'size']}>
                          <Select options={selectOpts(pricingInfo?.tile_sizes)} allowClear placeholder="12x12" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                  <Panel header="Bathtub" key="bathtub">
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Type" name={['bathtub_spec', 'type']}>
                          <Select options={selectOpts(pricingInfo?.bathtub_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Material" name={['bathtub_spec', 'material']}>
                          <Select options={selectOpts(pricingInfo?.bathtub_materials)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['bathtub_spec', 'jetted']} valuePropName="checked">
                          <Checkbox>Jetted/Whirlpool</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['bathtub_spec', 'curtain_rod']} valuePropName="checked">
                          <Checkbox>Curtain Rod</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16} align="bottom">
                      <Col xs={24} sm={8} md={4}>
                        <Form.Item label="Faucet">
                          <Text type="secondary">Always R&R</Text>
                        </Form.Item>
                      </Col>
                      {([
                        ['showerhead_action', 'Shower Head'],
                        ['handheld_action', 'Hand Shower (hose)'],
                      ] as const).map(([field, label]) => (
                        <Col xs={24} sm={12} md={8} key={field}>
                          <Form.Item label={label} name={['bathtub_spec', field]}
                            getValueProps={(v?: string) => ({ value: v || 'none' })}>
                            <Radio.Group>
                              <Radio.Button value="none">None</Radio.Button>
                              <Radio.Button value="detach_reset">D&R</Radio.Button>
                              <Radio.Button value="replace">R&R</Radio.Button>
                            </Radio.Group>
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                    <Form.Item noStyle shouldUpdate={(prev, cur) =>
                      prev?.bathtub_spec?.type !== cur?.bathtub_spec?.type ||
                      prev?.bathtub_spec?.surround_tile !== cur?.bathtub_spec?.surround_tile
                    }>
                      {() => ['alcove', 'drop_in'].includes(form.getFieldValue(['bathtub_spec', 'type'])) && (
                        <>
                          <Divider orientation="left" plain style={{ margin: '8px 0' }}>Surround Tile</Divider>
                          <Row gutter={16} align="middle">
                            <Col xs={12} sm={8} md={4}>
                              <Form.Item name={['bathtub_spec', 'surround_tile']} valuePropName="checked" style={{ marginBottom: 8 }}>
                                <Checkbox>Surround Tile</Checkbox>
                              </Form.Item>
                            </Col>
                          </Row>
                          <div style={{ display: form.getFieldValue(['bathtub_spec', 'surround_tile']) ? undefined : 'none' }}>
                              <Row gutter={16} align="middle">
                                <Col xs={16} sm={10} md={6}>
                                  <Form.Item label="Tub Size" name={['bathtub_spec', 'tub_size_preset']} style={{ marginBottom: 8 }}>
                                    <Select
                                      placeholder="Select tub size"
                                      onChange={(val: string) => {
                                        const presets: Record<string, { length: number; depth: number; sf: number }> = {
                                          '60x30': { length: 60, depth: 30, sf: 60 },
                                          '60x32': { length: 60, depth: 32, sf: 62 },
                                          '66x32': { length: 66, depth: 32, sf: 65 },
                                          '66x36': { length: 66, depth: 36, sf: 69 },
                                          '72x36': { length: 72, depth: 36, sf: 72 },
                                          '72x42': { length: 72, depth: 42, sf: 78 },
                                          '60x42_corner': { length: 60, depth: 42, sf: 72 },
                                          '60x60_corner': { length: 60, depth: 60, sf: 90 },
                                        };
                                        const p = val ? presets[val] : null;
                                        if (p) {
                                          form.setFieldsValue({
                                            bathtub_spec: {
                                              ...form.getFieldValue('bathtub_spec'),
                                              tub_length_in: p.length,
                                              tub_depth_in: p.depth,
                                              surround_height_in: 72,
                                              surround_tile_sf: p.sf,
                                            },
                                          });
                                        }
                                      }}
                                      options={[
                                        { label: '60" × 30" (Standard) — 60 SF', value: '60x30' },
                                        { label: '60" × 32" — 62 SF', value: '60x32' },
                                        { label: '66" × 32" — 65 SF', value: '66x32' },
                                        { label: '66" × 36" (Large) — 69 SF', value: '66x36' },
                                        { label: '72" × 36" (XL) — 72 SF', value: '72x36' },
                                        { label: '72" × 42" (Soaking) — 78 SF', value: '72x42' },
                                        { label: '60" × 42" (Corner) — 72 SF', value: '60x42_corner' },
                                        { label: '60" × 60" (Corner/Garden) — 90 SF', value: '60x60_corner' },
                                      ]}
                                    />
                                  </Form.Item>
                                </Col>
                                <Col xs={8} sm={6} md={4}>
                                  <Form.Item label="Surround SF" name={['bathtub_spec', 'surround_tile_sf']} style={{ marginBottom: 8 }}
                                    tooltip={'3-wall surround, 72" height (standard)'}>
                                    <InputNumber style={{ width: '100%' }} min={0} addonAfter="SF" />
                                  </Form.Item>
                                </Col>
                              </Row>
                              <Row gutter={16}>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Tile Material" name={['bathtub_spec', 'surround_tile_material']} style={{ marginBottom: 8 }}>
                                    <Select options={selectOpts(pricingInfo?.tile_materials)} allowClear placeholder="porcelain" />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Pattern" name={['bathtub_spec', 'surround_tile_pattern']} style={{ marginBottom: 8 }}>
                                    <Select options={selectOpts(pricingInfo?.tile_patterns)} allowClear placeholder="straight" />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Tile Size" name={['bathtub_spec', 'surround_tile_size']} style={{ marginBottom: 8 }}>
                                    <Select options={selectOpts(pricingInfo?.tile_sizes)} allowClear placeholder="12x12" />
                                  </Form.Item>
                                </Col>
                              </Row>
                          </div>
                        </>
                      )}
                    </Form.Item>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 4: Vanity & Toilet ════════
          {
            key: 'vanity_toilet',
            forceRender: true,
            label: 'Vanity/Sink & Toilet',
            children: (
              <Card className="be-tab-card">
                <Collapse defaultActiveKey={['vanity', 'toilet']}>
                  <Panel header="Vanity / Sink" key="vanity">
                    <Form.List name={['vanity_spec', 'items']}>
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map(({ key, name, ...restField }, idx) => {
                            const sinkType = form.getFieldValue(['vanity_spec', 'items', name, 'sink_type']) ?? 'cabinet';
                            const isCabinet = sinkType === 'cabinet';
                            const typeLabel = sinkType === 'pedestal_sink' ? 'Pedestal Sink'
                              : sinkType === 'wall_mount_sink' ? 'Wall-Mount Sink'
                              : `Vanity`;
                            return (
                              <Card
                                key={key}
                                size="small"
                                title={`${typeLabel} ${idx + 1}`}
                                style={{ marginBottom: 12 }}
                                extra={fields.length > 1 && (
                                  <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(name)} />
                                )}
                              >
                                <Row gutter={16}>
                                  <Col xs={12} sm={8} md={6}>
                                    <Form.Item label="Type" {...restField} name={[name, 'sink_type']}>
                                      <Select
                                        options={[
                                          { label: 'Cabinet Vanity', value: 'cabinet' },
                                          { label: 'Pedestal Sink', value: 'pedestal_sink' },
                                          { label: 'Wall-Mount Sink', value: 'wall_mount_sink' },
                                        ]}
                                      />
                                    </Form.Item>
                                  </Col>
                                  {isCabinet && (
                                    <>
                                      <Col xs={12} sm={8} md={4}>
                                        <Form.Item label="Width" {...restField} name={[name, 'width']}>
                                          <Select options={numOpts(pricingInfo?.vanity_widths)} allowClear />
                                        </Form.Item>
                                      </Col>
                                      <Col xs={12} sm={8} md={4}>
                                        <Form.Item label="Sinks" {...restField} name={[name, 'sinks']}>
                                          <Select options={[{ label: '1', value: 1 }, { label: '2', value: 2 }]} />
                                        </Form.Item>
                                      </Col>
                                      <Col xs={12} sm={12} md={5}>
                                        <Form.Item label="Source" {...restField} name={[name, 'source']}>
                                          <Select options={selectOpts(pricingInfo?.vanity_sources)} allowClear />
                                        </Form.Item>
                                      </Col>
                                      <Col xs={12} sm={12} md={5}>
                                        <Form.Item label="Countertop" {...restField} name={[name, 'top_material']}>
                                          <Select options={selectOpts(pricingInfo?.vanity_top_materials)} allowClear />
                                        </Form.Item>
                                      </Col>
                                    </>
                                  )}
                                </Row>
                                <Row gutter={16}>
                                  {isCabinet && (
                                    <Col xs={12} sm={12} md={6}>
                                      <Form.Item label="Mounting" {...restField} name={[name, 'mounting']}>
                                        <Select options={selectOpts(pricingInfo?.vanity_mountings)} allowClear />
                                      </Form.Item>
                                    </Col>
                                  )}
                                  <Col xs={12} sm={12} md={6}>
                                    <Form.Item label="Faucet Type" {...restField} name={[name, 'faucet_type']}>
                                      <Select options={selectOpts(pricingInfo?.faucet_types)} allowClear />
                                    </Form.Item>
                                  </Col>
                                  <Col xs={12} sm={12} md={6}>
                                    <Form.Item label="Mirror" {...restField} name={[name, 'mirror_type']}>
                                      <Select options={selectOpts(pricingInfo?.mirror_types)} allowClear />
                                    </Form.Item>
                                  </Col>
                                </Row>
                              </Card>
                            );
                          })}
                          <Button type="dashed" onClick={() => add({ sink_type: 'cabinet', sinks: 1 })} block icon={<PlusOutlined />}>
                            Add Vanity / Sink
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </Panel>
                  <Panel header="Toilet" key="toilet">
                    <Row gutter={16}>
                      <Col xs={24} sm={12} md={8}>
                        <Form.Item label="Type" name={['toilet_spec', 'type']}>
                          <Select options={selectOpts(pricingInfo?.toilet_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['toilet_spec', 'bidet_seat']} valuePropName="checked">
                          <Checkbox>Bidet Seat</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['toilet_spec', 'flange_repair']} valuePropName="checked">
                          <Checkbox>Flange Repair</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 5: Floor & Walls ════════
          {
            key: 'floor_walls',
            forceRender: true,
            label: 'Floor & Walls',
            children: (
              <Card className="be-tab-card">
                <Collapse defaultActiveKey={['floor', 'walls', 'substrate']}>
                  <Panel header="Floor" key="floor">
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Material" name={['floor_spec', 'material']}>
                          <Select options={selectOpts(pricingInfo?.tile_materials)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Pattern" name={['floor_spec', 'pattern']}>
                          <Select options={selectOpts(pricingInfo?.tile_patterns)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Tile Size" name={['floor_spec', 'size']}>
                          <Select options={selectOpts(pricingInfo?.tile_sizes)} allowClear placeholder="12x12" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['floor_spec', 'heated_floor']} valuePropName="checked">
                          <Checkbox>Heated Floor</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                  <Panel header="Walls & Paint / Tile" key="walls">
                    <Form.Item noStyle shouldUpdate={(prev, cur) =>
                      prev?.wall_sf !== cur?.wall_sf || prev?.paint_wall_sf !== cur?.paint_wall_sf
                    }>
                      {({ getFieldValue }) => {
                        const wallSF = getFieldValue('wall_sf');
                        const paintSF = getFieldValue('paint_wall_sf');
                        return wallSF ? (
                          <div style={{ marginBottom: 12, padding: '6px 12px', background: '#f6f6f6', borderRadius: 4, fontSize: 12 }}>
                            Total Wall: <strong>{wallSF} SF</strong>
                            {paintSF != null && paintSF !== wallSF && (
                              <span style={{ marginLeft: 12 }}>
                                Paintable: <strong>{paintSF} SF</strong>
                                <span style={{ color: '#8c8c8c', marginLeft: 4 }}>
                                  (−{Math.round((wallSF - paintSF) * 10) / 10} SF covered by shower/tub)
                                </span>
                              </span>
                            )}
                          </div>
                        ) : null;
                      }}
                    </Form.Item>
                    <Row gutter={16}>
                      <Col xs={24} sm={12} md={8}>
                        <Form.Item label="Wall Finish" name={['walls_spec', 'wall_finish']}>
                          <Select
                            allowClear
                            placeholder="Select wall finish"
                            onChange={(v) => {
                              // Clear conflicting fields when switching
                              if (v === 'paint') {
                                form.setFieldsValue({ walls_spec: { tile_walls: false } });
                              } else if (v === 'tile') {
                                form.setFieldsValue({ walls_spec: { paint_walls: false } });
                              }
                            }}
                            options={[
                              { label: 'Paint', value: 'paint' },
                              { label: 'Tile', value: 'tile' },
                              { label: 'Paint + Tile (partial)', value: 'paint_and_tile' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['walls_spec', 'paint_ceiling']} valuePropName="checked">
                          <Checkbox>Paint Ceiling</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6} md={3}>
                        <Form.Item label="Door Trim" name={['walls_spec', 'door_trim_count']}>
                          <InputNumber style={{ width: '100%' }} min={0} max={10} placeholder="0" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6} md={3}>
                        <Form.Item label="Window Trim" name={['walls_spec', 'window_trim_count']}>
                          <InputNumber style={{ width: '100%' }} min={0} max={10} placeholder="0" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Baseboard" name={['walls_spec', 'baseboard_material']}>
                          <Select allowClear options={[
                            { label: 'Standard (PVC)', value: 'pvc' },
                            { label: 'Tile Base', value: 'tile' },
                          ]} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item noStyle shouldUpdate={(prev, cur) =>
                      prev?.walls_spec?.wall_finish !== cur?.walls_spec?.wall_finish
                    }>
                      {({ getFieldValue }) => {
                        const finish = getFieldValue(['walls_spec', 'wall_finish']);
                        const showPaint = finish === 'paint' || finish === 'paint_and_tile';
                        const showTile = finish === 'tile' || finish === 'paint_and_tile';
                        return (
                          <>
                            {showPaint && (
                              <Row gutter={16} style={{ marginBottom: 8 }}>
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Paint Grade" name={['walls_spec', 'paint_grade']}>
                                    <Select options={selectOpts(pricingInfo?.paint_grades)} allowClear />
                                  </Form.Item>
                                </Col>
                                {finish === 'paint_and_tile' && (
                                  <Col xs={12} sm={8} md={4}>
                                    <Form.Item label="Paint SF" name={['walls_spec', 'paint_wall_sf']}
                                      tooltip="Wall area to paint (excluding tiled portions)">
                                      <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                                    </Form.Item>
                                  </Col>
                                )}
                              </Row>
                            )}
                            {showTile && (
                              <Row gutter={16} style={{ marginBottom: 8 }}>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Tile Wall SF" name={['walls_spec', 'tile_wall_sf']}
                                    tooltip="Wall area to tile. Auto-filled from sketch.">
                                    <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Tile Material" name={['walls_spec', 'tile_material']}>
                                    <Select options={selectOpts(pricingInfo?.tile_materials)} allowClear />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Tile Pattern" name={['walls_spec', 'tile_pattern']}>
                                    <Select options={selectOpts(pricingInfo?.tile_patterns)} allowClear />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Tile Size" name={['walls_spec', 'tile_size']}>
                                    <Select options={selectOpts(pricingInfo?.tile_sizes)} allowClear />
                                  </Form.Item>
                                </Col>
                              </Row>
                            )}
                          </>
                        );
                      }}
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(prev, cur) =>
                      prev?.walls_spec?.baseboard_material !== cur?.walls_spec?.baseboard_material
                    }>
                      {({ getFieldValue }) => {
                        const bbMat = getFieldValue(['walls_spec', 'baseboard_material']);
                        if (!bbMat) return null;
                        return (
                          <Row gutter={16}>
                            {bbMat !== 'tile' && (
                              <Col xs={12} sm={8} md={4}>
                                <Form.Item name={['walls_spec', 'quarter_round']} valuePropName="checked">
                                  <Checkbox>+ Quarter Round</Checkbox>
                                </Form.Item>
                              </Col>
                            )}
                            <Col xs={12} sm={8} md={5}>
                              <Form.Item name={['hidden_costs', 'trim_paint']} valuePropName="checked">
                                <Checkbox onChange={(e) => {
                                  if (e.target.checked && !form.getFieldValue(['hidden_costs', 'trim_paint_lf'])) {
                                    const skRooms = (form.getFieldValue('sketch_data') || {}).rooms || [];
                                    let totalPerimeter = 0;
                                    for (const rm of skRooms) {
                                      if (rm.parentRoomId) continue;
                                      totalPerimeter += rm.perimeterLF || 0;
                                    }
                                    if (!totalPerimeter) {
                                      const l = form.getFieldValue('length_ft') || 0;
                                      const w = form.getFieldValue('width_ft') || 0;
                                      totalPerimeter = 2 * (l + w);
                                    }
                                    if (totalPerimeter > 0) {
                                      form.setFieldValue(['hidden_costs', 'trim_paint_lf'], Math.round(totalPerimeter));
                                    }
                                  }
                                }}>+ Trim Touch-up</Checkbox>
                              </Form.Item>
                            </Col>
                            <Form.Item noStyle shouldUpdate={(p, c) =>
                              p?.hidden_costs?.trim_paint !== c?.hidden_costs?.trim_paint
                            }>
                              {({ getFieldValue: gfv }) => gfv(['hidden_costs', 'trim_paint']) ? (
                                <Col xs={8} sm={6} md={3}>
                                  <Form.Item label="LF" name={['hidden_costs', 'trim_paint_lf']}
                                    tooltip="Baseboard perimeter — auto-filled from room dimensions">
                                    <InputNumber style={{ width: '100%' }} min={0} />
                                  </Form.Item>
                                </Col>
                              ) : null}
                            </Form.Item>
                          </Row>
                        );
                      }}
                    </Form.Item>
                    <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12 }}>
                      <Form.Item noStyle shouldUpdate={(prev, cur) =>
                        prev?.repair_drywall_walls !== cur?.repair_drywall_walls ||
                        prev?.repair_drywall_walls_sf !== cur?.repair_drywall_walls_sf
                      }>
                        {({ getFieldValue }) => {
                          const repairWallsActive = getFieldValue('repair_drywall_walls');
                          return repairWallsActive ? (
                            <Row gutter={16} style={{ marginBottom: 8 }}>
                              <Col span={24}>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  <AuditOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                                  Drywall repair — "Water Damage Repair" 항목에서 이미 포함됨
                                  {getFieldValue('repair_drywall_walls_sf') ? ` (${getFieldValue('repair_drywall_walls_sf')} SF)` : ''}
                                </Text>
                              </Col>
                            </Row>
                          ) : (
                            <Row gutter={16}>
                              <Col xs={12} sm={8} md={5}>
                                <Form.Item name={['hidden_costs', 'drywall_patch']} valuePropName="checked" style={{ marginBottom: 8 }}>
                                  <Checkbox>Drywall Patch</Checkbox>
                                </Form.Item>
                              </Col>
                              <Col xs={8} sm={6} md={4}>
                                <Form.Item label="SF" name={['hidden_costs', 'drywall_patch_sf']} style={{ marginBottom: 8 }}>
                                  <InputNumber style={{ width: '100%' }} min={0} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8} md={5}>
                                <Form.Item name={['hidden_costs', 'drywall_patch_full']} valuePropName="checked" style={{ marginBottom: 8 }}>
                                  <Checkbox>Full (hang, tape, mud, prime)</Checkbox>
                                </Form.Item>
                              </Col>
                            </Row>
                          );
                        }}
                      </Form.Item>
                    </div>
                    <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12 }}>
                      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Insulation</Text>
                      <Form.Item noStyle shouldUpdate={(prev, cur) =>
                        prev?.install_insulation_walls !== cur?.install_insulation_walls ||
                        prev?.install_insulation_walls_sf !== cur?.install_insulation_walls_sf ||
                        prev?.install_insulation_ceiling !== cur?.install_insulation_ceiling ||
                        prev?.install_insulation_ceiling_sf !== cur?.install_insulation_ceiling_sf ||
                        prev?.demo_insulation_walls !== cur?.demo_insulation_walls ||
                        prev?.demo_insulation_walls_sf !== cur?.demo_insulation_walls_sf ||
                        prev?.demo_insulation_ceiling !== cur?.demo_insulation_ceiling ||
                        prev?.demo_insulation_ceiling_sf !== cur?.demo_insulation_ceiling_sf ||
                        prev?.walls_spec?.insulation_type !== cur?.walls_spec?.insulation_type ||
                        prev?.walls_spec?.insulation_r_value !== cur?.walls_spec?.insulation_r_value
                      }>
                        {({ getFieldValue }) => {
                          const hasWallIns = getFieldValue('install_insulation_walls');
                          const hasCeilIns = getFieldValue('install_insulation_ceiling');
                          const hasDemoWall = getFieldValue('demo_insulation_walls');
                          const hasDemoCeil = getFieldValue('demo_insulation_ceiling');
                          const hasAnyFromSketch = hasWallIns || hasCeilIns;

                          return hasAnyFromSketch ? (
                            <>
                              <Row gutter={16} style={{ marginBottom: 4 }}>
                                <Col span={24}>
                                  <Text type="secondary" style={{ fontSize: 12 }}>
                                    <AuditOutlined style={{ color: '#ad1457', marginRight: 4 }} />
                                    Insulation from Sketch
                                    {hasWallIns && ` | Wall: ${getFieldValue('install_insulation_walls_sf') || 0} SF`}
                                    {hasCeilIns && ` | Ceiling: ${getFieldValue('install_insulation_ceiling_sf') || 0} SF`}
                                  </Text>
                                </Col>
                              </Row>
                              {(hasDemoWall || hasDemoCeil) && (
                                <Row gutter={16} style={{ marginBottom: 4 }}>
                                  <Col span={24}>
                                    <Text type="secondary" style={{ fontSize: 12, color: '#c62828' }}>
                                      Demo insulation
                                      {hasDemoWall && ` | Wall: ${getFieldValue('demo_insulation_walls_sf') || 0} SF`}
                                      {hasDemoCeil && ` | Ceiling: ${getFieldValue('demo_insulation_ceiling_sf') || 0} SF`}
                                    </Text>
                                  </Col>
                                </Row>
                              )}
                              <Row gutter={16} style={{ marginBottom: 8 }}>
                                <Col xs={12} sm={8} md={6}>
                                  <Form.Item label="Type" name={['walls_spec', 'insulation_type']} style={{ marginBottom: 4 }}>
                                    <Select allowClear options={[
                                      { label: 'Fiberglass Batt', value: 'fiberglass_batt' },
                                      { label: 'Blown-in', value: 'blown_in' },
                                      { label: 'Spray Foam', value: 'spray_foam' },
                                      { label: 'Rigid Board', value: 'rigid_board' },
                                    ]} />
                                  </Form.Item>
                                </Col>
                                <Col xs={8} sm={6} md={4}>
                                  <Form.Item label="R-Value" name={['walls_spec', 'insulation_r_value']} style={{ marginBottom: 4 }}>
                                    <InputNumber style={{ width: '100%' }} min={1} max={60} />
                                  </Form.Item>
                                </Col>
                              </Row>
                            </>
                          ) : (
                            <Row gutter={16}>
                              <Col xs={12} sm={8} md={6}>
                                <Form.Item name={['walls_spec', 'insulation_walls']} valuePropName="checked" style={{ marginBottom: 4 }}>
                                  <Checkbox>Wall Insulation</Checkbox>
                                </Form.Item>
                              </Col>
                              <Col xs={8} sm={6} md={4}>
                                <Form.Item label="SF" name={['walls_spec', 'insulation_walls_sf']} style={{ marginBottom: 4 }}>
                                  <InputNumber style={{ width: '100%' }} min={0} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8} md={6}>
                                <Form.Item name={['walls_spec', 'insulation_ceiling']} valuePropName="checked" style={{ marginBottom: 4 }}>
                                  <Checkbox>Ceiling Insulation</Checkbox>
                                </Form.Item>
                              </Col>
                              <Col xs={8} sm={6} md={4}>
                                <Form.Item label="SF" name={['walls_spec', 'insulation_ceiling_sf']} style={{ marginBottom: 4 }}>
                                  <InputNumber style={{ width: '100%' }} min={0} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8} md={6}>
                                <Form.Item label="Type" name={['walls_spec', 'insulation_type']} style={{ marginBottom: 4 }}>
                                  <Select allowClear options={[
                                    { label: 'Fiberglass Batt', value: 'fiberglass_batt' },
                                    { label: 'Blown-in', value: 'blown_in' },
                                    { label: 'Spray Foam', value: 'spray_foam' },
                                    { label: 'Rigid Board', value: 'rigid_board' },
                                  ]} />
                                </Form.Item>
                              </Col>
                              <Col xs={8} sm={6} md={4}>
                                <Form.Item label="R-Value" name={['walls_spec', 'insulation_r_value']} style={{ marginBottom: 4 }}>
                                  <InputNumber style={{ width: '100%' }} min={1} max={60} />
                                </Form.Item>
                              </Col>
                            </Row>
                          );
                        }}
                      </Form.Item>
                    </div>
                    <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12 }}>
                      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Auto-include (uncheck to disable)</Text>
                      <Row gutter={[16, 4]}>
                        <Col xs={12} sm={8} md={6}>
                          <Form.Item name={['hidden_costs', 'drywall_skim_coat']} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox><Text style={{ fontSize: 12 }}>Drywall skim coat</Text></Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={6}>
                          <Form.Item name={['hidden_costs', 'mold_resistant_drywall']} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox><Text style={{ fontSize: 12 }}>Mold-resistant drywall</Text></Checkbox>
                          </Form.Item>
                        </Col>
                      </Row>
                    </div>
                  </Panel>
                  <Panel header={
                    <Space size={6}>
                      Substrate
                      <Tooltip title={
                        <div>
                          <div>• Prefab Surround (One Piece / Kit) → Durock, Waterproofing 불필요</div>
                          <div>• Custom Tile / Curbless → Durock + Waterproofing 필수</div>
                          <div>• 바닥 타일 교체 → Floor Cement Board 필수 (자동 계산)</div>
                          <div>• Vanity / Toilet만 교체 → Substrate 불필요</div>
                        </div>
                      }>
                        <QuestionCircleOutlined style={{ color: '#8c8c8c', fontSize: 14 }} />
                      </Tooltip>
                    </Space>
                  } key="substrate">
                    <Form.Item noStyle shouldUpdate={(prev, cur) =>
                      prev?.shower_spec?.type !== cur?.shower_spec?.type ||
                      prev?.shower_spec?.tile_spec?.sf !== cur?.shower_spec?.tile_spec?.sf ||
                      prev?.shower_spec?.width_in !== cur?.shower_spec?.width_in ||
                      prev?.shower_spec?.depth_in !== cur?.shower_spec?.depth_in ||
                      prev?.shower_spec?.tile_height_in !== cur?.shower_spec?.tile_height_in ||
                      prev?.bathtub_spec?.surround_tile_sf !== cur?.bathtub_spec?.surround_tile_sf ||
                      prev?.bathtub_spec?.surround_tile !== cur?.bathtub_spec?.surround_tile ||
                      prev?.replace_shower !== cur?.replace_shower ||
                      prev?.floor_spec?.material !== cur?.floor_spec?.material ||
                      prev?.floor_sf !== cur?.floor_sf ||
                      prev?.length_ft !== cur?.length_ft ||
                      prev?.width_ft !== cur?.width_ft
                    }>
                      {() => {
                        // Auto-calculate wet-area SF from shower/tub
                        const vals = form.getFieldsValue();
                        let wetSF = 0;
                        if (vals.replace_shower && vals.shower_spec?.type === 'custom_tile') {
                          const ts = vals.shower_spec?.tile_spec?.sf;
                          if (ts) {
                            wetSF += ts;
                          } else {
                            const sw = vals.shower_spec?.width_in || 0;
                            const sd = vals.shower_spec?.depth_in || 0;
                            const sh = vals.shower_spec?.tile_height_in || 0;
                            if (sw && sd && sh) wetSF += (sw + 2 * sd) * sh / 144;
                          }
                        }
                        if (vals.bathtub_spec?.surround_tile) {
                          wetSF += vals.bathtub_spec?.surround_tile_sf || 0;
                        }
                        wetSF = Math.round(wetSF * 10) / 10;

                        return (
                          <>
                            {wetSF > 0 && (
                              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                                Auto-calculated from tile areas: Shower + Tub Surround = <Text strong>{wetSF} SF</Text> (Durock & Waterproofing).
                                Leave blank to use auto value, or enter to override.
                              </Text>
                            )}
                            <Row gutter={16}>
                              <Col xs={12} sm={8} md={4}>
                                <Form.Item label={<Space size={4}>Durock SF<Tooltip title={`Cement backer board for wet areas. ${wetSF > 0 ? `Auto: ${wetSF} SF from shower/tub tile areas.` : 'Enter manually.'} Override if needed.`}><QuestionCircleOutlined style={{ color: '#8c8c8c' }} /></Tooltip></Space>} name={['substrate_spec', 'durock_sf']}>
                                  <InputNumber style={{ width: '100%' }} min={0} placeholder={wetSF > 0 ? `auto: ${wetSF}` : '0'} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8} md={4}>
                                <Form.Item label={<Space size={4}>Greenboard SF<Tooltip title="Moisture-resistant drywall. Used on bathroom walls/ceilings not directly in wet areas."><QuestionCircleOutlined style={{ color: '#8c8c8c' }} /></Tooltip></Space>} name={['substrate_spec', 'greenboard_sf']}>
                                  <InputNumber style={{ width: '100%' }} min={0} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={12} md={6}>
                                <Form.Item label="Waterproofing" name={['substrate_spec', 'waterproof_type']}>
                                  <Select
                                    options={[
                                      { label: 'Paint-on Membrane', value: 'paint_on' },
                                      { label: 'Sheet Membrane', value: 'sheet' },
                                      { label: 'None', value: 'none' },
                                    ]}
                                    allowClear
                                    placeholder="Paint-on (default)"
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8} md={4}>
                                <Form.Item label={<Space size={4}>Waterproof SF<Tooltip title={`Waterproofing area. ${wetSF > 0 ? `Auto: same as Durock (${wetSF} SF).` : 'Enter manually.'}`}><QuestionCircleOutlined style={{ color: '#8c8c8c' }} /></Tooltip></Space>} name={['substrate_spec', 'waterproof_sf']}>
                                  <InputNumber style={{ width: '100%' }} min={0} placeholder={wetSF > 0 ? `auto: ${wetSF}` : '0'} />
                                </Form.Item>
                              </Col>
                            </Row>
                          </>
                        );
                      }}
                    </Form.Item>
                    <Row gutter={16}>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['substrate_spec', 'subfloor_repair']} valuePropName="checked">
                          <Checkbox>Subfloor Repair</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Repair SF" name={['substrate_spec', 'subfloor_repair_sf']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 6: Plumbing & Electrical ════════
          {
            key: 'trades',
            forceRender: true,
            label: 'Plumbing & Electrical',
            children: (
              <Card className="be-tab-card">
                <Collapse defaultActiveKey={['plumbing', 'electrical']}>
                  <Panel header="Plumbing" key="plumbing">
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                      Shutoff valve, supply line은 Replace/D&R fixture에서 자동 계산됩니다.
                    </Text>
                    <Row gutter={16}>
                      <Col xs={12} sm={8} md={6}>
                        <Form.Item name={['plumbing_spec', 'drain_modification']} valuePropName="checked">
                          <Checkbox>
                            Drain Mod{' '}
                            <Tooltip title="배수관 위치 변경이 필요할 때 체크하세요. 예: 욕조→샤워 전환, fixture 위치 이동, 기존 배수관 크기 변경 등. 기존 위치 그대로 교체하는 경우에는 불필요합니다.">
                              <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
                            </Tooltip>
                          </Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={6}>
                        <Form.Item name={['plumbing_spec', 'pressure_balance_valve']} valuePropName="checked">
                          <Checkbox>
                            Pressure Balance{' '}
                            <Tooltip title="온수/냉수 압력 균형 밸브 (코드 요구사항). 다른 곳에서 물을 사용할 때 샤워 온도가 급변하는 것을 방지합니다. 기존 밸브가 없거나 노후된 경우, 또는 코드 업데이트가 필요한 경우 체크하세요.">
                              <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
                            </Tooltip>
                          </Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['plumbing_spec', 'rough_inspection']} valuePropName="checked">
                          <Checkbox>Inspection</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                    <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12 }}>
                      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Auto-include (uncheck to disable)</Text>
                      <Row gutter={[16, 4]}>
                        <Col xs={24} sm={16} md={12}>
                          <Form.Item name={['hidden_costs', 'auto_tub_valve']} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox><Text style={{ fontSize: 12 }}>Bathtub valve + trim (tub surround tile 작업 시)</Text></Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={16} md={12}>
                          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.replace_shower !== cur.replace_shower}>
                            {() => {
                              const hasShower = !!form.getFieldValue('replace_shower');
                              return (
                                <Form.Item name={['hidden_costs', 'auto_shower_valve']} valuePropName="checked" style={{ marginBottom: 2 }}>
                                  <Checkbox disabled={!hasShower}>
                                    <Text style={{ fontSize: 12 }} type={hasShower ? undefined : 'secondary'}>
                                      Shower valve + trim (standalone shower){!hasShower && ' — shower 없음'}
                                    </Text>
                                  </Checkbox>
                                </Form.Item>
                              );
                            }}
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={16} md={12}>
                          <Form.Item name={['hidden_costs', 'exclude_trim_kit']} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox><Text style={{ fontSize: 12 }}>Exclude trim kit (보험사 불인정 시)</Text></Checkbox>
                          </Form.Item>
                        </Col>
                      </Row>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                        D&R fixture가 있으면 shutoff valve, supply line이 자동 추가됩니다. 위 필드에 수동 입력 시 자동 계산이 무시됩니다.
                      </Text>
                    </div>
                  </Panel>
                  <Panel header="Electrical" key="electrical">
                    <Row gutter={16}>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="GFCI Outlets" name={['electrical_spec', 'gfci_count']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Fan CFM" name={['electrical_spec', 'exhaust_fan_cfm']}>
                          <Select
                            options={numOpts(pricingInfo?.exhaust_fan_cfms)}
                            allowClear
                            placeholder="None"
                            onChange={(v) => {
                              if (v && !form.getFieldValue(['electrical_spec', 'exhaust_fan_switch'])) {
                                form.setFieldValue(['electrical_spec', 'exhaust_fan_switch'], 'standard');
                              }
                            }}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Fan Switch" name={['electrical_spec', 'exhaust_fan_switch']}>
                          <Select options={selectOpts(pricingInfo?.exhaust_fan_switch_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['electrical_spec', 'inspection']} valuePropName="checked">
                          <Checkbox>Inspection</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={5}>
                        <Form.Item name={['electrical_spec', 'megohmmeter_check']} valuePropName="checked">
                          <Checkbox>Megohmmeter Check</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                    <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12 }}>
                      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Auto-include (uncheck to disable)</Text>
                      <Row gutter={[16, 4]}>
                        <Col xs={12} sm={8} md={6}>
                          <Form.Item name={['hidden_costs', 'auto_gfci']} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox onChange={(e) => {
                              if (e.target.checked) {
                                if (!form.getFieldValue(['electrical_spec', 'gfci_count'])) {
                                  form.setFieldValue(['electrical_spec', 'gfci_count'], 1);
                                }
                              } else {
                                form.setFieldValue(['electrical_spec', 'gfci_count'], undefined);
                              }
                            }}><Text style={{ fontSize: 12 }}>GFCI outlet</Text></Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={6}>
                          <Form.Item name={['hidden_costs', 'auto_exhaust_fan']} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox onChange={(e) => {
                              if (e.target.checked) {
                                if (!form.getFieldValue(['electrical_spec', 'exhaust_fan_cfm'])) {
                                  form.setFieldValue(['electrical_spec', 'exhaust_fan_cfm'], 80);
                                }
                                if (!form.getFieldValue(['electrical_spec', 'exhaust_fan_switch'])) {
                                  form.setFieldValue(['electrical_spec', 'exhaust_fan_switch'], 'standard');
                                }
                              } else {
                                form.setFieldValue(['electrical_spec', 'exhaust_fan_cfm'], undefined);
                                form.setFieldValue(['electrical_spec', 'exhaust_fan_switch'], undefined);
                              }
                            }}><Text style={{ fontSize: 12 }}>Exhaust fan</Text></Checkbox>
                          </Form.Item>
                        </Col>
                      </Row>
                    </div>
                  </Panel>
                  <Panel header="Permit Triggers" key="permits">
                    <Row gutter={[16, 4]}>
                      {[
                        ['valve_body_replace', 'Shower valve body replacement'],
                        ['fixture_relocation', 'Fixture location change'],
                        ['new_plumbing_line', 'New plumbing line'],
                        ['new_electrical_circuit', 'New electrical circuit'],
                      ].map(([key, label]) => (
                        <Col xs={12} sm={12} key={key}>
                          <Form.Item name={['hidden_costs', key]} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox><Text style={{ fontSize: 12 }}>{label}</Text></Checkbox>
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                      Check items that trigger permit requirements. Permit fee auto-included when any trigger is checked.
                    </Text>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 7: Accessories & Costs ════════
          {
            key: 'accessories',
            forceRender: true,
            label: 'Accessories & Costs',
            children: (
              <Card className="be-tab-card">
                <Collapse defaultActiveKey={['acc', 'hidden', 'overview']}>
                  <Panel header="Accessories" key="acc">
                    <Form.Item noStyle shouldUpdate={(prev: any, cur: any) =>
                      prev?.accessories_spec?.action !== cur?.accessories_spec?.action
                    }>
                      {() => {
                        const accAction = form.getFieldValue(['accessories_spec', 'action']) || 'replace';
                        return (
                          <>
                            <Row gutter={16} align="middle" style={{ marginBottom: 12 }}>
                              <Col xs={24} sm={12} md={8}>
                                <Text strong style={{ marginRight: 8 }}>Action:</Text>
                                <Radio.Group
                                  value={accAction}
                                  onChange={(e) => form.setFieldsValue({
                                    accessories_spec: { ...form.getFieldValue('accessories_spec'), action: e.target.value }
                                  })}
                                >
                                  <Radio.Button value="replace">Replace (New)</Radio.Button>
                                  <Radio.Button value="detach_reset">D&R</Radio.Button>
                                  <Radio.Button value="none">None</Radio.Button>
                                </Radio.Group>
                              </Col>
                              {accAction === 'replace' && (
                                <>
                                  <Col xs={12} sm={6} md={4}>
                                    <Form.Item label="Finish" name={['accessories_spec', 'finish']} style={{ marginBottom: 0 }}>
                                      <Select options={selectOpts(pricingInfo?.accessory_finishes)} allowClear />
                                    </Form.Item>
                                  </Col>
                                  <Col xs={12} sm={6} md={4}>
                                    <Form.Item label="Grade" name={['accessories_spec', 'grade']} style={{ marginBottom: 0 }}>
                                      <Select options={selectOpts(pricingInfo?.accessory_grades)} allowClear />
                                    </Form.Item>
                                  </Col>
                                </>
                              )}
                            </Row>
                            <Row gutter={16}>
                              {[
                                ['towel_bars', 'Towel Bars'],
                                ['hand_towel_rings', 'Hand Towel Rings'],
                                ['tp_holders', 'TP Holders'],
                                ['robe_hooks', 'Robe Hooks'],
                                ['grab_bars', 'Grab Bars'],
                                ['corner_shelves', 'Corner Shelves'],
                              ].map(([key, label]) => (
                                <Col xs={12} sm={8} md={4} key={key}>
                                  <Form.Item label={label} name={['accessories_spec', key]}>
                                    <InputNumber style={{ width: '100%' }} min={0} max={10} />
                                  </Form.Item>
                                </Col>
                              ))}
                            </Row>
                            {accAction === 'detach_reset' && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                D&R: Remove existing accessories, store during work, reinstall. Labor only, no new material.
                              </Text>
                            )}
                          </>
                        );
                      }}
                    </Form.Item>
                  </Panel>
                  <Panel header="Optional Costs" key="optional-costs">
                    <Row gutter={[16, 8]}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item name={['hidden_costs', 'mobilization']} valuePropName="checked" style={{ marginBottom: 4 }}>
                          <Checkbox>Mobilization / Setup</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                      Dumpster, floor protection, caulking, and final clean are always included in the estimate.
                    </Text>
                  </Panel>
                  <Panel header="Overview & O&P" key="overview">
                    <Row gutter={16}>
                      <Col xs={24} md={16}>
                        <Form.Item label={
                          <Space>
                            Overview Note
                            <Tooltip title="Auto-generate overview based on estimate specs">
                              <Button size="small" icon={<RobotOutlined />}
                                onClick={() => overviewMutation.mutate()}
                                loading={overviewMutation.isPending}>
                                Generate
                              </Button>
                            </Tooltip>
                          </Space>
                        } name="overview_text">
                          <TextArea rows={6} placeholder="Project overview for client-facing PDF..." />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain>Overhead & Profit (Optional)</Divider>
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item name="include_overhead_profit" valuePropName="checked">
                          <Checkbox>Include O&P</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Overhead %" name="overhead_pct">
                          <InputNumber style={{ width: '100%' }} min={0} max={0.5} step={0.01}
                            formatter={v => `${((v || 0) * 100).toFixed(0)}%`}
                            parser={v => parseFloat(v?.replace('%', '') || '0') / 100 as any} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Profit %" name="profit_pct">
                          <InputNumber style={{ width: '100%' }} min={0} max={0.5} step={0.01}
                            formatter={v => `${((v || 0) * 100).toFixed(0)}%`}
                            parser={v => parseFloat(v?.replace('%', '') || '0') / 100 as any} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain><AimOutlined /> Target Total (Reverse Pricing)</Divider>
                    <Alert
                      message="Set a desired total and all line items will scale proportionally when you Calculate. The final total will always meet or exceed the target."
                      type="info"
                      showIcon
                      style={{ marginBottom: 16 }}
                    />
                    <Row gutter={16} align="middle">
                      <Col xs={24} sm={12} md={6}>
                        <Form.Item label="Target Total ($)" name="target_total">
                          <InputNumber
                            style={{ width: '100%' }}
                            min={0}
                            step={1000}
                            formatter={(v) => v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                            parser={(v) => (v ? Number(v.replace(/,/g, '')) : 0) as any}
                            placeholder="e.g. 12000"
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        {estimate?.adjustment_factor && (
                          <Statistic
                            title="Adjustment Factor"
                            value={estimate.adjustment_factor}
                            precision={4}
                            suffix="x"
                            valueStyle={{
                              color: estimate.adjustment_factor > 1 ? '#cf1322' : '#3f8600',
                              fontSize: 16,
                            }}
                          />
                        )}
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Button
                          type="dashed"
                          onClick={() => {
                            form.setFieldsValue({ target_total: null });
                            message.info('Target total cleared. Click Calculate to restore original pricing.');
                          }}
                        >
                          Clear Target
                        </Button>
                      </Col>
                    </Row>

                    <Row gutter={16}>
                      <Col xs={24} md={16}>
                        <Form.Item label="Notes" name="notes">
                          <TextArea rows={3} placeholder="Internal notes..." />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 8: Result ════════
          {
            key: 'result',
            forceRender: true,
            label: `Result${estimate?.total ? ` ($${Math.round(estimate.total).toLocaleString('en-US')})` : ''}`,
            children: (
              <Card className="be-tab-card">
                {estimate?.kind === 'option' && (
                  <BELayoutChanges
                    estimateId={estimate.id}
                    isRemodel={estimate.project_type === 'remodel'}
                    skips={layoutSkips}
                    onSkipsChange={(next) => {
                      form.setFieldValue(['plumbing_spec', 'layout_change_skips'], next);
                      unsavedRef.current = true;
                    }}
                  />
                )}
                {lineItems.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Text type="secondary">
                      {isCurrentLayout
                        ? 'The current layout isn’t priced.'
                        : 'No calculation yet. Click "Calculate" to generate line items.'}
                    </Text>
                  </div>
                ) : (
                  <>
                    {/* Phase summary */}
                    <Card size="small" style={{ marginBottom: 16, background: '#f7fafc' }}>
                      <Title level={5}>Phase Summary</Title>
                      {phaseSummary.map(p => (
                        <Row key={p.phase} justify="space-between" style={{ padding: '4px 0' }}>
                          <Col><Text>{p.phase}. {p.label}</Text></Col>
                          <Col><Text strong>${p.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text></Col>
                        </Row>
                      ))}
                      <Divider style={{ margin: '8px 0' }} />
                      <Row justify="space-between">
                        <Col><Text strong>Subtotal</Text></Col>
                        <Col><Text strong>${(estimate?.subtotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text></Col>
                      </Row>
                      {estimate?.include_overhead_profit && (
                        <Row justify="space-between">
                          <Col><Text type="secondary" style={{ fontSize: 12 }}>
                            O&P {((estimate?.overhead_pct || 0) * 100).toFixed(0)}% + {((estimate?.profit_pct || 0) * 100).toFixed(0)}% (included in line items)
                          </Text></Col>
                        </Row>
                      )}
                      {/* Material tax is loaded into line item pricing and is
                          never shown as a separate charge (lump-sum contract:
                          the contractor is the final consumer). */}
                      <Divider style={{ margin: '8px 0' }} />
                      <Row justify="space-between">
                        <Col><Title level={4} style={{ margin: 0 }}>GRAND TOTAL</Title></Col>
                        <Col><Title level={4} style={{ margin: 0 }}>${(estimate?.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Title></Col>
                      </Row>
                    </Card>

                    {estimate?.target_total && estimate?.adjustment_factor && (
                      <Alert
                        message={`Target: $${estimate.target_total.toLocaleString()} | Factor: ${estimate.adjustment_factor.toFixed(4)}x`}
                        type="info"
                        showIcon
                        style={{ marginBottom: 12 }}
                      />
                    )}

                    <PriceBookNotice
                      domain="bathroom"
                      estimateId={id!}
                      priceBook={estimate?.price_book}
                      refreshKeys={[
                        ['bathroom-estimate', id], ['bathroom-estimate-group'], ['bathroom-estimates'],
                        ['bathroom-estimate-history', id], ['bathroom-layout-changes', id], ['bathroom-pricing-info', id],
                      ]}
                    />

                    {/* Methodology */}
                    {estimate?.methodology_notes && (
                      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
                        {estimate.methodology_notes}
                      </Text>
                    )}

                    {/* Warnings */}
                    {(estimate?.warning_flags || []).length > 0 && (
                      <Card size="small" style={{ marginBottom: 16, borderColor: '#faad14' }}>
                        <Title level={5} style={{ color: '#faad14' }}>Warnings</Title>
                        {estimate!.warning_flags!.map((w, i) => (
                          <Text key={i} style={{ display: 'block' }}>⚠ {w}</Text>
                        ))}
                      </Card>
                    )}

                    {/* Detailed line items grouped by phase */}
                    <Collapse
                      className="be-phases"
                      defaultActiveKey={phaseSummary.map(p => String(p.phase))}
                      style={{ background: 'transparent' }}
                    >
                      {phaseSummary.map(p => {
                        const phaseItems = lineItems.filter(li => li.phase === p.phase);
                        return (
                          <Panel
                            header={
                              <Row justify="space-between" align="middle" style={{ width: '100%', paddingRight: 8 }}>
                                <Col><Text strong>Phase {p.phase}: {p.label}</Text> {!isPhone && <Tag>{p.count} items</Tag>}</Col>
                                <Col>
                                  <Space>
                                    <Text strong>${p.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                                    <Popconfirm
                                      title={`Delete Phase ${p.phase}: ${p.label}?`}
                                      description="All items in this phase will be removed and remaining phases will be renumbered."
                                      onConfirm={(e) => { e?.stopPropagation(); lineItemMutation.mutate({ action: 'deletePhase', phase: p.phase }); }}
                                      onCancel={(e) => e?.stopPropagation()}
                                      okButtonProps={{ danger: true, loading: lineItemMutation.isPending }}
                                    >
                                      <Button type="text" size="small" danger icon={<DeleteOutlined />}
                                        onClick={(e) => e.stopPropagation()} />
                                    </Popconfirm>
                                  </Space>
                                </Col>
                              </Row>
                            }
                            key={String(p.phase)}
                          >
                            {isPhone ? (
                              // One row per item: tap it to edit
                              <div className="be-li-rows">
                                {phaseItems.map(li => (
                                  <div key={li.id} className="ui-row" onClick={() => setEditingItem({ ...li })}>
                                    <div className="ui-row-body">
                                      <span className="ui-row-title">{li.description}</span>
                                      <div className="be-li-figures">
                                        <span>{li.quantity?.toFixed(1)} {li.unit} × ${li.unit_price?.toFixed(2)}</span>
                                        <span className="be-li-total">
                                          ${li.total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </span>
                                      </div>
                                    </div>
                                    {/* The confirm renders in a portal, but its clicks still bubble to the row */}
                                    <span onClick={(e) => e.stopPropagation()}>
                                      <Popconfirm title="Delete this item?" onConfirm={() => lineItemMutation.mutate({ action: 'delete', itemId: li.id })}
                                        okButtonProps={{ loading: lineItemMutation.isPending }}>
                                        <Button type="text" danger icon={<DeleteOutlined />} aria-label="Delete item" />
                                      </Popconfirm>
                                    </span>
                                  </div>
                                ))}
                                <div className="be-li-subtotal">
                                  <span>Phase {p.phase} Subtotal</span>
                                  <span>${p.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                </div>
                              </div>
                            ) : (
                              <Table
                                columns={lineItemColumns}
                                dataSource={phaseItems}
                                rowKey="id"
                                size="small"
                                pagination={false}
                                scroll={{ x: 600 }}
                                summary={() => (
                                  <Table.Summary.Row>
                                    <Table.Summary.Cell index={0} colSpan={4}>
                                      <Text strong>Phase {p.phase} Subtotal</Text>
                                    </Table.Summary.Cell>
                                    <Table.Summary.Cell index={4} align="right">
                                      <Text strong>${p.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                                    </Table.Summary.Cell>
                                    <Table.Summary.Cell index={5} />
                                  </Table.Summary.Row>
                                )}
                              />
                            )}
                            <Button type="dashed" size="small" icon={<PlusOutlined />}
                              style={isPhone ? { margin: 12 } : { marginTop: 8 }}
                              onClick={() => setAddingPhase(p.phase)}>
                              Add Item
                            </Button>
                          </Panel>
                        );
                      })}
                    </Collapse>

                    {/* Edit Line Item Modal */}
                    <Modal
                      title="Edit Line Item"
                      open={!!editingItem}
                      onCancel={() => setEditingItem(null)}
                      onOk={() => {
                        if (!editingItem) return;
                        const { id: itemId, estimate_id: _eid, created_at: _ca, display_order: _do, ...updates } = editingItem;
                        updates.total = round2(updates.quantity * updates.unit_price);
                        lineItemMutation.mutate({ action: 'update', itemId, data: updates });
                      }}
                      confirmLoading={lineItemMutation.isPending}
                      destroyOnHidden
                      className="be-modal"
                      {...sheetProps}
                    >
                      {editingItem && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>Description</Text>
                            <Input value={editingItem.description}
                              onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })} />
                          </div>
                          <Row gutter={[12, 12]}>
                            <Col xs={12} sm={6}>
                              <Text type="secondary" style={{ fontSize: 12 }}>Phase</Text>
                              <InputNumber style={{ width: '100%' }} min={1} max={10}
                                value={editingItem.phase}
                                onChange={(v) => setEditingItem({ ...editingItem, phase: v })} />
                            </Col>
                            <Col xs={12} sm={6}>
                              <Text type="secondary" style={{ fontSize: 12 }}>Qty</Text>
                              <InputNumber style={{ width: '100%' }} min={0} step={0.1}
                                value={editingItem.quantity}
                                onChange={(v) => setEditingItem({ ...editingItem, quantity: v })} />
                            </Col>
                            <Col xs={12} sm={6}>
                              <Text type="secondary" style={{ fontSize: 12 }}>Unit</Text>
                              <Select style={{ width: '100%' }} value={editingItem.unit}
                                onChange={(v) => setEditingItem({ ...editingItem, unit: v })}
                                options={['EA', 'SF', 'LF', 'HR', 'LS'].map(u => ({ label: u, value: u }))} />
                            </Col>
                            <Col xs={12} sm={6}>
                              <Text type="secondary" style={{ fontSize: 12 }}>Rate</Text>
                              <InputNumber style={{ width: '100%' }} min={0} step={1} prefix="$"
                                value={editingItem.unit_price}
                                onChange={(v) => setEditingItem({ ...editingItem, unit_price: v })} />
                            </Col>
                          </Row>
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              Total: <Text strong>${round2((editingItem.quantity || 0) * (editingItem.unit_price || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                            </Text>
                          </div>
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>Notes</Text>
                            <TextArea rows={4} value={editingItem.notes || ''}
                              onChange={(e) => setEditingItem({ ...editingItem, notes: e.target.value })} />
                          </div>
                        </div>
                      )}
                    </Modal>

                    {/* Add Line Item Modal */}
                    <Modal
                      title={`Add Item to Phase ${addingPhase}`}
                      open={addingPhase !== null}
                      onCancel={() => setAddingPhase(null)}
                      onOk={() => {
                        if (addingPhase === null) return;
                        const descEl = document.getElementById('add-li-desc') as HTMLInputElement;
                        const qtyEl = document.getElementById('add-li-qty') as HTMLInputElement;
                        const rateEl = document.getElementById('add-li-rate') as HTMLInputElement;
                        const unitEl = document.getElementById('add-li-unit') as HTMLInputElement;
                        const notesEl = document.getElementById('add-li-notes') as HTMLTextAreaElement;
                        const desc = descEl?.value?.trim();
                        if (!desc) { message.warning('Description is required'); return; }
                        const qty = parseFloat(qtyEl?.value) || 1;
                        const rate = parseFloat(rateEl?.value) || 0;
                        lineItemMutation.mutate({
                          action: 'add',
                          data: {
                            phase: addingPhase,
                            description: desc,
                            quantity: qty,
                            unit: unitEl?.value || 'EA',
                            unit_price: rate,
                            notes: notesEl?.value || undefined,
                          },
                        });
                      }}
                      confirmLoading={lineItemMutation.isPending}
                      destroyOnHidden
                      className="be-modal"
                      {...sheetProps}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>Description *</Text>
                          <Input id="add-li-desc" placeholder="Line item description" />
                        </div>
                        <Row gutter={12}>
                          <Col span={8}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Qty</Text>
                            <Input id="add-li-qty" defaultValue="1" type="number" />
                          </Col>
                          <Col span={8}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Unit</Text>
                            <Input id="add-li-unit" defaultValue="EA" />
                          </Col>
                          <Col span={8}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Rate ($)</Text>
                            <Input id="add-li-rate" defaultValue="0" type="number" />
                          </Col>
                        </Row>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>Notes</Text>
                          <TextArea id="add-li-notes" rows={4} placeholder="Optional notes" />
                        </div>
                      </div>
                    </Modal>
                  </>
                )}
              </Card>
            ),
          },

          // ════════ TAB 9: History ════════
          {
            key: 'history',
            label: 'History',
            children: (
              <Card className="be-tab-card">
                {(history || []).length === 0 ? (
                  <Text type="secondary">No history yet.</Text>
                ) : (
                  <Timeline
                    items={(history || []).map((h: BathroomEstimateHistory) => ({
                      children: (
                        <div>
                          <Text strong>v{h.version_number}</Text>
                          <Text type="secondary" style={{ marginLeft: 8 }}>
                            {h.change_description}
                          </Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {h.created_at ? new Date(h.created_at).toLocaleString() : ''}
                          </Text>
                        </div>
                      ),
                    }))}
                  />
                )}
              </Card>
            ),
          },
        ]} />
      </Form>

      {isPhone && (
        <div className="be-action-bar">
          <Button icon={<SaveOutlined />} onClick={handleSave} loading={saveMutation.isPending}>
            Save
          </Button>
          {!isCurrentLayout && (
            <Button type="primary" icon={<CalculatorOutlined />} onClick={handleCalculate}
              loading={calculateMutation.isPending}>
              Calculate
            </Button>
          )}
        </div>
      )}

    </div>
  );
};

/**
 * Each estimate of a job opens at its own URL. Switching between them starts
 * the page fresh, so no form field, sketch or tab state carries across.
 */
const BathroomEstimateDetailRoute: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return <BathroomEstimateDetail key={id} />;
};

export default BathroomEstimateDetailRoute;
