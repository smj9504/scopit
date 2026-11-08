import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Dropdown,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Tooltip,
  Typography,
} from 'antd';
import {
  CheckOutlined,
  DownOutlined,
  MoreOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cabinetEstimateService } from '@/services/cabinetEstimateService';
import { useBackNav } from '@/hooks/useHeaderNav';
import {
  AddressField,
  CustomerField,
  Pill,
  addressOfCustomer,
  humanize,
  type TagTone,
} from '@/components/features/tools/cabinet-estimate/jobFields';
import CabinetBoxEditor, {
  CABINET_PRESETS,
  TIER_WALL_HEIGHT,
  boxesAtWallHeight,
  mainWallHeight,
  wallHeightForTier,
  type WallHeightFilter,
} from '@/components/features/tools/cabinet-estimate/CabinetBoxEditor';
import CabinetEstimateResult from '@/components/features/tools/cabinet-estimate/CabinetEstimateResult';
import CabinetPurchaseOrder from '@/components/features/tools/cabinet-estimate/CabinetPurchaseOrder';
import CabinetEstimateHistory from '@/components/features/tools/cabinet-estimate/CabinetEstimateHistory';
import CabinetSketchEditor from '@/components/features/tools/cabinet-estimate/sketch/CabinetSketchEditor';
import KitchenDesignQuoteModal from '@/components/features/tools/cabinet-estimate/KitchenDesignQuoteModal';
import KitchenGroupBar, { KitchenJobType } from '@/components/features/tools/cabinet-estimate/KitchenGroupBar';
import KitchenGroupCompareDrawer from '@/components/features/tools/cabinet-estimate/KitchenGroupCompareDrawer';
import KitchenSelections from '@/components/features/tools/cabinet-estimate/KitchenSelections';
import { boxKey } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import type { BoxFields } from '@/components/features/tools/cabinet-estimate/cabinetBoxChoices';
import { TRIM_FIELDS, TRIM_FIELD_LABELS } from '@/components/features/tools/cabinet-estimate/sketch/cabinetTrimTakeoff';
import type { CabinetBoxCreate, CabinetEstimate, CabinetEstimateUpdate } from '@/types/cabinetEstimate';
import { memberName } from '@/types/cabinetEstimate';
import type { CabinetTier } from '@/types/cabinetEstimate';
import { CABINET_TOOL_PATH } from '@/components/features/tools/cabinet-estimate/paths';
import '@/components/features/tools/cabinet-estimate/cabinetEstimate.css';

const { Title, Text } = Typography;

const STATUS_TONES: Record<string, TagTone> = {
  draft: 'gray',
  calculated: 'blue',
  approved: 'green',
  exported: 'purple',
};
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Appliance Selector (inline component) ──
interface ApplianceOption { type: string; label: string; cost: number }
interface ApplianceSelectorProps {
  value?: { type: string; qty: number }[];
  onChange?: (val: { type: string; qty: number }[]) => void;
  options: ApplianceOption[];
}
const ApplianceSelector: React.FC<ApplianceSelectorProps> = ({ value = [], onChange, options }) => {
  const toggle = (type: string, checked: boolean) => {
    if (checked) {
      onChange?.([...value, { type, qty: 1 }]);
    } else {
      onChange?.(value.filter((v) => v.type !== type));
    }
  };
  const setQty = (type: string, qty: number) => {
    onChange?.(value.map((v) => (v.type === type ? { ...v, qty } : v)));
  };
  return (
    <Row gutter={[8, 4]}>
      {options.map((opt) => {
        const item = value.find((v) => v.type === opt.type);
        const checked = !!item;
        return (
          <Col xs={12} md={8} key={opt.type}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Checkbox checked={checked} onChange={(e) => toggle(opt.type, e.target.checked)}>
                <span style={{ fontSize: 12 }}>{opt.label}</span>
              </Checkbox>
              {checked && (
                <InputNumber
                  size="small" min={1} max={5} value={item?.qty || 1}
                  onChange={(v) => setQty(opt.type, v || 1)}
                  style={{ width: 50, fontSize: 12 }}
                />
              )}
              <Text type="secondary" style={{ fontSize: 12 }}>${opt.cost}</Text>
            </div>
          </Col>
        );
      })}
    </Row>
  );
};

// ── Price-table fallbacks ──
// The rates shown on this form are served by GET /cabinet-estimates/pricing-info
// so they can never drift from what the backend actually charges. These copies
// only cover the window before that query resolves.
const FALLBACK_APPLIANCES: ApplianceOption[] = [
  { type: 'dishwasher', label: 'Dishwasher', cost: 449 },
  { type: 'refrigerator', label: 'Refrigerator', cost: 165 },
  { type: 'range_gas', label: 'Range (Gas) - Freestanding', cost: 307 },
  { type: 'range_electric', label: 'Range (Electric) - Freestanding', cost: 138 },
  { type: 'range_gas_slide', label: 'Range (Gas) - Slide-in', cost: 305 },
  { type: 'range_electric_slide', label: 'Range (Electric) - Slide-in', cost: 139 },
  { type: 'range_dropin', label: 'Range - Drop-in', cost: 300 },
  { type: 'cooktop_gas', label: 'Cooktop (Gas)', cost: 165 },
  { type: 'cooktop_electric', label: 'Cooktop (Electric)', cost: 136 },
  { type: 'wall_oven', label: 'Wall Oven', cost: 167 },
  { type: 'microwave_otr', label: 'Microwave (Over-the-Range)', cost: 94 },
  { type: 'hood_vent', label: 'Range Hood', cost: 202 },
  { type: 'hood_wood_42', label: 'Wood Range Hood (42"+)', cost: 526 },
  { type: 'garbage_disposal', label: 'Garbage Disposal', cost: 305 },
];
const FALLBACK_COUNTERTOP_RATES: Record<string, number> = {
  Laminate: 35, 'Butcher Block': 70, 'Solid Surface': 95,
  Granite: 95, Quartz: 110, Quartzite: 130, Marble: 160,
};
const FALLBACK_CT_BACKSPLASH_PER_LF: Record<string, number> = {
  Laminate: 12, 'Solid Surface': 22, 'Butcher Block': 18,
  Granite: 28, Quartz: 32, Quartzite: 38, Marble: 45,
};
const FALLBACK_SCOPE_RATES: Record<string, number> = {
  sink_single_supply: 305, sink_double_supply: 458,
  drywall_patch_per_sf: 2.75, drywall_rr_per_sf: 5.0,
};

// Island panel heights offered in the End/Back Panel selectors, in feet.
// Islands are built at base-cabinet (34.5"), work (36") or bar (42") height;
// 84" covers a full-height panel.
const ISLAND_PANEL_HEIGHTS: { label: string; value: number }[] = [
  { label: '34.5" (Base Cabinet)', value: 2.875 },
  { label: '36" (Counter Height)', value: 3 },
  { label: '42" (Bar Height)', value: 3.5 },
  { label: '84" (Full Height)', value: 7 },
];

// ── Side by side ──
// On a wide screen the Edit form and the Sketch share one screen: the sketch
// pinned on the left at the window's height, the form scrolling on the right.
// Narrower, or by choice, they are two tabs as before.
const SIDE_BY_SIDE_MIN_WIDTH = 1400;
const VIEW_KEY = 'cabinet-estimate.view';
// The panel beside the drawing (Inspect / Cabinets / Estimate), in px.
const PANEL_WIDTH_KEY = 'cabinet-estimate.panel-width';
const DEFAULT_PANEL_WIDTH = 400;
const clampPanelWidth = (w: number) => Math.min(640, Math.max(340, Math.round(w)));
type PanelTab = 'inspect' | 'cabinets' | 'estimate';
const PANEL_TABS: { key: PanelTab; label: string }[] = [
  { key: 'inspect', label: 'Inspect' },
  { key: 'cabinets', label: 'Cabinets' },
  { key: 'estimate', label: 'Estimate' },
];
const readStored = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStored = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked (a private window): the choice just isn't remembered.
  }
};

function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

// Beside the drawing, the seldom-changed sections of the Estimate panel
// start folded to a one-line summary.
const FOLDABLE_SECTIONS = ['client', 'project', 'drywall', 'backsplash'];
const sectionId = (key: string) => `cabinet-section-${key}`;

/** A section title that folds its card, showing a one-line summary while folded. */
const FoldTitle: React.FC<{ title: string; summary?: string; folded: boolean; onToggle: () => void }> = ({
  title,
  summary,
  folded,
  onToggle,
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={!folded}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      width: '100%',
      minWidth: 0,
      padding: 0,
      border: 0,
      background: 'none',
      font: 'inherit',
      color: 'inherit',
      cursor: 'pointer',
      textAlign: 'left',
    }}
  >
    <RightOutlined rotate={folded ? 0 : 90} style={{ fontSize: 12, color: '#6b7280' }} />
    <span>{title}</span>
    {folded && summary && (
      <Text type="secondary" ellipsis style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 400 }}>
        {summary}
      </Text>
    )}
  </button>
);

const CabinetEstimateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  useBackNav('Cabinet Estimator', CABINET_TOOL_PATH);
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [designQuoteFor, setDesignQuoteFor] = useState<string | null>(null);
  const [perimeterBoxes, setPerimeterBoxes] = useState<CabinetBoxCreate[]>([]);
  const [islandBoxes, setIslandBoxes] = useState<CabinetBoxCreate[]>([]);
  // Bumped when the sketch adds, swaps or deletes a cabinet, so the box list is saved (see saveSketchBoxes).
  const [sketchBoxEdits, setSketchBoxEdits] = useState(0);
  // The cached estimate as the sketch's box save left it: the form and box
  // list already hold that (or newer), so it isn't loaded back into them.
  const selfSavedEstimateRef = useRef<CabinetEstimate | undefined>(undefined);
  // Height of the uppers the wall-cabinet pickers list, in both the Edit and Sketch tabs. It opens at
  // the height this estimate's uppers already are (else the Tier's), goes to the Tier's when that
  // changes, and can be set by hand.
  const tier: string | undefined = Form.useWatch('tier', { form, preserve: true });
  const [wallHeight, setWallHeight] = useState<WallHeightFilter>('all');
  // The estimate the height was last opened at, so a save's reload doesn't undo a height set by hand.
  const wallHeightOpenedFor = useRef<string | undefined>(undefined);
  // Cabinets on both sides of the island, back to back (saved with the estimate): no back
  // panel, ends twice as deep, a top half as long and twice as deep, and the Sketch lays
  // the island out in two rows. preserve: its checkbox only shows with island cabinets.
  const islandTwoSided: boolean = Form.useWatch('island_two_sided', { form, preserve: true }) ?? false;
  // Island top: seating overhang (inches, 0 = 1.5" edge only; saved with the estimate). It
  // shapes the suggested island countertop SF and supports here, and the Sketch's island
  // top. Back to back, neither long side is free for seating, so it counts as none.
  const islandSeatingSet: number = Form.useWatch('island_seating_overhang_in', form) ?? 0;
  const islandSeatingIn = islandTwoSided ? 0 : islandSeatingSet;
  // What the Sketch draws besides the cabinets: the detach & reset appliances and the sink's bowls.
  // preserve: the appliance list's field is only mounted while Appliance Detach & Reset is ticked.
  const includeApplianceRr: boolean = Form.useWatch('include_appliance_rr', form) ?? false;
  const applianceList: { type: string; qty: number }[] | undefined = Form.useWatch('appliance_list', { form, preserve: true });
  const sinkType: string | undefined = Form.useWatch('sink_type', { form, preserve: true });
  const crownMolding: boolean = Form.useWatch('include_crown_molding', { form, preserve: true }) ?? false;
  const doorStyle: string | undefined = Form.useWatch('door_style', { form, preserve: true });
  // The backsplashes the Sketch draws: the tile at its height, and the 4" countertop one (with the countertop).
  const includeBacksplash: boolean = Form.useWatch('include_backsplash', { form, preserve: true }) ?? false;
  const backsplashHeightIn: number = Form.useWatch('backsplash_height_inches', { form, preserve: true }) || 18;
  const includeCountertop: boolean = Form.useWatch('include_countertop', { form, preserve: true }) ?? false;
  const includeCtBacksplash: boolean = Form.useWatch('include_countertop_backsplash', { form, preserve: true }) ?? false;
  const sketchBacksplash = useMemo(
    () => ({ tileIn: includeBacksplash ? backsplashHeightIn : null, counter: includeCountertop && includeCtBacksplash }),
    [includeBacksplash, backsplashHeightIn, includeCountertop, includeCtBacksplash]
  );
  const sketchAppliances = useMemo(
    () => (includeApplianceRr ? applianceList ?? [] : []),
    [includeApplianceRr, applianceList]
  );
  // Opening another estimate of the job keeps the tab you were on
  const [activeTab, setActiveTab] = useState<string>(
    (location.state as { tab?: string } | null)?.tab || 'edit'
  );
  // Edits made on this page since the last save or calculate: typed into the
  // form or made to the box lists. Fields the page fills in itself don't count.
  const unsavedRef = useRef(false);
  // Flags new edits: unsaved until saved, and the total stale until calculated.
  const markDirtyRef = useRef<() => void>(() => {});
  const [compareOpen, setCompareOpen] = useState(false);

  // ── Side by side (see SIDE_BY_SIDE_MIN_WIDTH) ──
  const wideScreen = useMinWidth(SIDE_BY_SIDE_MIN_WIDTH);
  const [viewChoice, setViewChoice] = useState<'split' | 'tabs'>(() => (readStored(VIEW_KEY) === 'tabs' ? 'tabs' : 'split'));
  const split = wideScreen && viewChoice === 'split';
  // The Sketch tab folds into Edit side by side.
  const shownTab = split && activeTab === 'sketch' ? 'edit' : activeTab;
  // The sketch mounts once it is first on screen, and stays.
  const [sketchMounted, setSketchMounted] = useState(false);
  if (!sketchMounted && (split || activeTab === 'sketch')) setSketchMounted(true);
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(Number(readStored(PANEL_WIDTH_KEY)) || DEFAULT_PANEL_WIDTH));
  const [draggingDivider, setDraggingDivider] = useState(false);
  useEffect(() => {
    if (!draggingDivider) writeStored(PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth, draggingDivider]);
  const [panelTab, setPanelTab] = useState<PanelTab>('inspect');
  // Where the sketch puts the selection's settings and the plan's counts (see its `inspector`).
  const [selectionEl, setSelectionEl] = useState<HTMLDivElement | null>(null);
  const [takeoffEl, setTakeoffEl] = useState<HTMLDivElement | null>(null);
  const [selectionCount, setSelectionCount] = useState(0);
  // Edits not saved yet (the form and the cabinet list), and edits since the total was last worked out.
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [sketchSave, setSketchSave] = useState<'saved' | 'saving' | 'dirty'>('saved');
  // The last save or calculation, read out by screen readers.
  const [announce, setAnnounce] = useState('');
  // Result and Purchase Order mount once opened, and stay.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<string>>(() => new Set([activeTab]));
  if (!visitedTabs.has(activeTab)) setVisitedTabs(new Set([...visitedTabs, activeTab]));
  // The split's height: from where it starts down to the window's bottom, so only the form scrolls.
  const splitRef = useRef<HTMLDivElement>(null);
  const formPaneRef = useRef<HTMLDivElement>(null);
  const [splitHeight, setSplitHeight] = useState(640);
  // The page's Save saves the sketch too.
  const [sketchSaveSignal, setSketchSaveSignal] = useState(0);
  // Rows and cabinets linked side by side: the box keys picked on the sketch,
  // a row's cabinets to pick there, and the row under the pointer.
  const [linkedKeys, setLinkedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [pickKeys, setPickKeys] = useState<{ keys: string[]; seq: number } | null>(null);
  const [hintKey, setHintKey] = useState<string | null>(null);
  const rowPickRef = useRef<string | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(FOLDABLE_SECTIONS));

  // What a folded section says about itself.
  const watchedClaimNumber: string | undefined = Form.useWatch('claim_number', { form, preserve: true });
  const watchedAddress: string | undefined = Form.useWatch('property_address', { form, preserve: true });
  const watchedLayout: string | undefined = Form.useWatch('layout_type', { form, preserve: true });
  const watchedSize: number | undefined = Form.useWatch('kitchen_size_sqft', { form, preserve: true });
  const watchedCeiling: number | undefined = Form.useWatch('ceiling_height', { form, preserve: true });
  const includeDrywall: boolean = Form.useWatch('include_drywall_repair', { form, preserve: true }) ?? false;
  const drywallSf: number | undefined = Form.useWatch('drywall_repair_sqft', { form, preserve: true });
  const includePainting: boolean = Form.useWatch('include_painting', { form, preserve: true }) ?? false;
  const paintingSf: number | undefined = Form.useWatch('painting_sqft', { form, preserve: true });
  const backsplashType: string | undefined = Form.useWatch('backsplash_type', { form, preserve: true });
  const backsplashSf: number | undefined = Form.useWatch('backsplash_sqft', { form, preserve: true });
  const pricingBasis: string | undefined = Form.useWatch('pricing_basis', { form, preserve: true });
  const boxMaterial: string | undefined = Form.useWatch('box_material', { form, preserve: true });
  const finishName: string | undefined = Form.useWatch('finish', { form, preserve: true });
  const overlayStyle: string | undefined = Form.useWatch('overlay_style', { form, preserve: true });
  const islandType: string | undefined = Form.useWatch('island_type', { form, preserve: true });

  // Watch island panel SF values for reactive LF display
  const endPanelSf = Form.useWatch('island_end_panel_sqft', form) || 0;
  const backPanelSf = Form.useWatch('island_back_panel_sqft', form) || 0;
  // Island panel heights, in feet — the LF <-> SF conversion below is the
  // only place height is used; the backend stores panels as plain SF.
  // 34.5" is the base-cabinet panel, 36"/42" are work- and bar-height
  // islands, 84" is a full-height panel.
  const [endPanelHeight, setEndPanelHeight] = useState<number>(2.875);
  const [backPanelHeight, setBackPanelHeight] = useState<number>(2.875);

  // ── Fetch pricing options ──
  // The rates this estimate is priced with (its price book, or the company's today)
  const { data: pricingInfo } = useQuery({
    queryKey: ['cabinet-pricing-info', id],
    queryFn: () => cabinetEstimateService.getPricingInfo(id),
    staleTime: 1000 * 60 * 30,
  });

  // Rates quoted in the form labels, straight from pricing-info.
  const priceInfo = useMemo(() => {
    const flatRate = (key: string): number => {
      const v = pricingInfo?.scope_items?.[key];
      return typeof v === 'number' ? v : FALLBACK_SCOPE_RATES[key];
    };
    const ctRates: Record<string, number> = pricingInfo?.countertop_materials
      ? Object.fromEntries(
          Object.entries(pricingInfo.countertop_materials).map(([k, v]) => [k, v.rate])
        )
      : FALLBACK_COUNTERTOP_RATES;
    return {
      applianceOptions: pricingInfo?.appliance_rr_pricing
        ? Object.entries(pricingInfo.appliance_rr_pricing).map(([type, v]) => ({
            type, label: v.label, cost: v.cost,
          }))
        : FALLBACK_APPLIANCES,
      countertopOptions: Object.entries(ctRates)
        .sort((a, b) => a[1] - b[1])
        .map(([value, rate]) => ({ label: `${value} ($${rate}/SF)`, value })),
      ctBacksplashPerLf:
        pricingInfo?.countertop_backsplash_per_lf ?? FALLBACK_CT_BACKSPLASH_PER_LF,
      sinkOptions: [
        { label: `Single Bowl ($${flatRate('sink_single_supply')})`, value: 'single' },
        { label: `Double Bowl ($${flatRate('sink_double_supply')})`, value: 'double' },
      ],
      drywallOptions: [
        {
          label: `Patch & Repair ($${flatRate('drywall_patch_per_sf').toFixed(2)}/SF) — nail holes, minor damage`,
          value: 'patch',
        },
        {
          label: `R&R Sheetrock ($${flatRate('drywall_rr_per_sf').toFixed(2)}/SF) — full replace`,
          value: 'rr',
        },
      ],
    };
  }, [pricingInfo]);

  // ── Fetch estimate ──
  const { data: estimate, isLoading } = useQuery({
    queryKey: ['cabinet-estimate', id],
    queryFn: () => cabinetEstimateService.getById(id!),
    enabled: !!id,
  });

  // ── Populate form when estimate loads ──
  useEffect(() => {
    if (estimate && estimate !== selfSavedEstimateRef.current) {
      form.setFieldsValue({
        customer_id: estimate.customer_id ?? null,
        claim_number: estimate.claim_number ?? null,
        property_address: estimate.property_address,
        zip_code: estimate.zip_code,
        layout_type: estimate.layout_type,
        kitchen_size_sqft: estimate.kitchen_size_sqft,
        ceiling_height: estimate.ceiling_height,
        has_soffit: estimate.has_soffit,
        tier: estimate.tier,
        box_material: estimate.box_material,
        finish: estimate.finish,
        door_style: estimate.door_style,
        overlay_style: estimate.overlay_style || 'Full Overlay',
        pricing_basis: estimate.pricing_basis || 'INSURANCE_DR',
        include_demo: estimate.include_demo,
        include_install: estimate.include_install,
        include_delivery: estimate.include_delivery,
        include_plumbing: estimate.include_plumbing,
        sink_type: estimate.sink_type || 'single',
        include_aav: estimate.include_aav ?? false,
        include_air_gap: estimate.include_air_gap ?? false,
        include_soap_dispenser: estimate.include_soap_dispenser ?? false,
        include_instant_hot: estimate.include_instant_hot ?? false,
        include_dw_hookup: estimate.include_dw_hookup ?? false,
        include_countertop_reset: estimate.include_countertop_reset,
        include_hardware: estimate.include_hardware,
        include_crown_molding: estimate.include_crown_molding,
        include_backsplash: estimate.include_backsplash,
        backsplash_type: estimate.backsplash_type,
        backsplash_sqft: estimate.backsplash_sqft,
        backsplash_height_inches: 18,
        include_toe_kick: estimate.include_toe_kick ?? true,
        include_quarter_round: estimate.include_quarter_round ?? false,
        include_countertop: estimate.include_countertop,
        include_countertop_backsplash: estimate.include_countertop_backsplash ?? false,
        countertop_backsplash_lf: estimate.countertop_backsplash_lf,
        include_drywall_repair: estimate.include_drywall_repair,
        drywall_repair_type: estimate.drywall_repair_type || 'patch',
        drywall_repair_sqft: estimate.drywall_repair_sqft,
        include_painting: estimate.include_painting,
        painting_sqft: estimate.painting_sqft,
        include_appliance_rr: estimate.include_appliance_rr,
        appliance_list: estimate.appliance_list || [],
        include_dumpster: estimate.include_dumpster ?? true,
        include_electrical: estimate.include_electrical ?? false,
        include_permit: estimate.include_permit ?? false,
        filler_count: estimate.filler_count ?? 0,
        angled_joint_count: estimate.angled_joint_count ?? 0,
        island_seating_overhang_in: estimate.island_seating_overhang_in ?? 0,
        countertop_support_count: estimate.countertop_support_count ?? 0,
        end_panel_base: estimate.end_panel_counts?.base ?? 0,
        end_panel_wall: estimate.end_panel_counts?.wall ?? 0,
        end_panel_tall: estimate.end_panel_counts?.tall ?? 0,
        end_panel_refrigerator: estimate.end_panel_counts?.refrigerator ?? 0,
        dishwasher_return_panel_count:
          estimate.dishwasher_return_panel_count ?? 0,
        include_light_rail: estimate.include_light_rail ?? false,
        light_rail_lf: estimate.light_rail_lf ?? undefined,
        outlet_relocation_count: estimate.outlet_relocation_count ?? 0,
        delivery_floor: estimate.delivery_floor || 1,
        island_type: estimate.island_type || 'custom',
        island_prefab_size: estimate.island_prefab_size,
        island_prefab_price: estimate.island_prefab_price,
        island_end_panel_sqft: estimate.island_end_panel_sqft || 0,
        island_back_panel_sqft: estimate.island_back_panel_sqft || 0,
        island_two_sided: estimate.island_two_sided ?? false,
        countertop_material: estimate.countertop_material,
        countertop_sqft: estimate.countertop_sqft,
        island_countertop_material: estimate.island_countertop_material,
        island_countertop_sqft: estimate.island_countertop_sqft,
        overview_text: estimate.overview_text,
        target_total: estimate.target_total || null,
        overhead_pct: (estimate.overhead_pct ?? 0.15) * 100,
        profit_pct: (estimate.profit_pct ?? 0.15) * 100,
        notes: estimate.notes,
      });
      const allBoxes = estimate.boxes.map((b) => ({
        code: b.code,
        cab_type: b.cab_type,
        location: (b.location || 'perimeter') as 'perimeter' | 'island',
        width_inches: b.width_inches,
        height_inches: b.height_inches,
        is_specialty: b.is_specialty,
        specialty_type: b.specialty_type || null,
        has_glass_door: b.has_glass_door || false,
        range_panel_count: b.range_panel_count ?? null,
        door_pattern: b.door_pattern ?? null,
        qty: b.qty,
        display_order: b.display_order,
      }));
      setPerimeterBoxes(allBoxes.filter((b) => b.location !== 'island'));
      setIslandBoxes(allBoxes.filter((b) => b.location === 'island'));
      if (wallHeightOpenedFor.current !== estimate.id) {
        wallHeightOpenedFor.current = estimate.id;
        setWallHeight(mainWallHeight(allBoxes) ?? wallHeightForTier(estimate.tier));
      }
    }
  }, [estimate, form]);

  // Auto-enable plumbing when sink_base exists
  useEffect(() => {
    const allBoxes = [...perimeterBoxes, ...islandBoxes];
    const hasSink = allBoxes.some((b) => b.specialty_type === 'sink_base');
    if (hasSink && !form.getFieldValue('include_plumbing')) {
      form.setFieldsValue({ include_plumbing: true });
    }
  }, [perimeterBoxes, islandBoxes, form]);

  // ── Mutations ──
  const saveMutation = useMutation({
    mutationFn: (payload: CabinetEstimateUpdate) =>
      cabinetEstimateService.update(id!, payload),
    onSuccess: () => {
      unsavedRef.current = false;
      setDirty(false);
      setAnnounce(`Saved at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
      message.success('Saved');
      queryClient.invalidateQueries({ queryKey: ['cabinet-estimate', id] });
      // Job facts are shared, so the job's other estimates may have changed
      queryClient.invalidateQueries({ queryKey: ['cabinet-estimate-group'] });
    },
    onError: () => message.error('Failed to save'),
  });

  const totalBeforeCalcRef = useRef(0);
  const calculateMutation = useMutation({
    mutationFn: (payload?: CabinetEstimateUpdate) =>
      cabinetEstimateService.calculate(id!, payload),
    onSuccess: (updated) => {
      unsavedRef.current = false;
      setDirty(false);
      setStale(false);
      // Stays where you are, and says what the total became.
      const before = totalBeforeCalcRef.current;
      const after = updated?.total ?? 0;
      const change = before > 0 && after !== before ? ` (was ${money(before)}, ${after > before ? '+' : '−'}${money(Math.abs(after - before))})` : '';
      setAnnounce(`Calculated. Total ${money(after)}${change}`);
      message.success(`Calculated: ${money(after)}${change}`);
      queryClient.invalidateQueries({ queryKey: ['cabinet-estimate', id] });
      queryClient.invalidateQueries({ queryKey: ['cabinet-estimate-group'] });
      queryClient.invalidateQueries({ queryKey: ['cabinet-estimate-history', id] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Calculation failed');
    },
  });

  const cloneMutation = useMutation({
    mutationFn: () => cabinetEstimateService.clone(id!),
    onSuccess: (result) => {
      message.success('Cloned');
      navigate(`${CABINET_TOOL_PATH}/${result.id}`);
    },
  });

  // The calculated line items into a Scopit estimate: a new one, or the one sent to before
  const sendMutation = useMutation({
    mutationFn: (updateExisting: boolean) => cabinetEstimateService.sendToEstimate(id!, updateExisting),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['cabinet-estimate', id] });
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

  const editPerimeterBoxes = useCallback((boxes: CabinetBoxCreate[]) => {
    markDirtyRef.current();
    setPerimeterBoxes(boxes);
  }, []);
  const editIslandBoxes = useCallback((boxes: CabinetBoxCreate[]) => {
    markDirtyRef.current();
    setIslandBoxes(boxes);
  }, []);

  // A new upper height: offer to switch the full-height uppers already listed to it.
  // `lead` starts the question's sentence; `onKeep` runs when they're kept as they are.
  const offerUpperHeight = useCallback((height: 30 | 36 | 42, lead: string, onKeep?: () => void) => {
    const perimeter = boxesAtWallHeight(perimeterBoxes, height);
    const island = boxesAtWallHeight(islandBoxes, height);
    const moved = perimeter.moved + island.moved;
    if (moved === 0) return;
    Modal.confirm({
      title: `Change the uppers to ${height}"?`,
      content:
        `${lead}${moved} wall cabinet${moved === 1 ? ' here is' : 's here are'} another height. ` +
        'Short uppers over a fridge, range or microwave and custom sizes stay as they are.',
      okText: `Change to ${height}"`,
      cancelText: 'Keep their sizes',
      onOk: () => {
        if (perimeter.moved) editPerimeterBoxes(perimeter.boxes);
        if (island.moved) editIslandBoxes(island.boxes);
      },
      onCancel: onKeep,
    });
  }, [perimeterBoxes, islandBoxes, editPerimeterBoxes, editIslandBoxes]);

  // A new Tier starts the uppers at its height. Kept at their own height, they keep the control there too.
  const handleTierChange = useCallback((next: string) => {
    const height = TIER_WALL_HEIGHT[next as CabinetTier];
    if (!height) return;
    setWallHeight(height);
    offerUpperHeight(height, `${next} uppers are usually ${height}" tall, and `, () =>
      setWallHeight(mainWallHeight([...perimeterBoxes, ...islandBoxes]) ?? height)
    );
  }, [offerUpperHeight, perimeterBoxes, islandBoxes]);

  // A height picked by hand: the pickers list it, and the uppers listed may follow.
  const handleWallHeightChange = useCallback((height: WallHeightFilter) => {
    setWallHeight(height);
    if (height !== 'all') offerUpperHeight(height, '');
  }, [offerUpperHeight]);

  // What the Sketch tab draws: every box, perimeter then island.
  const sketchBoxes = useMemo(() => [...perimeterBoxes, ...islandBoxes], [perimeterBoxes, islandBoxes]);

  // A cabinet deleted on the sketch comes off the list too: one less of the
  // last matching row, or the row itself when it was the only one.
  const handleSketchCabinetsRemoved = useCallback((keys: string[]) => {
    const takeOne = (list: CabinetBoxCreate[], key: string): CabinetBoxCreate[] => {
      for (let i = list.length - 1; i >= 0; i--) {
        if (boxKey(list[i]) !== key) continue;
        return list[i].qty > 1
          ? list.map((b, j) => (j === i ? { ...b, qty: b.qty - 1 } : b))
          : list.filter((_, j) => j !== i);
      }
      return list;
    };
    setPerimeterBoxes((prev) => keys.reduce(takeOne, prev));
    setIslandBoxes((prev) => keys.reduce(takeOne, prev));
    setSketchBoxEdits((n) => n + 1);
    setStale(true);
  }, []);

  // A cabinet changed on the sketch (its picker or right-click panel: code,
  // size, glass, door): its row changes the way editing it here does, or,
  // when the row is for several, one is split off into a new row right after it.
  const handleSketchCabinetEdited = useCallback((key: string, box: BoxFields) => {
    const changeOne = (list: CabinetBoxCreate[]): CabinetBoxCreate[] => {
      const i = list.findIndex((b) => boxKey(b) === key);
      if (i < 0) return list;
      const changed: CabinetBoxCreate = { ...list[i], ...box, qty: 1 };
      if (list[i].qty <= 1) return list.map((b, j) => (j === i ? changed : b));
      return [...list.slice(0, i), { ...list[i], qty: list[i].qty - 1 }, changed, ...list.slice(i + 1)];
    };
    setPerimeterBoxes(changeOne);
    setIslandBoxes(changeOne);
    setSketchBoxEdits((n) => n + 1);
    setStale(true);
  }, []);

  // Merge perimeter + island boxes for API
  const allBoxes = [...perimeterBoxes, ...islandBoxes].map((b, i) => ({
    ...b,
    display_order: i,
  }));

  // The sketch saves itself, but a cabinet added, swapped or deleted there
  // only changes the box list above, which Save writes. Save the list too,
  // shortly after the last such change (and on leaving the page) — else a
  // reload loses the cabinet, and the sketch then drops it as well.
  const latestBoxesRef = useRef(allBoxes);
  latestBoxesRef.current = allBoxes;
  const sketchBoxesPendingRef = useRef(false);
  const { mutate: saveSketchBoxes } = useMutation({
    mutationFn: (boxes: CabinetBoxCreate[]) => cabinetEstimateService.update(id!, { boxes }),
    onSuccess: (saved) => {
      queryClient.setQueryData<CabinetEstimate>(['cabinet-estimate', id], (old) => old && { ...old, boxes: saved.boxes });
      selfSavedEstimateRef.current = queryClient.getQueryData<CabinetEstimate>(['cabinet-estimate', id]);
    },
    onError: () => message.error('Failed to save the cabinets changed on the sketch — use Save'),
  });
  useEffect(() => {
    if (sketchBoxEdits === 0) return;
    sketchBoxesPendingRef.current = true;
    const timer = window.setTimeout(() => {
      sketchBoxesPendingRef.current = false;
      saveSketchBoxes(latestBoxesRef.current);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [sketchBoxEdits, saveSketchBoxes]);
  useEffect(() => {
    return () => {
      if (sketchBoxesPendingRef.current) {
        // Coming back must find this list, even before the save lands: from
        // the older one cached, the sketch would redo what was just changed.
        queryClient.setQueryData<CabinetEstimate>(
          ['cabinet-estimate', id],
          (old) => old && { ...old, boxes: latestBoxesRef.current as CabinetEstimate['boxes'] }
        );
        saveSketchBoxes(latestBoxesRef.current);
      }
    };
  }, [id, queryClient, saveSketchBoxes]);

  // Build the API payload from the form store.
  // Read from the store, not validateFields(): conditionally rendered
  // sections (e.g. Island Countertop, which hides when the island has no
  // boxes) are unmounted, and validateFields() only returns mounted
  // fields - their values would be dropped silently.
  // The end_panel_* fields are flat in the form (one InputNumber each)
  // but the API takes them as a single object, so they are reassembled
  // here and stripped from the top level.
  const buildPayload = useCallback((): CabinetEstimateUpdate => {
    const {
      backsplash_height_inches: _bh,
      end_panel_base: epBase,
      end_panel_wall: epWall,
      end_panel_tall: epTall,
      end_panel_refrigerator: epFridge,
      ...values
    } = form.getFieldsValue(true);
    return {
      ...values,
      end_panel_counts: {
        base: epBase ?? 0,
        wall: epWall ?? 0,
        tall: epTall ?? 0,
        refrigerator: epFridge ?? 0,
      },
      overhead_pct: (values.overhead_pct ?? 0) / 100,
      profit_pct: (values.profit_pct ?? 0) / 100,
      boxes: allBoxes,
    };
  }, [form, allBoxes]);

  // ── Save handler ──
  // The sketch saves itself a moment after each change; Save sends what it hasn't yet.
  // A required field left empty: open it and say which.
  const showMissing = useCallback((err: any, doing: string) => {
    const first = err?.errorFields?.[0];
    const name = first?.name?.[0];
    const label = name === 'tier' ? 'Tier' : 'the required fields';
    if (name === 'tier') setPanelTab('estimate');
    if (first) window.requestAnimationFrame(() => form.scrollToField(first.name, { block: 'center' }));
    message.warning(`Fill in ${label} before ${doing}`);
  }, [form]);

  const handleSave = useCallback(async () => {
    setSketchSaveSignal((n) => n + 1);
    try {
      await form.validateFields();
      saveMutation.mutate(buildPayload());
    } catch (err) {
      showMissing(err, 'saving');
    }
  }, [form, buildPayload, saveMutation, showMissing]);

  // ── Save & Calculate (single API call) ──
  const handleCalculate = useCallback(async () => {
    setSketchSaveSignal((n) => n + 1);
    try {
      await form.validateFields();
      totalBeforeCalcRef.current = queryClient.getQueryData<CabinetEstimate>(['cabinet-estimate', id])?.total ?? 0;
      calculateMutation.mutate(buildPayload());
    } catch (err) {
      showMissing(err, 'calculating');
    }
  }, [form, buildPayload, calculateMutation, showMissing, queryClient, id]);

  markDirtyRef.current = () => {
    unsavedRef.current = true;
    setDirty(true);
    setStale(true);
  };

  // Ctrl+S saves and Ctrl+Enter calculates, from anywhere on the page.
  const shortcutsRef = useRef({ save: handleSave, calculate: handleCalculate });
  shortcutsRef.current = { save: handleSave, calculate: handleCalculate };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        shortcutsRef.current.save();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        shortcutsRef.current.calculate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Leaving with edits not saved asks first: another page here, or the browser's own close or reload.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => unsavedRef.current && currentLocation.pathname !== nextLocation.pathname
  );
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsavedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

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
              setDirty(false);
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
        await saveMutation.mutateAsync(buildPayload());
        action();
      },
    });
  }, [estimate, buildPayload, saveMutation]);

  // A link or Back with edits not saved: Save, Discard or Stay here, as for the job's other estimates.
  const blocked = blocker.state === 'blocked';
  useEffect(() => {
    if (!blocked) return;
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
              setDirty(false);
              modal.destroy();
              blocker.proceed?.();
            }}
          >
            Discard changes
          </Button>
          <OkBtn />
        </>
      ),
      onOk: async () => {
        await saveMutation.mutateAsync(buildPayload());
        blocker.proceed?.();
      },
      onCancel: () => blocker.reset?.(),
    });
    return () => modal.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked]);

  const openMember = useCallback((memberId: string, options?: { discard?: boolean }) => {
    const go = () => navigate(`${CABINET_TOOL_PATH}/${memberId}`, { state: { tab: activeTab } });
    if (options?.discard) {
      unsavedRef.current = false;
      setDirty(false);
      go();
    } else {
      guardUnsaved(go);
    }
  }, [activeTab, guardUnsaved, navigate]);

  // An option's product changed: the server repriced it from what's saved
  const handleSelectionsChanged = useCallback((updated: CabinetEstimate) => {
    queryClient.setQueryData(['cabinet-estimate', id], updated);
    queryClient.invalidateQueries({ queryKey: ['cabinet-estimate-history', id] });
    queryClient.invalidateQueries({ queryKey: ['cabinet-estimate-group'] });
    queryClient.invalidateQueries({ queryKey: ['cabinet-estimates'] });
  }, [id, queryClient]);

  // ── Side by side ──
  const chooseView = useCallback((choice: 'split' | 'tabs') => {
    setViewChoice(choice);
    writeStored(VIEW_KEY, choice);
  }, []);

  // The split runs from where it starts to the window's bottom (less the page's bottom gutter), so the page
  // itself doesn't scroll; measured again when the window or anything above it changes size.
  const hasEstimate = !!estimate;
  useLayoutEffect(() => {
    const el = splitRef.current;
    if (!split || !el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const main = document.getElementById('main-content');
      const gutter = (main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0) + 12;
      setSplitHeight(Math.max(520, Math.floor(window.innerHeight - top - gutter)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (el.parentElement) observer.observe(el.parentElement);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [split, hasEstimate]);

  // The panel's width as the divider is dragged: from its right edge to the pointer.
  const panelWidthAt = useCallback((clientX: number) => {
    const r = splitRef.current?.getBoundingClientRect();
    return r ? clampPanelWidth(r.right - clientX - 6) : DEFAULT_PANEL_WIDTH;
  }, []);

  // A cabinet picked on the sketch: its row is marked, and brought into view
  // unless the pick came from clicking that row.
  const handleSketchSelection = useCallback(
    (keys: string[], count: number) => {
      setLinkedKeys(new Set(keys));
      setSelectionCount(count);
      const fromRow = rowPickRef.current;
      rowPickRef.current = null;
      if (!split || keys.length === 0 || (fromRow !== null && keys.includes(fromRow))) return;
      window.requestAnimationFrame(() => {
        const row = formPaneRef.current?.querySelector(`[data-link-key="${CSS.escape(keys[0])}"]`);
        if (row && (row as HTMLElement).offsetParent) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
    [split]
  );
  const rowLink = useMemo(
    () =>
      split
        ? {
            keyOf: boxKey,
            linked: linkedKeys,
            onPick: (key: string) => {
              rowPickRef.current = key;
              setPickKeys((prev) => ({ keys: [key], seq: (prev?.seq ?? 0) + 1 }));
            },
            onHover: setHintKey,
            hinted: null,
          }
        : undefined,
    [split, linkedKeys]
  );

  const unfold = useCallback((key: string) => {
    setFolded((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);
  const toggleFold = useCallback((key: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  // Open a section of the Estimate panel (or the Edit tab) and bring it into view.
  const goToSection = useCallback(
    (key: string) => {
      unfold(key);
      setPanelTab('estimate');
      window.requestAnimationFrame(() =>
        document.getElementById(sectionId(key))?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      );
    },
    [unfold]
  );
  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!estimate) {
    return <Alert type="error" message="Estimate not found" />;
  }

  // A form section: a heading over a hairline (ui-sheet-card); beside the drawing,
  // the seldom-changed ones fold to a summary.
  const section = (key: string, title: string, summary?: string) => {
    const foldable = split && FOLDABLE_SECTIONS.includes(key);
    const isFolded = foldable && folded.has(key);
    return {
      id: sectionId(key),
      className: 'ui-sheet-card',
      title: foldable ? <FoldTitle title={title} summary={summary} folded={isFolded} onToggle={() => toggleFold(key)} /> : title,
      styles: isFolded ? { body: { display: 'none' } } : undefined,
      style: { scrollMarginTop: 8 },
    };
  };
  const clientSummary =
    [estimate.client_name, watchedClaimNumber && `Claim ${watchedClaimNumber}`].filter(Boolean).join(' · ') || 'Not set';
  const projectSummary =
    [
      watchedAddress,
      watchedLayout,
      watchedSize ? `${watchedSize} sqft` : null,
      watchedCeiling ? `${watchedCeiling} ft ceiling` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Not set';
  const drywallSummary =
    [includeDrywall && `Drywall ${drywallSf ?? 0} SF`, includePainting && `Painting ${paintingSf ?? 0} SF`]
      .filter(Boolean)
      .join(' · ') || 'Not included';
  const backsplashSummary = includeBacksplash
    ? [backsplashType, backsplashSf ? `${backsplashSf} SF` : null].filter(Boolean).join(' · ') || 'Included'
    : 'Not included';

  // Side by side the form is right there, so the sketch's messages don't send you to the Edit tab.
  const onEditTab = split ? '' : ' on the Edit tab';
  const sketchEditor = (
      <CabinetSketchEditor
        estimateId={id!}
        boxes={sketchBoxes}
        wallHeight={wallHeight}
        active={split ? shownTab === 'edit' : shownTab === 'sketch'}
    layout={split ? 'pane' : 'page'}
    keysWhenPointerOver={split}
    saveSignal={sketchSaveSignal}
    onSelectionChange={handleSketchSelection}
    pickKeys={split ? pickKeys : null}
    hintKey={split ? hintKey : null}
    inspector={split ? { selection: selectionEl, takeoff: takeoffEl } : null}
    onRequestInspect={() => setPanelTab('inspect')}
    onSaveStateChange={setSketchSave}
        onCabinetsRemoved={handleSketchCabinetsRemoved}
        onCabinetEdited={handleSketchCabinetEdited}
        islandSeatingIn={islandSeatingIn}
        islandTwoSided={islandTwoSided}
        applianceList={sketchAppliances}
        sinkBowls={sinkType === 'double' ? 2 : 1}
        products={estimate.kind === 'option' ? estimate.selections : null}
        crownMolding={crownMolding}
        archedDoors={doorStyle === 'Arched Raised Panel'}
        onApplyIslandTopSf={(sf) => {
          form.setFieldsValue({ island_countertop_sqft: sf });
          message.success(`Island countertop set to ${sf} SF${onEditTab} — Save or Save & Calculate to price it`);
        }}
        onApplyAngledJoints={(count) => {
          form.setFieldsValue({ angled_joint_count: count });
          message.success(`Angled Joints set to ${count}${onEditTab} — Save or Save & Calculate to price it`);
        }}
        onApplyTrim={(counts) => {
          form.setFieldsValue(counts);
          const set = TRIM_FIELDS.map((f) => `${TRIM_FIELD_LABELS[f]} ${counts[f]}`).join(', ');
          message.success(`Trim & Finished Panels set${onEditTab} (${set}) — Save or Save & Calculate to price them`, 6);
        }}
        backsplash={sketchBacksplash}
        onApplyBacksplash={({ tile, counter }) => {
          const sf = Math.round(((tile * backsplashHeightIn) / 12) * 10) / 10;
          form.setFieldsValue({ backsplash_sqft: sf, countertop_backsplash_lf: counter });
          const unticked = [
            !includeBacksplash && 'Backsplash',
            !(includeCountertop && includeCtBacksplash) && '4" Countertop Backsplash',
          ].filter(Boolean);
          message.success(
            `Backsplash ${sf} SF (${tile} LF × ${backsplashHeightIn}") and 4" Countertop Backsplash ${counter} LF set${onEditTab} — ${
              unticked.length ? `tick ${unticked.join(' and ')} there, then ` : ''
            }Save or Save & Calculate to price them`,
            6
          );
        }}
        onCabinetPlaced={(code, cabType) => {
          const preset = CABINET_PRESETS[code];
          if (!preset) return;
          const newBox: CabinetBoxCreate = {
            code,
            cab_type: cabType,
            location: 'perimeter',
            width_inches: preset.width,
            height_inches: preset.height,
            is_specialty: !!preset.specialty,
            specialty_type: preset.specialty || null,
            has_glass_door: false,
            range_panel_count: preset.specialty === 'range_base_slide_in' ? 2 : null,
            qty: 1,
            display_order: perimeterBoxes.length,
          };
          setPerimeterBoxes((prev) => [...prev, newBox]);
          setSketchBoxEdits((n) => n + 1);
        }}
      />
  );

  // Above the estimate bar; the app header already has the way back to the tool
  const title = estimate.property_address || 'Cabinet estimate';
  const titleBar = (
    <Space wrap size="small" style={{ minWidth: 0 }}>
      <Title level={4} style={{ margin: 0, fontSize: 16, maxWidth: 420 }} ellipsis={{ tooltip: title }}>
        {title}
      </Title>
      <Pill tone={STATUS_TONES[estimate.status] ?? 'gray'}>{humanize(estimate.status)}</Pill>
      {estimate.client_name && (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {estimate.client_name}
          {estimate.claim_number ? ` · Claim ${estimate.claim_number}` : ''}
        </Text>
      )}
      <KitchenJobType estimate={estimate} guardUnsaved={guardUnsaved} />
    </Space>
  );

  const draft = estimate.status === 'draft';
  const busy = saveMutation.isPending || calculateMutation.isPending;
  const saveState = busy
    ? { cls: 'is-saving', text: calculateMutation.isPending ? 'Calculating…' : 'Saving…' }
    : dirty
      ? { cls: 'is-dirty', text: 'Unsaved changes' }
      : sketchSave !== 'saved'
        ? { cls: 'is-saving', text: 'Saving the sketch…' }
        : { cls: '', text: 'All changes saved' };

  // The estimate's views: Edit (with the sketch beside it, or its own Sketch tab), Result, Purchase order
  const pageTabs: { key: string; label: string; disabled?: boolean; why?: string }[] = [
    { key: 'edit', label: 'Edit' },
    ...(split ? [] : [{ key: 'sketch', label: 'Sketch' }]),
    { key: 'result', label: 'Estimate result', disabled: draft, why: draft ? 'Calculate first' : undefined },
    {
      key: 'purchase-order',
      label: 'Purchase order',
      disabled: !estimate.boxes?.length,
      why: !estimate.boxes?.length ? 'Add cabinets and save first' : undefined,
    },
  ];

  const exportItems = [
    { key: 'with-sig', label: 'PDF with signature', disabled: draft },
    { key: 'no-sig', label: 'PDF without signature', disabled: draft },
    { type: 'divider' as const },
    { key: 'design', label: 'Design quote (drawings optional)…', disabled: draft },
    // The customer's side-by-side of the whole job; never for the carrier
    ...((estimate.group_members?.length ?? 0) > 1
      ? [{ key: 'proposal', label: 'Customer proposal (all estimates)', disabled: draft }]
      : []),
    { type: 'divider' as const },
    { key: 'excel', label: 'Excel', disabled: !estimate.boxes?.length },
    ...(draft ? [{ type: 'divider' as const }, { key: 'why', label: 'Calculate first to make the PDFs', disabled: true }] : []),
  ];
  const onExport = ({ key }: { key: string }) => {
    if (key === 'design') {
      setDesignQuoteFor(id!);
      return;
    }
    if (key === 'excel') {
      cabinetEstimateService.exportExcel(id!);
      return;
    }
    const run =
      key === 'proposal'
        ? cabinetEstimateService.exportProposalPdf(id!)
        : cabinetEstimateService.exportPdf(id!, {
            show_signature: key === 'with-sig',
            address: estimate.property_address,
          });
    run.catch(() => message.error('The PDF could not be made'));
  };
  // Into a Scopit estimate, from what was last calculated
  const sentBefore = !!estimate.scopit_estimate_id;
  const notReadyToSend = draft ? 'Calculate first' : stale || dirty ? 'Calculate the latest changes first' : null;
  const sendItems = [
    { key: 'new', label: 'Create a new estimate', disabled: !!notReadyToSend },
    ...(sentBefore
      ? [
          { key: 'update', label: 'Update the estimate sent before', disabled: !!notReadyToSend },
          { type: 'divider' as const },
          { key: 'open', label: 'Open the estimate sent before' },
        ]
      : []),
    ...(notReadyToSend ? [{ type: 'divider' as const }, { key: 'why', label: notReadyToSend, disabled: true }] : []),
  ];
  const onSend = ({ key }: { key: string }) => {
    if (key === 'open' && estimate.scopit_estimate_id) navigate(`/app/estimates/${estimate.scopit_estimate_id}`);
    if (key === 'new' || key === 'update') sendMutation.mutate(key === 'update');
  };

  const moreItems = [
    { key: 'clone', label: 'Clone into a new job' },
    ...(wideScreen
      ? [
          { type: 'divider' as const },
          {
            key: 'view',
            label: 'Sketch beside the form',
            icon: split ? <CheckOutlined /> : <span style={{ display: 'inline-block', width: 14 }} />,
          },
        ]
      : []),
  ];
  const onMore = ({ key }: { key: string }) => {
    if (key === 'clone') cloneMutation.mutate();
    if (key === 'view') chooseView(split ? 'tabs' : 'split');
  };

  // Inspect with nothing selected: the total, what the plan measures, and the estimate's essentials
  const lf = (boxes: CabinetBoxCreate[], type: string) =>
    boxes.filter((b) => b.cab_type === type).reduce((s, b) => s + (b.width_inches * b.qty) / 12, 0);
  const boxCount = [...perimeterBoxes, ...islandBoxes].reduce((s, b) => s + b.qty, 0);
  const pricingLabel = pricingInfo?.pricing_bases?.find((b) => b.key === pricingBasis)?.label ?? pricingBasis;
  const editLink = (onClick: () => void, what: string) => (
    <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontWeight: 400 }} aria-label={`Edit ${what}`} onClick={onClick}>
      Edit
    </Button>
  );
  const fieldRows = (rows: [string, React.ReactNode][]) =>
    rows.map(([label, value]) => (
      <div className="ce-field" key={label}>
        <span className="ce-field-label">{label}</span>
        <span className={`ce-field-value${value ? '' : ' is-empty'}`}>{value || 'Empty'}</span>
      </div>
    ));
  const inspectSummary = (
    <>
      {selectionCount === 0 && (
        <div className="ce-section" style={{ paddingTop: 4 }}>
          <div className="ce-section-title">
            <span>Total</span>
            <Pill tone={STATUS_TONES[estimate.status] ?? 'gray'}>{humanize(estimate.status)}</Pill>
          </div>
          <div className="ce-total">
            {estimate.total > 0 ? (
              <span className="ce-total-value">{money(estimate.total)}</span>
            ) : (
              <span className="ce-total-none">Not calculated yet</span>
            )}
            {estimate.total > 0 && !draft && (
              <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => setActiveTab('result')}>
                See the lines
              </Button>
            )}
          </div>
          {(stale || estimate.total <= 0) && (
            <div className="ce-stale">
              <span>{estimate.total > 0 ? 'Changed since the last calculation' : 'Calculate to work out the total'}</span>
              <Button size="small" onClick={handleCalculate} loading={calculateMutation.isPending}>
                Calculate
              </Button>
            </div>
          )}
        </div>
      )}
      <div ref={setTakeoffEl} hidden={selectionCount > 0} />
      {selectionCount === 0 && (
        <>
          <div className="ce-section">
            <div className="ce-section-title">
              <span>Specifications</span>
              {editLink(() => goToSection('specs'), 'specifications')}
            </div>
            {fieldRows([
              ['Pricing', pricingLabel],
              ['Tier', tier],
              ['Box', boxMaterial],
              ['Finish', finishName],
              ['Door style', doorStyle],
              ['Overlay', overlayStyle],
            ])}
          </div>
          <div className="ce-section">
            <div className="ce-section-title">
              <span>Cabinets</span>
              {editLink(() => setPanelTab('cabinets'), 'cabinets')}
            </div>
            {fieldRows([
              ['Base', `${lf(perimeterBoxes, 'base').toFixed(1)} LF`],
              ['Wall', `${lf(perimeterBoxes, 'wall').toFixed(1)} LF`],
              ['Tall', `${perimeterBoxes.filter((b) => b.cab_type === 'tall').reduce((s, b) => s + b.qty, 0)} EA`],
              ['Island', islandType === 'prefab' ? 'Prefab' : `${lf(islandBoxes, 'base').toFixed(1)} LF`],
              ['Boxes', String(boxCount)],
            ])}
          </div>
          <div className="ce-section">
            <div className="ce-section-title">
              <span>Job</span>
              {editLink(() => goToSection('client'), 'the job')}
            </div>
            {fieldRows([
              ['Customer', estimate.client_name],
              ['Claim', watchedClaimNumber],
              ['Address', watchedAddress],
            ])}
          </div>
        </>
      )}
    </>
  );

  return (
    <div className="ce-page" style={{ padding: '12px 8px' }}>
      <div style={{ marginBottom: 4 }}>{titleBar}</div>

      {/* The job's estimates, then the open estimate's views and what you do with it */}
      <KitchenGroupBar
        estimate={estimate}
        onOpen={openMember}
        guardUnsaved={guardUnsaved}
        onCompare={() => setCompareOpen(true)}
      />
      <div className="ce-bar">
        <div className="ce-bar-start">
          <div role="tablist" aria-label="Estimate views" style={{ display: 'flex', gap: 2 }}>
            {pageTabs.map((t) => (
              <Tooltip key={t.key} title={t.why}>
                <Button
                  type="text"
                  role="tab"
                  aria-selected={shownTab === t.key}
                  className={`ui-view-tab${shownTab === t.key ? ' is-selected' : ''}`}
                  disabled={t.disabled}
                  onClick={() => setActiveTab(t.key)}
                >
                  {t.label}
                </Button>
              </Tooltip>
            ))}
          </div>
        </div>
        <div className="ce-bar-end">
          <span className={`ce-save-state ${saveState.cls}`}>
            <span className="ce-save-state-dot" aria-hidden="true" />
            {saveState.text}
          </span>
          <Tooltip title="Save (Ctrl+S)" mouseEnterDelay={0.6}>
            <Button onClick={handleSave} loading={saveMutation.isPending}>
              Save
            </Button>
          </Tooltip>
          <Tooltip title="Save and work out the total (Ctrl+Enter)" mouseEnterDelay={0.6}>
            <Button type="primary" onClick={handleCalculate} loading={calculateMutation.isPending}>
              Calculate
            </Button>
          </Tooltip>
          <Dropdown menu={{ items: exportItems, onClick: onExport }}>
            <Button>
              Export <DownOutlined style={{ fontSize: 12 }} />
            </Button>
          </Dropdown>
          <Dropdown
            trigger={['click']}
            disabled={sendMutation.isPending}
            menu={{ items: sendItems, onClick: onSend }}
          >
            <Button loading={sendMutation.isPending}>
              To estimate <DownOutlined style={{ fontSize: 12 }} />
            </Button>
          </Dropdown>
          <Dropdown trigger={['click']} menu={{ items: moreItems, onClick: onMore }}>
            <Button type="text" className="ui-icon-btn" icon={<MoreOutlined />} aria-label="More actions" />
          </Dropdown>
        </div>
      </div>

      <KitchenDesignQuoteModal estimateId={designQuoteFor} onClose={() => setDesignQuoteFor(null)} />
      <KitchenGroupCompareDrawer
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        estimate={estimate}
        onOpen={(memberId) => {
          setCompareOpen(false);
          if (memberId !== estimate.id) openMember(memberId);
        }}
      />
      <div className="ce-sr-only" aria-live="polite">
        {announce}
      </div>

      {/* The same three children either way, so switching never remounts the sketch or the form. */}
      <div
        ref={splitRef}
        className={split ? 'ce-split' : undefined}
        style={
          shownTab !== 'edit' && shownTab !== 'sketch'
            ? { display: 'none' }
            : split
              ? { gridTemplateColumns: `minmax(0, 1fr) 12px ${panelWidth}px`, height: splitHeight }
              : undefined
        }
      >
        <div
          key="sketch"
          className={split ? 'ce-split-canvas' : undefined}
          style={split ? undefined : { display: shownTab === 'sketch' ? 'block' : 'none' }}
        >
          {sketchMounted && sketchEditor}
        </div>
        {split && (
          <div
            key="divider"
            className={`ce-divider${draggingDivider ? ' is-dragging' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Width of the panel"
            aria-valuemin={340}
            aria-valuemax={640}
            aria-valuenow={panelWidth}
            tabIndex={0}
            title="Drag to change the panel's width; double-click for the usual width"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              setDraggingDivider(true);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) setPanelWidth(panelWidthAt(e.clientX));
            }}
            onPointerUp={() => setDraggingDivider(false)}
            onPointerCancel={() => setDraggingDivider(false)}
            onDoubleClick={() => setPanelWidth(DEFAULT_PANEL_WIDTH)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              setPanelWidth((w) => clampPanelWidth(w + (e.key === 'ArrowLeft' ? 16 : -16)));
            }}
          />
        )}
        <div
          key="form"
          ref={formPaneRef}
          className={split ? 'ce-panel' : undefined}
          style={split ? undefined : { display: shownTab === 'edit' ? 'block' : 'none' }}
        >
          {split && (
            <div className="ce-panel-tabs" role="tablist" aria-label="Panel">
              {PANEL_TABS.map((t) => (
                <Button
                  key={t.key}
                  type="text"
                  role="tab"
                  aria-selected={panelTab === t.key}
                  className={`ui-view-tab${panelTab === t.key ? ' is-selected' : ''}`}
                  onClick={() => setPanelTab(t.key)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          )}
          <div className={split ? 'ce-panel-body' : undefined}>
            {split && (
              <div className="ce-panel-pane" role="tabpanel" aria-label="Inspect" hidden={panelTab !== 'inspect'}>
                <div ref={setSelectionEl} />
                {inspectSummary}
              </div>
            )}
            {split && (
              <div className="ce-panel-pane" role="tabpanel" aria-label="Cabinets" hidden={panelTab !== 'cabinets'}>
                <CabinetBoxEditor
                  variant="list"
                  boxes={perimeterBoxes}
                  onChange={editPerimeterBoxes}
                  location="perimeter"
                  wallHeight={wallHeight}
                  onWallHeightChange={handleWallHeightChange}
                  tier={tier}
                  link={rowLink}
                />
                {islandType !== 'prefab' && (
                  <CabinetBoxEditor variant="list" boxes={islandBoxes} onChange={editIslandBoxes} location="island" link={rowLink} />
                )}
              </div>
            )}
            <div
              className={split ? 'ce-panel-pane' : undefined}
              role={split ? 'tabpanel' : undefined}
              aria-label={split ? 'Estimate' : undefined}
              hidden={split && panelTab !== 'estimate'}
            >
          <KitchenSelections
            estimate={estimate}
            slots={pricingInfo?.selection_slots}
            onChanged={handleSelectionsChanged}
            guardUnsaved={guardUnsaved}
          />
          <Form
            form={form}
            layout="vertical"
            size="middle"
            className={split ? 'ce-form ce-panel-form' : 'ce-form'}
            onValuesChange={() => markDirtyRef.current()}
          >
            <Row gutter={24}>
              {/* Left column: Project Info + Kitchen + Scope */}
              <Col xs={24} lg={split ? 24 : 16}>
                {/* Customer & claim: shared by every estimate of the job */}
                <Card size="small" {...section('client', 'Customer & Claim', clientSummary)}>
                  <Row gutter={16}>
                    <Col xs={24} md={14}>
                      <Form.Item
                        name="customer_id"
                        label="Customer"
                        tooltip="Printed on the PDFs, and carried to the estimate when you send it."
                      >
                        <CustomerField
                          initialName={estimate.client_name}
                          onPick={(customer) => {
                            // Their address, unless the job already has one
                            if (!form.getFieldValue('property_address')) {
                              form.setFieldsValue({
                                property_address: addressOfCustomer(customer) || undefined,
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
                </Card>

                {/* Project Info */}
                <Card size="small" {...section('project', 'Project Information', projectSummary)}>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item name="property_address" label="Property Address">
                        <AddressField
                          placeholder="123 Main St, Bethesda, MD 20815"
                          onPick={(addr) => form.setFieldsValue({
                            // The estimate keeps one composite address
                            property_address: [
                              addr.street,
                              addr.city,
                              [addr.state, addr.zip].filter(Boolean).join(' '),
                            ].filter(Boolean).join(', '),
                            zip_code: addr.zip,
                          })}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="zip_code" label="Zip Code">
                        <Input placeholder="20815" maxLength={10} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="layout_type" label="Layout">
                        <Select
                          placeholder="Select"
                          allowClear
                          options={pricingInfo?.layout_types?.map((t) => ({ label: t, value: t })) || []}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="kitchen_size_sqft" label="Kitchen Size (sqft)">
                        <InputNumber style={{ width: '100%' }} min={0} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="ceiling_height" label="Ceiling Height (ft)">
                        <InputNumber style={{ width: '100%' }} min={0} step={0.5} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="has_soffit" valuePropName="checked">
                    <Checkbox>Has Soffit</Checkbox>
                  </Form.Item>
                </Card>

                {/* Specifications — each of these scales cabinet supply cost */}
                <Card size="small" {...section('specs', 'Cabinet Specifications')}>
                  {/* The basis decides which price list the whole estimate
                      is quoted from. It is first because changing it later
                      moves every basis-sensitive line. */}
                  <Form.Item
                    name="pricing_basis"
                    label="Pricing Basis"
                    tooltip="An insurance claim and a retail remodel price the same work differently. Appliance resets differ most: a carrier pays crew time, a homeowner also pays a trip minimum."
                    style={{ marginBottom: 12 }}
                  >
                    <Radio.Group>
                      {(pricingInfo?.pricing_bases || []).map((b) => (
                        <Radio.Button key={b.key} value={b.key} title={b.description}>
                          {b.label}
                        </Radio.Button>
                      ))}
                    </Radio.Group>
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.pricing_basis !== cur.pricing_basis}>
                    {({ getFieldValue }) => {
                      const key = getFieldValue('pricing_basis');
                      const info = (pricingInfo?.pricing_bases || []).find((b) => b.key === key);
                      if (!info) return null;
                      return (
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                          {info.description}
                        </Text>
                      );
                    }}
                  </Form.Item>
                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="tier"
                        label="Tier"
                        rules={[{ required: true, message: 'Required' }]}
                        tooltip='Also starts the upper cabinets at a height, changeable under Wall Cabinets: Stock 30" (older and builder-grade kitchens), Semi-Custom 36" (most kitchens), Custom 42" (newer and high-end ones).'
                      >
                        <Select
                          placeholder="Select tier"
                          options={pricingInfo?.tiers?.map((t) => ({ label: t, value: t })) || []}
                          onChange={handleTierChange}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item
                        name="box_material"
                        label="Box Material"
                        tooltip="What the box carcass is built from. Plywood is the baseline; MDF −8%, Particle −12%."
                      >
                        <Select
                          placeholder="Plywood"
                          allowClear
                          options={pricingInfo?.materials?.map((m) => ({ label: m, value: m })) || []}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item
                        name="finish"
                        label="Finish"
                        tooltip="Stained is the baseline. Painted +15%, Glazed +25% (confirm glaze upcharge with the supplier — it varies 0-50% by manufacturer), Laminate −15%."
                      >
                        <Select
                          placeholder="Stained"
                          allowClear
                          options={pricingInfo?.finishes?.map((f) => ({ label: f, value: f })) || []}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item
                        name="door_style"
                        label="Door Style"
                        tooltip="Shaker is the baseline. Raised Panel +15% for the extra machining, Arched Raised Panel +20%, Slab −4%."
                      >
                        <Select
                          placeholder="Shaker"
                          allowClear
                          options={pricingInfo?.door_styles?.map((d) => ({ label: d, value: d })) || []}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item
                        name="overlay_style"
                        label="Overlay"
                        tooltip="Full Overlay is the baseline. Inset doors sit flush inside the face frame and run +20%; Partial Overlay −5%."
                      >
                        <Select
                          placeholder="Full Overlay"
                          allowClear
                          options={pricingInfo?.overlay_styles?.map((o) => ({ label: o, value: o })) || []}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Perimeter Cabinets */}
                {!split && (
                <Card size="small" {...section('perimeter', 'Perimeter Cabinets')}>
                  <CabinetBoxEditor
                    boxes={perimeterBoxes}
                    onChange={editPerimeterBoxes}
                    location="perimeter"
                    wallHeight={wallHeight}
                    onWallHeightChange={handleWallHeightChange}
                    tier={tier}
                  />
                </Card>
                )}

                {/* Island Cabinets + Panels + Countertop */}
                <Card size="small" {...section('island', 'Island')}>
                  <Form.Item name="island_type" label="Island Type" style={{ marginBottom: 12 }}>
                    <Radio.Group
                      onChange={(e) => {
                        if (e.target.value === 'prefab') {
                          setIslandBoxes([]);
                          form.setFieldsValue({
                            island_end_panel_sqft: 0,
                            island_back_panel_sqft: 0,
                          });
                        } else {
                          form.setFieldsValue({
                            island_prefab_size: undefined,
                            island_prefab_price: undefined,
                          });
                        }
                      }}
                    >
                      <Radio.Button value="custom">Custom Build (LF)</Radio.Button>
                      <Radio.Button value="prefab">Prefab (EA)</Radio.Button>
                    </Radio.Group>
                  </Form.Item>

                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.island_type !== cur.island_type || prev.tier !== cur.tier}>
                    {({ getFieldValue }) => {
                      const islandType = getFieldValue('island_type') || 'custom';
                      const tier = getFieldValue('tier') as string;

                      if (islandType === 'prefab') {
                        const prefabPricing = pricingInfo?.prefab_island_pricing || {};
                        return (
                          <>
                            <Row gutter={16}>
                              <Col xs={24} md={8}>
                                <Form.Item name="island_prefab_size" label="Size" style={{ marginBottom: 8 }}>
                                  <Select
                                    placeholder="Select size"
                                    allowClear
                                    onChange={(size) => {
                                      if (size && tier && prefabPricing[size]) {
                                        form.setFieldsValue({
                                          island_prefab_price: prefabPricing[size][tier],
                                        });
                                      }
                                    }}
                                    options={Object.entries(prefabPricing).map(([key, val]: [string, any]) => ({
                                      label: val.label || key,
                                      value: key,
                                    }))}
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={24} md={8}>
                                <Form.Item name="island_prefab_price" label="Supply Price ($)" style={{ marginBottom: 8 }}>
                                  <InputNumber
                                    min={0} max={20000} step={50}
                                    style={{ width: '100%' }}
                                    placeholder="Auto or enter manually"
                                    formatter={(v) => `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                    parser={(v) => Number(v!.replace(/\$\s?|(,*)/g, '')) as any}
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={24} md={8}>
                                <Form.Item label="Install" style={{ marginBottom: 8 }}>
                                  <Text type="secondary">
                                    ${pricingInfo?.prefab_island_install?.[getFieldValue('island_prefab_size')] || '—'} (auto)
                                  </Text>
                                </Form.Item>
                              </Col>
                            </Row>
                            <Text type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>
                              The prefab island price is an estimate from its size and tier; the product picked may cost more or less.
                            </Text>
                          </>
                        );
                      }

                      return (
                        <>
                          {split ? (
                            <Text type="secondary" style={{ display: 'block', fontSize: 13 }}>
                              {islandBoxes.length
                                ? `${islandBoxes.reduce((n, b) => n + b.qty, 0)} island cabinets, in `
                                : 'No island cabinets yet. Add them in '}
                              <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => setPanelTab('cabinets')}>
                                Cabinets
                              </Button>
                              .
                            </Text>
                          ) : (
                            <>
                              <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>Island Cabinets</Text>
                              <CabinetBoxEditor boxes={islandBoxes} onChange={editIslandBoxes} location="island" />
                            </>
                          )}
                          {islandBoxes.length > 0 && (
                            <Form.Item
                              name="island_two_sided"
                              valuePropName="checked"
                              preserve
                              style={{ margin: '8px 0 0' }}
                              extra="Back to back: no back panel or seating side, ends twice as deep. The Sketch sets a straight island in two rows."
                            >
                              <Checkbox>Cabinets on both sides</Checkbox>
                            </Form.Item>
                          )}
                        </>
                      );
                    }}
                  </Form.Item>

                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.island_type !== cur.island_type}>
                    {({ getFieldValue: gfv }) => {
                      if (gfv('island_type') === 'prefab' || islandBoxes.length === 0) return null;
                      return (
                  <div style={{ borderTop: '1px solid #f0f0f0', margin: '16px 0', paddingTop: 12 }}>
                    <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Island Panels</Text>
                    <Row gutter={16}>
                      {/* End Panel */}
                      <Col xs={24} md={12}>
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>End Panel (Side)</Text>
                        <Row gutter={8}>
                          <Col xs={10} sm={10}>
                            <Form.Item label="LF" style={{ marginBottom: 4 }}>
                              <InputNumber
                                min={0} max={30} step={0.5}
                                style={{ width: '100%' }}
                                placeholder="0"
                                value={endPanelSf > 0 ? Math.round(endPanelSf / endPanelHeight * 10) / 10 : undefined}
                                onChange={(lf) => {
                                  form.setFieldsValue({
                                    island_end_panel_sqft: lf ? Math.round(lf * endPanelHeight * 10) / 10 : 0,
                                  });
                                }}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={7} sm={7}>
                            <Form.Item label="Height" style={{ marginBottom: 4 }}>
                              <Select
                                value={endPanelHeight}
                                size="middle"
                                onChange={(newH: number) => {
                                  // Keep the LF the user entered; restate it
                                  // as SF at the new height.
                                  const lf = endPanelSf > 0 ? endPanelSf / endPanelHeight : 0;
                                  setEndPanelHeight(newH);
                                  if (lf > 0) {
                                    form.setFieldsValue({
                                      island_end_panel_sqft: Math.round(lf * newH * 10) / 10,
                                    });
                                  }
                                }}
                                options={ISLAND_PANEL_HEIGHTS}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={7} sm={7}>
                            <Form.Item name="island_end_panel_sqft" label="SF" style={{ marginBottom: 4 }}>
                              <InputNumber min={0} max={200} step={0.5} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>
                        {(() => {
                          // A straight island's two ends, as deep as its cabinets: one row, or two back to back.
                          const depthIn = islandTwoSided ? 48 : 24;
                          const lf = (2 * depthIn) / 12;
                          const sf = Math.round(lf * endPanelHeight * 10) / 10;
                          return (
                            <Space size={4} wrap>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                2 ends × {depthIn}" deep = {lf} LF
                              </Text>
                              <Button
                                type="link"
                                size="small"
                                style={{ padding: 0, fontSize: 12, height: 'auto' }}
                                onClick={() => form.setFieldsValue({ island_end_panel_sqft: sf })}
                              >
                                {sf} SF 적용
                              </Button>
                            </Space>
                          );
                        })()}
                      </Col>
                      {/* Back Panel */}
                      <Col xs={24} md={12}>
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Back Panel</Text>
                        {islandTwoSided ? (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            None — with cabinets on both sides, the backs face each other.
                          </Text>
                        ) : (
                        <Row gutter={8}>
                          <Col xs={10} sm={10}>
                            <Form.Item label="LF" style={{ marginBottom: 4 }}>
                              <InputNumber
                                min={0} max={30} step={0.5}
                                style={{ width: '100%' }}
                                placeholder="0"
                                value={backPanelSf > 0 ? Math.round(backPanelSf / backPanelHeight * 10) / 10 : undefined}
                                onChange={(lf) => {
                                  form.setFieldsValue({
                                    island_back_panel_sqft: lf ? Math.round(lf * backPanelHeight * 10) / 10 : 0,
                                  });
                                }}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={7} sm={7}>
                            <Form.Item label="Height" style={{ marginBottom: 4 }}>
                              <Select
                                value={backPanelHeight}
                                size="middle"
                                onChange={(newH: number) => {
                                  // Keep the LF the user entered; restate it
                                  // as SF at the new height.
                                  const lf = backPanelSf > 0 ? backPanelSf / backPanelHeight : 0;
                                  setBackPanelHeight(newH);
                                  if (lf > 0) {
                                    form.setFieldsValue({
                                      island_back_panel_sqft: Math.round(lf * newH * 10) / 10,
                                    });
                                  }
                                }}
                                options={ISLAND_PANEL_HEIGHTS}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={7} sm={7}>
                            <Form.Item name="island_back_panel_sqft" label="SF" style={{ marginBottom: 4 }}>
                              <InputNumber min={0} max={200} step={0.5} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>
                        )}
                      </Col>
                    </Row>
                    {pricingInfo && form.getFieldValue('tier') && (
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          End: ${pricingInfo.island_panel_pricing?.end_panel_per_sf?.[form.getFieldValue('tier') as string] || '—'}/SF
                          {!islandTwoSided && (
                            <>
                              {' | '}
                              Back: ${pricingInfo.island_panel_pricing?.back_panel_per_sf?.[form.getFieldValue('tier') as string] || '—'}/SF
                            </>
                          )}
                          {' + $'}
                          {pricingInfo.island_panel_pricing?.install_per_sf || '—'}/SF install
                        </Text>
                      </div>
                    )}
                  </div>
                      );
                    }}
                  </Form.Item>

                  {/* Island Countertop — only when custom build + has boxes */}
                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, cur) =>
                      prev.include_countertop !== cur.include_countertop ||
                      prev.island_type !== cur.island_type ||
                      // The supports suggestion depends on which material the top is.
                      prev.island_countertop_material !== cur.island_countertop_material ||
                      prev.countertop_material !== cur.countertop_material
                    }
                  >
                    {({ getFieldValue }) => {
                      if (!getFieldValue('include_countertop')) return null;
                      if (getFieldValue('island_type') === 'prefab' || islandBoxes.length === 0) return null;
                      const islandBaseLf = islandBoxes
                        .filter((b) => b.cab_type === 'base')
                        .reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
                      // A straight island's top: unlike a perimeter run it overhangs both
                      // ends and the back too (1.5"), the back by the seating overhang when
                      // there is one; cabinets on both sides make it one row half as long,
                      // twice as deep, with no side free for seating (islandSeatingIn is 0).
                      // The Sketch's "Island top" measures any other shape.
                      const rows = islandTwoSided ? 2 : 1;
                      const topLengthIn = (islandBaseLf * 12) / rows + 2 * 1.5;
                      const topDepthIn = 24 * rows + 1.5 + Math.max(1.5, islandSeatingIn);
                      const suggestedSf =
                        islandBaseLf > 0 ? Math.round(((topLengthIn * topDepthIn) / 144) * 10) / 10 : 0;
                      return (
                        <div style={{ borderTop: '1px solid #f0f0f0', margin: '16px 0', paddingTop: 12 }}>
                          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Island Countertop</Text>
                          <Row gutter={16}>
                            <Col xs={12}>
                              <Form.Item name="island_countertop_material" label="Material" preserve>
                                <Select
                                  placeholder="Same as perimeter"
                                  allowClear
                                  options={priceInfo.countertopOptions}
                                />
                              </Form.Item>
                            </Col>
                            <Col xs={12}>
                              <Form.Item name="island_countertop_sqft" label="Area (SF)" preserve>
                                <InputNumber min={0} max={500} step={0.5} style={{ width: '100%' }} addonAfter="SF" />
                              </Form.Item>
                              {suggestedSf > 0 && (
                                <Space size={4} wrap>
                                  <Text type="secondary" style={{ fontSize: 12 }}>
                                    {Math.round(topLengthIn * 10) / 10}" × {Math.round(topDepthIn * 10) / 10}" =
                                  </Text>
                                  <Button
                                    type="link"
                                    size="small"
                                    style={{ padding: 0, fontSize: 12, height: 'auto' }}
                                    onClick={() => form.setFieldsValue({ island_countertop_sqft: suggestedSf })}
                                  >
                                    {suggestedSf} SF 적용
                                  </Button>
                                </Space>
                              )}
                            </Col>
                          </Row>
                          <Row gutter={16}>
                            <Col xs={12}>
                              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                                Seating overhang
                              </Text>
                              {islandTwoSided ? (
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  None — with cabinets on both sides, no side is free for seating.
                                </Text>
                              ) : (
                                <Form.Item name="island_seating_overhang_in" preserve noStyle>
                                  <Select
                                    size="small"
                                    style={{ width: '100%' }}
                                    options={[
                                      { label: 'None (1.5" edge)', value: 0 },
                                      { label: '10"', value: 10 },
                                      { label: '12" (counter stools)', value: 12 },
                                      { label: '15" (bar height)', value: 15 },
                                    ]}
                                  />
                                </Form.Item>
                              )}
                            </Col>
                            <Col xs={24} style={{ marginTop: 4 }}>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                L-shaped, three-sided or angled island? The Sketch tab's Island top measures the drawn shape.
                              </Text>
                            </Col>
                          </Row>
                          {(() => {
                            // A seating overhang past what the top's material carries on its
                            // own needs brackets under it, along the seating edge.
                            const rule = pricingInfo?.countertop_support_rule;
                            const material: string =
                              getFieldValue('island_countertop_material') || getFieldValue('countertop_material') || 'Laminate';
                            const maxFreeIn = rule?.max_unsupported_in?.[material];
                            if (!rule || maxFreeIn === undefined || islandSeatingIn <= 0) return null;
                            const needed = islandSeatingIn > maxFreeIn;
                            const span = Math.max(0, topLengthIn - 2 * rule.end_inset_in);
                            const suggestedSupports = needed ? Math.max(2, Math.ceil(span / rule.spacing_in) + 1) : 0;
                            return (
                              <Row gutter={16} style={{ marginTop: 12 }}>
                                <Col xs={12}>
                                  <Form.Item
                                    name="countertop_support_count"
                                    label="Overhang supports"
                                    preserve
                                    style={{ marginBottom: 4 }}
                                    tooltip={`Steel brackets under the seating overhang. ${material} carries up to ${maxFreeIn}" unsupported; past that, brackets go every ${rule.spacing_in}" along the seating edge, within ${rule.end_inset_in}" of each end. Stone limits assume a 3cm top; a 2cm top carries less (quartz 12", granite 6").`}
                                  >
                                    <InputNumber min={0} max={30} size="small" style={{ width: '100%' }} addonAfter="EA" />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} style={{ display: 'flex', alignItems: 'center' }}>
                                  {needed ? (
                                    <Space size={4} wrap>
                                      <Text type="secondary" style={{ fontSize: 12 }}>
                                        {islandSeatingIn}" &gt; {maxFreeIn}" for {material}:
                                      </Text>
                                      <Button
                                        type="link"
                                        size="small"
                                        style={{ padding: 0, fontSize: 12, height: 'auto' }}
                                        onClick={() => form.setFieldsValue({ countertop_support_count: suggestedSupports })}
                                      >
                                        {suggestedSupports} 적용
                                      </Button>
                                    </Space>
                                  ) : (
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                      Not needed — {material} carries {maxFreeIn}" unsupported.
                                    </Text>
                                  )}
                                </Col>
                              </Row>
                            );
                          })()}
                        </div>
                      );
                    }}
                  </Form.Item>
                </Card>

                {/* Scope of Work */}
                <Card size="small" {...section('scope', 'Scope of Work')}>
                  <Row gutter={[16, 8]}>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_demo" valuePropName="checked">
                        <Checkbox>Demolition & Removal</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_install" valuePropName="checked">
                        <Checkbox>Installation</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_delivery" valuePropName="checked" style={{ marginBottom: 4 }}>
                        <Checkbox>Delivery</Checkbox>
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_delivery !== cur.include_delivery}>
                        {({ getFieldValue }) =>
                          getFieldValue('include_delivery') ? (
                            <Form.Item name="delivery_floor" label="Floor" preserve style={{ marginBottom: 0, marginLeft: 24 }}>
                              <Select
                                size="small"
                                style={{ width: 120 }}
                                options={[
                                  { label: '1st Floor', value: 1 },
                                  { label: '2nd Floor', value: 2 },
                                  { label: '3rd Floor+', value: 3 },
                                ]}
                              />
                            </Form.Item>
                          ) : null
                        }
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_plumbing" valuePropName="checked" style={{ marginBottom: 4 }}>
                        <Checkbox>Plumbing + Sink/Faucet/Disposal</Checkbox>
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_plumbing !== cur.include_plumbing}>
                        {({ getFieldValue }) =>
                          getFieldValue('include_plumbing') ? (
                            <div style={{ marginLeft: 24 }}>
                              <Form.Item name="sink_type" label="Sink Type" preserve style={{ marginBottom: 4 }}>
                                <Select size="small" style={{ width: 180 }} options={priceInfo.sinkOptions} />
                              </Form.Item>
                              {/* P-trap, supply lines and angle stops always
                                  come with the plumbing scope; these are the
                                  extras that depend on the kitchen. */}
                              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>
                                Under-sink extras (1 sink)
                              </Text>
                              <Form.Item name="include_dw_hookup" valuePropName="checked" preserve style={{ marginBottom: 0 }}>
                                <Checkbox style={{ fontSize: 12 }}>DW supply line + angle stop</Checkbox>
                              </Form.Item>
                              <Form.Item name="include_aav" valuePropName="checked" preserve style={{ marginBottom: 0 }}>
                                <Checkbox style={{ fontSize: 12 }}>AAV / loop vent</Checkbox>
                              </Form.Item>
                              <Form.Item name="include_air_gap" valuePropName="checked" preserve style={{ marginBottom: 0 }}>
                                <Checkbox style={{ fontSize: 12 }}>Air gap</Checkbox>
                              </Form.Item>
                              <Form.Item name="include_soap_dispenser" valuePropName="checked" preserve style={{ marginBottom: 0 }}>
                                <Checkbox style={{ fontSize: 12 }}>Soap dispenser</Checkbox>
                              </Form.Item>
                              <Form.Item name="include_instant_hot" valuePropName="checked" preserve style={{ marginBottom: 0 }}>
                                <Checkbox style={{ fontSize: 12 }}>Instant hot water dispenser</Checkbox>
                              </Form.Item>
                            </div>
                          ) : null
                        }
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_countertop !== cur.include_countertop}>
                        {({ getFieldValue }) => {
                          const hasNewCountertop = getFieldValue('include_countertop');
                          if (hasNewCountertop) {
                            form.setFieldsValue({ include_countertop_reset: false });
                          }
                          return (
                            <Form.Item name="include_countertop_reset" valuePropName="checked">
                              <Checkbox disabled={hasNewCountertop}>
                                Countertop Reset
                                {hasNewCountertop && (
                                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
                                    (N/A — new countertop selected)
                                  </Text>
                                )}
                              </Checkbox>
                            </Form.Item>
                          );
                        }}
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_hardware" valuePropName="checked">
                        <Checkbox>Cabinet Hardware (Knobs/Pulls)</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_crown_molding" valuePropName="checked">
                        <Checkbox>Crown Molding (Wall Cabinets)</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_toe_kick" valuePropName="checked">
                        <Checkbox>Toe Kick</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_quarter_round" valuePropName="checked">
                        <Checkbox>Quarter Round (Base Cabinets)</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_appliance_rr" valuePropName="checked">
                        <Checkbox>Appliance Detach & Reset</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_dumpster" valuePropName="checked">
                        <Checkbox>Dumpster / Trash Disposal</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_electrical" valuePropName="checked">
                        <Checkbox>Electrical Disconnect/Reconnect</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_permit" valuePropName="checked">
                        <Checkbox>Permit Allowance</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="Outlet Relocations" name="outlet_relocation_count" style={{ marginBottom: 8 }}>
                        <InputNumber min={0} max={10} size="small" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>

                  {/* Trim & finished panels — present on nearly every
                      kitchen, so these are counted rather than assumed. */}
                  <div style={{ borderTop: '1px solid #f0f0f0', margin: '8px 0 12px', paddingTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                      Trim &amp; Finished Panels
                      <span style={{ marginLeft: 8, color: '#6b7280' }}>
                        — the Sketch tab counts these from the drawing: Trim &amp; panels → Use in estimate
                      </span>
                    </Text>
                    <Row gutter={16}>
                      <Col xs={12} md={8}>
                        <Form.Item
                          label="Fillers / Scribe"
                          name="filler_count"
                          style={{ marginBottom: 8 }}
                          tooltip="Filler strips at run ends and inside corners. Walls are never plumb, so most kitchens need 2-6."
                        >
                          <InputNumber min={0} max={30} size="small" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item
                          label="Angled Joints"
                          name="angled_joint_count"
                          style={{ marginBottom: 8 }}
                          tooltip='Places a run or island turns at an angle other than 90°. Each adds a 45° angled filler and fitting, plus an angled countertop cut when a countertop is in scope. Angled tops also waste 20-35% more slab — add that to the countertop SF.'
                        >
                          <InputNumber min={0} max={20} size="small" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item
                          label="Base End Panels"
                          name="end_panel_base"
                          style={{ marginBottom: 8 }}
                          tooltip="Finished panel where a base run ends in open space."
                        >
                          <InputNumber min={0} max={20} size="small" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item
                          label="Wall End Panels"
                          name="end_panel_wall"
                          style={{ marginBottom: 8 }}
                        >
                          <InputNumber min={0} max={20} size="small" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item
                          label="Tall End Panels"
                          name="end_panel_tall"
                          style={{ marginBottom: 8 }}
                        >
                          <InputNumber min={0} max={20} size="small" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item
                          label="Fridge Deep Panels"
                          name="end_panel_refrigerator"
                          style={{ marginBottom: 8 }}
                          tooltip="24&quot;-deep finished panel beside a refrigerator opening."
                        >
                          <InputNumber min={0} max={10} size="small" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item
                          label="DW Return Panels"
                          name="dishwasher_return_panel_count"
                          style={{ marginBottom: 8 }}
                          tooltip="Finished filler between the dishwasher opening and the adjacent cabinet or wall."
                        >
                          <InputNumber min={0} max={5} size="small" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item name="include_light_rail" valuePropName="checked" style={{ marginBottom: 8 }}>
                          <Checkbox>Light Rail Molding</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_light_rail !== cur.include_light_rail}>
                          {({ getFieldValue }) => {
                            if (!getFieldValue('include_light_rail')) return null;
                            return (
                              <Form.Item
                                label="Light Rail (LF)"
                                name="light_rail_lf"
                                style={{ marginBottom: 8 }}
                                tooltip="Leave blank to use the total wall cabinet run."
                              >
                                <InputNumber min={0} max={200} step={0.5} size="small" style={{ width: '100%' }} placeholder="auto" />
                              </Form.Item>
                            );
                          }}
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>

                  {/* Appliance list (shown when Appliance R&R checked) */}
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_appliance_rr !== cur.include_appliance_rr}>
                    {({ getFieldValue }) => {
                      if (!getFieldValue('include_appliance_rr')) return null;
                      return (
                        <div style={{ borderTop: '1px solid #f0f0f0', margin: '8px 0 12px', paddingTop: 8 }}>
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                            Select appliances to detach & reset:
                          </Text>
                          <Form.Item name="appliance_list" noStyle preserve>
                            <ApplianceSelector options={priceInfo.applianceOptions} />
                          </Form.Item>
                        </div>
                      );
                    }}
                  </Form.Item>
                </Card>

                {/* Countertop (Perimeter) */}
                <Card size="small" {...section('countertop', 'Countertop')}>
                  <Form.Item name="include_countertop" valuePropName="checked">
                    <Checkbox>Include Countertop</Checkbox>
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_countertop !== cur.include_countertop}>
                    {({ getFieldValue }) => {
                      if (!getFieldValue('include_countertop')) return null;
                      const perimBaseLf = perimeterBoxes
                        .filter((b) => b.cab_type === 'base')
                        .reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
                      const suggestedSf = Math.round(perimBaseLf * 2.125 * 10) / 10;
                      return (
                        <>
                        <Row gutter={16}>
                          <Col xs={24}>
                            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                              Perimeter countertop (Island countertop은 Island 카드에서 입력)
                            </Text>
                          </Col>
                          <Col xs={12}>
                            <Form.Item name="countertop_material" label="Material" preserve>
                              <Select
                                placeholder="Select material"
                                options={priceInfo.countertopOptions}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={12}>
                            <Form.Item name="countertop_sqft" label="Area (SF)" preserve>
                              <InputNumber min={0} max={500} step={0.5} style={{ width: '100%' }} addonAfter="SF" />
                            </Form.Item>
                            {suggestedSf > 0 && (
                              <Space size={4}>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  Perimeter Base LF({perimBaseLf.toFixed(1)}) x 2.125ft =
                                </Text>
                                <Button
                                  type="link"
                                  size="small"
                                  style={{ padding: 0, fontSize: 12, height: 'auto' }}
                                  onClick={() => form.setFieldsValue({ countertop_sqft: suggestedSf })}
                                >
                                  {suggestedSf} SF 적용
                                </Button>
                              </Space>
                            )}
                          </Col>
                        </Row>
                        <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12 }}>
                          <Form.Item name="include_countertop_backsplash" valuePropName="checked" style={{ marginBottom: 4 }}>
                            <Checkbox>4" Countertop Backsplash (matching material)</Checkbox>
                          </Form.Item>
                          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_countertop_backsplash !== cur.include_countertop_backsplash}>
                            {({ getFieldValue: gfv2 }) => {
                              if (!gfv2('include_countertop_backsplash')) return null;
                              return (
                                <Row gutter={16} style={{ marginLeft: 24 }}>
                                  <Col xs={12}>
                                    <Form.Item name="countertop_backsplash_lf" label="Length (LF)" preserve>
                                      <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} addonAfter="LF" />
                                    </Form.Item>
                                    {perimBaseLf > 0 && (
                                      <Space size={4}>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                          Perimeter Base =
                                        </Text>
                                        <Button
                                          type="link"
                                          size="small"
                                          style={{ padding: 0, fontSize: 12, height: 'auto' }}
                                          onClick={() => form.setFieldsValue({ countertop_backsplash_lf: Math.round(perimBaseLf * 10) / 10 })}
                                        >
                                          {perimBaseLf.toFixed(1)} LF 적용
                                        </Button>
                                      </Space>
                                    )}
                                    <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                                      Measured along the walls: Sketch tab → Backsplash → Use in estimate
                                    </Text>
                                  </Col>
                                  <Col xs={12}>
                                    <Form.Item label="Unit Price">
                                      <Text type="secondary">
                                        ${priceInfo.ctBacksplashPerLf[getFieldValue('countertop_material') || ''] || '—'}/LF
                                      </Text>
                                    </Form.Item>
                                  </Col>
                                </Row>
                              );
                            }}
                          </Form.Item>
                        </div>
                        </>
                      );
                    }}
                  </Form.Item>
                </Card>

                {/* Drywall & Painting */}
                <Card size="small" {...section('drywall', 'Drywall & Painting', drywallSummary)}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    Cabinet 제거 후 벽면 수리 및 도장. 면적은 wall cabinet 뒤쪽 벽 기준.
                  </Text>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item name="include_drywall_repair" valuePropName="checked">
                        <Checkbox>Drywall Repair</Checkbox>
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_drywall_repair !== cur.include_drywall_repair}>
                        {({ getFieldValue }) => {
                          if (!getFieldValue('include_drywall_repair')) return null;
                          const totalLf = allBoxes.reduce((sum, b) => {
                            if (b.cab_type === 'base' || b.cab_type === 'wall')
                              return sum + (b.width_inches * b.qty) / 12;
                            return sum;
                          }, 0);
                          const suggestedDwSf = Math.round(totalLf * 4 * 10) / 10;
                          return (
                            <div style={{ marginLeft: 24 }}>
                              <Form.Item name="drywall_repair_type" label="Type" preserve style={{ marginBottom: 8 }}>
                                <Select
                                  size="small"
                                  style={{ width: 280 }}
                                  options={priceInfo.drywallOptions}
                                />
                              </Form.Item>
                              <Form.Item name="drywall_repair_sqft" label="Area (SF)" preserve>
                                <InputNumber min={0} max={1000} step={0.5} style={{ width: '100%' }} addonAfter="SF" />
                              </Form.Item>
                              {suggestedDwSf > 0 && (
                                <Button
                                  type="link"
                                  size="small"
                                  style={{ padding: 0, fontSize: 12, height: 'auto' }}
                                  onClick={() => form.setFieldsValue({ drywall_repair_sqft: suggestedDwSf })}
                                >
                                  추천: {suggestedDwSf} SF 적용 (LF x 4ft)
                                </Button>
                              )}
                            </div>
                          );
                        }}
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="include_painting" valuePropName="checked">
                        <Checkbox>Prep, Prime & Paint</Checkbox>
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate={(prev, cur) =>
                        prev.include_painting !== cur.include_painting ||
                        prev.drywall_repair_sqft !== cur.drywall_repair_sqft
                      }>
                        {({ getFieldValue }) => {
                          if (!getFieldValue('include_painting')) return null;
                          const dwSf = getFieldValue('drywall_repair_sqft');
                          return (
                            <div>
                              <Form.Item name="painting_sqft" label="Paint Area (SF)" preserve>
                                <InputNumber min={0} max={1000} step={0.5} style={{ width: '100%' }} addonAfter="SF" />
                              </Form.Item>
                              {dwSf > 0 && (
                                <Button
                                  type="link"
                                  size="small"
                                  style={{ padding: 0, fontSize: 12, height: 'auto' }}
                                  onClick={() => form.setFieldsValue({ painting_sqft: dwSf })}
                                >
                                  Drywall과 동일: {dwSf} SF 적용
                                </Button>
                              )}
                            </div>
                          );
                        }}
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Backsplash */}
                <Card size="small" {...section('backsplash', 'Backsplash', backsplashSummary)}>
                  <Form.Item name="include_backsplash" valuePropName="checked">
                    <Checkbox>Include Backsplash</Checkbox>
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(prev, cur) =>
                    prev.include_backsplash !== cur.include_backsplash ||
                    prev.backsplash_height_inches !== cur.backsplash_height_inches
                  }>
                    {({ getFieldValue }) => {
                      if (!getFieldValue('include_backsplash')) return null;
                      // Island bases take no backsplash.
                      const baseLf = perimeterBoxes
                        .filter((b) => b.cab_type === 'base')
                        .reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
                      const heightInches = getFieldValue('backsplash_height_inches') || 18;
                      const suggestedSf = Math.round(baseLf * (heightInches / 12) * 10) / 10;
                      // Just ticked, no area yet: start from the perimeter bases' length.
                      if (suggestedSf > 0 && getFieldValue('backsplash_sqft') == null) {
                        setTimeout(() => form.setFieldsValue({ backsplash_sqft: suggestedSf }), 0);
                      }
                      return (
                        <div>
                          <Row gutter={16}>
                            <Col xs={24} md={8}>
                              <Form.Item name="backsplash_type" label="Backsplash Type" preserve>
                                <Select
                                  placeholder="Select type"
                                  options={pricingInfo?.backsplash_types?.map((bt) => ({
                                    label: `${bt.label} ($${bt.material_per_sf + bt.install_per_sf}/SF)`,
                                    value: bt.key,
                                  }))}
                                />
                              </Form.Item>
                            </Col>
                            <Col xs={12} md={8}>
                              <Form.Item name="backsplash_height_inches" label="Height (inches)" preserve>
                                <InputNumber
                                  min={4}
                                  max={48}
                                  step={1}
                                  style={{ width: '100%' }}
                                  addonAfter="in"
                                />
                              </Form.Item>
                            </Col>
                            <Col xs={12} md={8}>
                              <Form.Item name="backsplash_sqft" label="Area (SF)" preserve style={{ marginBottom: 4 }}>
                                <InputNumber min={0} max={1000} step={0.5} style={{ width: '100%' }} addonAfter="SF" />
                              </Form.Item>
                            </Col>
                          </Row>
                          <Space size={4} wrap>
                            {suggestedSf > 0 && (
                              <>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  Perimeter Base LF({baseLf.toFixed(1)}) × {heightInches}&quot; =
                                </Text>
                                <Button
                                  type="link"
                                  size="small"
                                  style={{ padding: 0, fontSize: 12, height: 'auto' }}
                                  onClick={() => form.setFieldsValue({ backsplash_sqft: suggestedSf })}
                                >
                                  {suggestedSf} SF 적용
                                </Button>
                              </>
                            )}
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              · measured along the walls: Sketch tab → Backsplash → Use in estimate
                            </Text>
                          </Space>
                        </div>
                      );
                    }}
                  </Form.Item>
                </Card>
              </Col>

              {/* Right column: O&P + Notes */}
              <Col xs={24} lg={split ? 24 : 8}>
                <Card size="small" {...section('price', 'Overhead & Profit')}>
                  <Form.Item name="overhead_pct" label="Overhead (%)">
                    <InputNumber min={0} max={50} style={{ width: '100%' }} addonAfter="%" />
                  </Form.Item>
                  <Form.Item name="profit_pct" label="Profit (%)">
                    <InputNumber min={0} max={50} style={{ width: '100%' }} addonAfter="%" />
                  </Form.Item>
                </Card>

                <Card size="small" className="ui-sheet-card" title="Target Price" id={sectionId('target')} style={{ scrollMarginTop: 8 }}>
                  <Text type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 12 }}>
                    Set the total you want, and every line scales to it when you calculate.
                  </Text>
                  <Row gutter={8} align="middle">
                    <Col flex="auto">
                      <Form.Item label="Target Total ($)" name="target_total" style={{ marginBottom: 4 }}>
                        <InputNumber
                          style={{ width: '100%' }}
                          min={0}
                          step={1000}
                          formatter={(v) => v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                          parser={(v) => (v ? Number(v.replace(/,/g, '')) : 0) as any}
                          placeholder="e.g. 25000"
                        />
                      </Form.Item>
                    </Col>
                    <Col>
                      <Button
                        type="dashed"
                        size="small"
                        style={{ marginTop: 4 }}
                        onClick={() => {
                          form.setFieldsValue({ target_total: null });
                          message.info('Target cleared. Click Calculate to restore original pricing.');
                        }}
                      >
                        Clear
                      </Button>
                    </Col>
                  </Row>
                  {estimate.adjustment_factor && (
                    <div className="ce-field" style={{ marginTop: 8 }}>
                      <span className="ce-field-label">Lines scaled by</span>
                      <span className="ce-field-value">
                        {estimate.adjustment_factor.toFixed(4)}×{' '}
                        <span style={{ color: '#6b7280' }}>
                          ({estimate.adjustment_factor > 1 ? 'up' : 'down'} {Math.abs((estimate.adjustment_factor - 1) * 100).toFixed(1)}%)
                        </span>
                      </span>
                    </div>
                  )}
                </Card>

                <Card size="small" className="ui-sheet-card" title="PDF Overview">
                  <Form.Item name="overview_text">
                    <Input.TextArea
                      rows={4}
                      placeholder="All cabinets will feature matching industrial-grade cabinet board surfaces..."
                    />
                  </Form.Item>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Leave blank to use default text. Shown at top of PDF.
                  </Text>
                </Card>

                <Card size="small" {...section('notes', 'Notes')}>
                  <Form.Item name="notes">
                    <Input.TextArea rows={3} placeholder="Internal notes (not shown on PDF)..." />
                  </Form.Item>
                </Card>

                {/* Beside the drawing the total heads Inspect instead */}
                {!split && estimate.total > 0 && (
                  <div style={{ marginBottom: 28 }}>
                    <Text type="secondary" style={{ fontSize: 13 }}>Current total</Text>
                    <div className="ce-total-value">{money(estimate.total)}</div>
                    {stale && <div className="ce-stale"><span>Changed since the last calculation</span></div>}
                  </div>
                )}

                <CabinetEstimateHistory estimateId={id!} />
              </Col>
            </Row>
          </Form>
            </div>
          </div>
        </div>
      </div>

      {visitedTabs.has('result') && (
        <div role="tabpanel" aria-label="Estimate result" hidden={shownTab !== 'result'}>
          {draft ? (
            <Text type="secondary">Calculate the estimate to see its lines.</Text>
          ) : (
            <CabinetEstimateResult estimate={estimate} />
          )}
        </div>
      )}
      {visitedTabs.has('purchase-order') && !!estimate.boxes?.length && (
        <div role="tabpanel" aria-label="Purchase order" hidden={shownTab !== 'purchase-order'}>
          <CabinetPurchaseOrder estimateId={id!} />
        </div>
      )}
    </div>
  );
};

/**
 * Each estimate of a job opens at its own URL. Switching between them starts
 * the page fresh, so no form field, sketch or tab state carries across.
 */
const CabinetEstimateDetailRoute: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return <CabinetEstimateDetail key={id} />;
};

export default CabinetEstimateDetailRoute;
