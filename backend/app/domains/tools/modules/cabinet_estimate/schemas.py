"""
Cabinet Estimate Pydantic schemas
"""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field

# ── Enums / Constants ──

class CabinetTier:
    STOCK = "Stock"
    SEMI_CUSTOM = "Semi-Custom"
    CUSTOM = "Custom"

    @classmethod
    def choices(cls):
        return [cls.STOCK, cls.SEMI_CUSTOM, cls.CUSTOM]


class BoxMaterial:
    PLYWOOD = "Plywood"
    MDF = "MDF"
    PARTICLE = "Particle"

    @classmethod
    def choices(cls):
        return [cls.PLYWOOD, cls.MDF, cls.PARTICLE]


class FinishType:
    STAINED = "Stained"
    PAINTED = "Painted"
    GLAZED = "Glazed"
    LAMINATE = "Laminate"

    @classmethod
    def choices(cls):
        return [cls.STAINED, cls.PAINTED, cls.GLAZED, cls.LAMINATE]


class CabType:
    BASE = "base"
    WALL = "wall"
    TALL = "tall"
    SPECIALTY = "specialty"

    @classmethod
    def choices(cls):
        return [cls.BASE, cls.WALL, cls.TALL, cls.SPECIALTY]


class EstimateStatus:
    DRAFT = "draft"
    CALCULATED = "calculated"
    APPROVED = "approved"
    EXPORTED = "exported"

    @classmethod
    def choices(cls):
        return [cls.DRAFT, cls.CALCULATED, cls.APPROVED, cls.EXPORTED]


# ── Box schemas ──

class CabinetBoxBase(BaseModel):
    code: str = Field(
        ..., max_length=20,
        description="Cabinet code e.g. B30, SB36",
    )
    cab_type: str = Field(
        ..., max_length=20,
        description="base/wall/tall/specialty",
    )
    location: str = Field(
        "perimeter", max_length=20,
        description="perimeter or island",
    )
    width_inches: int = Field(..., ge=6, le=60)
    height_inches: float = Field(..., ge=6, le=120)
    is_specialty: bool = False
    specialty_type: Optional[str] = Field(None, max_length=50)
    has_glass_door: bool = False
    range_panel_count: Optional[int] = Field(None, ge=0, le=2)
    door_pattern: Optional[str] = Field(None, max_length=30)
    qty: int = Field(1, ge=1)
    display_order: int = 0


class CabinetBoxCreate(CabinetBoxBase):
    pass


class CabinetBoxUpdate(BaseModel):
    code: Optional[str] = Field(None, max_length=20)
    cab_type: Optional[str] = Field(None, max_length=20)
    location: Optional[str] = Field(None, max_length=20)
    width_inches: Optional[int] = Field(None, ge=6, le=60)
    height_inches: Optional[float] = Field(None, ge=6, le=120)
    is_specialty: Optional[bool] = None
    specialty_type: Optional[str] = Field(None, max_length=50)
    has_glass_door: Optional[bool] = None
    range_panel_count: Optional[int] = Field(None, ge=0, le=2)
    door_pattern: Optional[str] = Field(None, max_length=30)
    qty: Optional[int] = Field(None, ge=1)
    display_order: Optional[int] = None


class CabinetBoxResponse(CabinetBoxBase):
    id: str
    estimate_id: str
    location: str = "perimeter"
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Line item schemas ──

class LineItemResponse(BaseModel):
    id: str
    estimate_id: str
    description: str
    quantity: float
    unit: str
    unit_price: float
    total: float
    # Breakdown of unit_price / total. The PDF quotes the combined figures.
    material_unit_price: float = 0
    labor_unit_price: float = 0
    material_total: float = 0
    labor_total: float = 0
    category: Optional[str] = None
    location: str = "perimeter"
    notes: Optional[str] = None
    display_order: int = 0
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Estimate schemas ──

class CabinetEstimateBase(BaseModel):
    # The Scopit customer the kitchen belongs to; the company is always the
    # signed-in user's own.
    customer_id: Optional[str] = None
    # An insurance job's claim number, as printed on the PDF
    claim_number: Optional[str] = Field(None, max_length=100)
    property_address: Optional[str] = Field(None, max_length=500)
    zip_code: Optional[str] = Field(None, max_length=10)
    layout_type: Optional[str] = Field(None, max_length=50)
    kitchen_size_sqft: Optional[float] = None
    ceiling_height: Optional[float] = None
    has_soffit: bool = False
    tier: Optional[str] = Field(None, max_length=50)
    box_material: Optional[str] = Field(None, max_length=50)
    finish: Optional[str] = Field(None, max_length=50)
    door_style: Optional[str] = Field(None, max_length=50)
    overlay_style: Optional[str] = Field(None, max_length=50)
    pricing_basis: Optional[str] = Field(
        "INSURANCE_DR",
        description="INSURANCE_DR (claim) or RETAIL_INSTALL (remodel)",
    )
    include_demo: bool = True
    include_install: bool = True
    include_delivery: bool = True
    include_plumbing: bool = False
    sink_type: Optional[str] = "single"
    include_aav: bool = False
    include_air_gap: bool = False
    include_soap_dispenser: bool = False
    include_instant_hot: bool = False
    include_dw_hookup: bool = False
    include_countertop_reset: bool = False
    include_hardware: bool = True
    include_crown_molding: bool = False
    include_backsplash: bool = False
    backsplash_type: Optional[str] = None
    backsplash_sqft: Optional[float] = None
    include_toe_kick: bool = True
    include_quarter_round: bool = False
    include_countertop: bool = False
    include_drywall_repair: bool = False
    drywall_repair_type: Optional[str] = "patch"
    drywall_repair_sqft: Optional[float] = None
    include_painting: bool = False
    painting_sqft: Optional[float] = None
    include_appliance_rr: bool = False
    appliance_list: Optional[List[dict]] = None
    include_dumpster: bool = True
    include_electrical: bool = False
    include_permit: bool = False
    filler_count: int = 0
    angled_joint_count: int = 0
    island_seating_overhang_in: Optional[float] = None
    countertop_support_count: int = 0
    end_panel_counts: Optional[Dict[str, int]] = Field(
        None,
        description='Finished end panels, e.g. {"base": 2, "wall": 1}',
    )
    dishwasher_return_panel_count: int = 0
    include_light_rail: bool = False
    light_rail_lf: Optional[float] = None
    outlet_relocation_count: int = 0
    delivery_floor: int = 1
    island_type: str = Field(
        "custom", description="custom or prefab",
    )
    island_prefab_size: Optional[str] = Field(
        None, description="small/medium/large/xl",
    )
    island_prefab_price: Optional[float] = Field(
        None, description="User-overridable prefab supply price",
    )
    island_end_panel_sqft: float = 0
    island_back_panel_sqft: float = 0
    # Cabinets on both long sides, back to back: no back panel, no seating side
    island_two_sided: bool = False
    countertop_material: Optional[str] = None
    countertop_sqft: Optional[float] = None
    include_countertop_backsplash: Optional[bool] = False
    countertop_backsplash_lf: Optional[float] = None
    island_countertop_material: Optional[str] = None
    island_countertop_sqft: Optional[float] = None
    overview_text: Optional[str] = None
    target_total: Optional[float] = None
    overhead_pct: float = 0.15
    profit_pct: float = 0.15
    notes: Optional[str] = None


class CabinetEstimateCreate(CabinetEstimateBase):
    boxes: List[CabinetBoxCreate] = []
    # insurance → the new estimate is the restoration; remodel → Option A
    project_type: Literal["insurance", "remodel"] = "insurance"


class CabinetEstimateUpdate(BaseModel):
    customer_id: Optional[str] = None
    claim_number: Optional[str] = Field(None, max_length=100)
    property_address: Optional[str] = Field(None, max_length=500)
    zip_code: Optional[str] = Field(None, max_length=10)
    layout_type: Optional[str] = Field(None, max_length=50)
    kitchen_size_sqft: Optional[float] = None
    ceiling_height: Optional[float] = None
    has_soffit: Optional[bool] = None
    tier: Optional[str] = Field(None, max_length=50)
    box_material: Optional[str] = Field(None, max_length=50)
    finish: Optional[str] = Field(None, max_length=50)
    door_style: Optional[str] = Field(None, max_length=50)
    overlay_style: Optional[str] = Field(None, max_length=50)
    pricing_basis: Optional[str] = None
    include_demo: Optional[bool] = None
    include_install: Optional[bool] = None
    include_delivery: Optional[bool] = None
    include_plumbing: Optional[bool] = None
    sink_type: Optional[str] = None
    include_aav: Optional[bool] = None
    include_air_gap: Optional[bool] = None
    include_soap_dispenser: Optional[bool] = None
    include_instant_hot: Optional[bool] = None
    include_dw_hookup: Optional[bool] = None
    include_countertop_reset: Optional[bool] = None
    include_hardware: Optional[bool] = None
    include_crown_molding: Optional[bool] = None
    include_backsplash: Optional[bool] = None
    backsplash_type: Optional[str] = None
    backsplash_sqft: Optional[float] = None
    include_toe_kick: Optional[bool] = None
    include_quarter_round: Optional[bool] = None
    include_countertop: Optional[bool] = None
    include_drywall_repair: Optional[bool] = None
    drywall_repair_type: Optional[str] = None
    drywall_repair_sqft: Optional[float] = None
    include_painting: Optional[bool] = None
    painting_sqft: Optional[float] = None
    include_appliance_rr: Optional[bool] = None
    appliance_list: Optional[List[dict]] = None
    include_dumpster: Optional[bool] = None
    include_electrical: Optional[bool] = None
    include_permit: Optional[bool] = None
    filler_count: Optional[int] = None
    angled_joint_count: Optional[int] = None
    island_seating_overhang_in: Optional[float] = None
    countertop_support_count: Optional[int] = None
    end_panel_counts: Optional[Dict[str, int]] = None
    dishwasher_return_panel_count: Optional[int] = None
    include_light_rail: Optional[bool] = None
    light_rail_lf: Optional[float] = None
    outlet_relocation_count: Optional[int] = None
    delivery_floor: Optional[int] = None
    island_type: Optional[str] = None
    island_prefab_size: Optional[str] = None
    island_prefab_price: Optional[float] = None
    island_end_panel_sqft: Optional[float] = None
    island_back_panel_sqft: Optional[float] = None
    island_two_sided: Optional[bool] = None
    countertop_material: Optional[str] = None
    countertop_sqft: Optional[float] = None
    include_countertop_backsplash: Optional[bool] = False
    countertop_backsplash_lf: Optional[float] = None
    island_countertop_material: Optional[str] = None
    island_countertop_sqft: Optional[float] = None
    overview_text: Optional[str] = None
    target_total: Optional[float] = None
    overhead_pct: Optional[float] = None
    profit_pct: Optional[float] = None
    notes: Optional[str] = None
    boxes: Optional[List[CabinetBoxCreate]] = None


# ── Estimate group schemas ──

class GroupMemberSummary(BaseModel):
    """One estimate of a kitchen job, as the group switcher shows it."""
    id: str
    kind: str
    option_label: Optional[str] = None
    option_order: int = 0
    status: str
    total: float = 0
    updated_at: Optional[datetime] = None


class OptionLabelUpdate(BaseModel):
    option_label: str = Field(..., min_length=1, max_length=100)


class ProjectTypeUpdate(BaseModel):
    project_type: Literal["insurance", "remodel"]


class SelectionUpdate(BaseModel):
    """The library product to put in an option's slot."""
    product_id: UUID


class CabinetEstimateResponse(BaseModel):
    id: str
    customer_id: Optional[str] = None
    company_id: Optional[str] = None
    created_by_id: Optional[str] = None
    status: str

    # Estimate group
    group_id: Optional[str] = None
    project_type: str = "insurance"
    kind: str = "restore"
    option_label: Optional[str] = None
    option_order: int = 0
    group_members: List[GroupMemberSummary] = []
    # An option's products by slot (selections.SLOTS), each a ProductSnapshot
    selections: Optional[Dict[str, Dict[str, Any]]] = None
    property_address: Optional[str] = None
    zip_code: Optional[str] = None
    layout_type: Optional[str] = None
    kitchen_size_sqft: Optional[float] = None
    ceiling_height: Optional[float] = None
    has_soffit: bool = False
    tier: Optional[str] = None
    box_material: Optional[str] = None
    finish: Optional[str] = None
    door_style: Optional[str] = None
    overlay_style: Optional[str] = None
    pricing_basis: Optional[str] = "INSURANCE_DR"
    include_demo: bool = True
    include_install: bool = True
    include_delivery: bool = True
    include_plumbing: bool = False
    sink_type: Optional[str] = "single"
    include_aav: bool = False
    include_air_gap: bool = False
    include_soap_dispenser: bool = False
    include_instant_hot: bool = False
    include_dw_hookup: bool = False
    include_countertop_reset: bool = False
    include_hardware: bool = True
    include_crown_molding: bool = False
    include_backsplash: bool = False
    backsplash_type: Optional[str] = None
    backsplash_sqft: Optional[float] = None
    include_toe_kick: bool = True
    include_quarter_round: bool = False
    include_countertop: bool = False
    include_drywall_repair: bool = False
    drywall_repair_type: Optional[str] = "patch"
    drywall_repair_sqft: Optional[float] = None
    include_painting: bool = False
    painting_sqft: Optional[float] = None
    include_appliance_rr: bool = False
    appliance_list: Optional[List[dict]] = None
    include_dumpster: bool = True
    include_electrical: bool = False
    include_permit: bool = False
    filler_count: int = 0
    angled_joint_count: int = 0
    island_seating_overhang_in: Optional[float] = None
    countertop_support_count: int = 0
    end_panel_counts: Optional[Dict[str, int]] = None
    dishwasher_return_panel_count: int = 0
    include_light_rail: bool = False
    light_rail_lf: Optional[float] = None
    outlet_relocation_count: int = 0
    delivery_floor: int = 1
    island_type: str = "custom"
    island_prefab_size: Optional[str] = None
    island_prefab_price: Optional[float] = None
    island_end_panel_sqft: float = 0
    island_back_panel_sqft: float = 0
    island_two_sided: Optional[bool] = False
    countertop_material: Optional[str] = None
    countertop_sqft: Optional[float] = None
    include_countertop_backsplash: Optional[bool] = False
    countertop_backsplash_lf: Optional[float] = None
    island_countertop_material: Optional[str] = None
    island_countertop_sqft: Optional[float] = None
    overview_text: Optional[str] = None
    target_total: Optional[float] = None
    subtotal: float = 0
    overhead_pct: float = 0.15
    overhead_amount: float = 0
    profit_pct: float = 0.15
    profit_amount: float = 0
    adjustment_factor: Optional[float] = None
    total: float = 0
    methodology_notes: Optional[str] = None
    warning_flags: Optional[List[str]] = None
    notes: Optional[str] = None
    boxes: List[CabinetBoxResponse] = []
    line_items: List[LineItemResponse] = []
    claim_number: Optional[str] = None
    # The linked customer's name (populated by service)
    client_name: Optional[str] = None
    # The Scopit estimate this was last sent to, if any
    scopit_estimate_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CabinetEstimateListResponse(BaseModel):
    items: List[CabinetEstimateResponse]
    total: int
    page: int
    page_size: int


class CabinetEstimateGroupResponse(BaseModel):
    """Every estimate of a kitchen job with its line items, for comparing them."""
    group_id: str
    project_type: str
    members: List[CabinetEstimateResponse]


# ── History schemas ──

class HistoryResponse(BaseModel):
    id: str
    estimate_id: str
    version_number: int
    snapshot_data: Dict[str, Any]
    changed_by_id: Optional[str] = None
    change_description: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Purchase order schemas ──

class PurchaseOrderItem(BaseModel):
    code: str
    description: str
    cab_type: str
    width_inches: int
    height_inches: float
    qty: int


class PurchaseOrderResponse(BaseModel):
    estimate_id: str
    property_address: Optional[str] = None
    items: List[PurchaseOrderItem]
    total_boxes: int


# ── Pricing info (for frontend dropdowns) ──

class PricingInfoResponse(BaseModel):
    tiers: List[str]
    materials: List[str]
    finishes: List[str]
    door_styles: List[str]
    overlay_styles: List[str]
    # Selectable pricing bases: [{key, label, description}]
    pricing_bases: List[Dict[str, str]]
    layout_types: List[str]
    cab_types: List[str]
    specialty_types: List[str]
    # {type_key: label} - finished end panel options
    end_panel_types: Dict[str, str]
    # Most entries are a flat rate, but the install labor keys are
    # tier-keyed ({"Stock": ..., "Semi-Custom": ..., "Custom": ...}).
    scope_items: Dict[str, Union[float, Dict[str, float]]]
    backsplash_types: List[Dict[str, Any]]
    glass_door_premiums: Dict[str, float]
    crown_molding_pricing: Dict[str, float]
    island_panel_pricing: Dict[str, Any]
    prefab_island_pricing: Dict[str, Any]
    prefab_island_install: Dict[str, float]
    tall_cabinet_types: Dict[str, Dict[str, float]]
    # {key: {label, cost}} - detach & reset price per appliance
    appliance_rr_pricing: Dict[str, Dict[str, Any]]
    # {material: {label, rate}} - countertop supply+install per SF
    countertop_materials: Dict[str, Dict[str, Any]]
    # {material: rate} - 4" matching backsplash piece per LF
    countertop_backsplash_per_lf: Dict[str, float]
    # When an island top's seating overhang needs brackets, and how many:
    # {max_unsupported_in: {material: in}, spacing_in, end_inset_in}
    countertop_support_rule: Dict[str, Any] = Field(default_factory=dict)
    # An option's product slots: [{key, label, category, prices}]
    selection_slots: List[Dict[str, str]] = Field(default_factory=list)
