"""
Scopit - Bathroom Estimate schemas

Ported from MJ Estimate. An estimate links a Scopit customer and keeps the
claim number itself, where MJ linked a claim; the company is the signed-in
user's, never sent.
"""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.domains.unit_prices.schemas import PriceBookSummary

# ── Estimate schemas ──

class BathroomEstimateBase(BaseModel):
    # One of the company's customers
    customer_id: Optional[str] = None
    # An insurance job's claim number
    claim_number: Optional[str] = Field(None, max_length=100)

    # Project meta
    property_address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=5)
    zip_code: Optional[str] = Field(None, max_length=10)
    building_type: Optional[str] = Field(None, max_length=50)
    year_built: Optional[int] = None

    # Bathroom info
    designation: Optional[str] = Field(None, max_length=50)
    bath_function: Optional[str] = Field(None, max_length=50)
    length_ft: Optional[float] = None
    width_ft: Optional[float] = None
    height_ft: Optional[float] = 8.0
    floor_sf: Optional[float] = None
    wall_sf: Optional[float] = None

    # Demo flags
    demo_floor: bool = False
    demo_floor_sf: Optional[float] = None
    demo_walls: bool = False
    demo_wall_sf: Optional[float] = None
    demo_ceiling: bool = False
    demo_ceiling_sf: Optional[float] = None
    replace_shower: bool = False
    replace_tub: bool = False
    replace_vanity: bool = False
    replace_toilet: bool = False
    detach_reset_shower: bool = False
    detach_reset_tub: bool = False
    detach_reset_vanity: bool = False
    detach_reset_toilet: bool = False
    replace_mirror: bool = False
    detach_reset_mirror: bool = False
    replace_vanity_light: bool = False
    detach_reset_vanity_light: bool = False
    water_damage: bool = False
    water_damage_source: Optional[str] = Field(None, max_length=100)
    mold_suspected: bool = False
    existing_tub_material: Optional[str] = None
    demo_already_done: bool = False
    repair_drywall_walls: bool = False
    repair_drywall_walls_sf: Optional[float] = None
    repair_drywall_ceiling: bool = False
    repair_drywall_ceiling_sf: Optional[float] = None
    repair_subfloor: bool = False
    repair_subfloor_sf: Optional[float] = None

    demo_cement_board: bool = False
    demo_cement_board_sf: Optional[float] = None

    # Insulation flags
    demo_insulation_walls: bool = False
    demo_insulation_walls_sf: Optional[float] = None
    demo_insulation_ceiling: bool = False
    demo_insulation_ceiling_sf: Optional[float] = None
    install_insulation_walls: bool = False
    install_insulation_walls_sf: Optional[float] = None
    install_insulation_ceiling: bool = False
    install_insulation_ceiling_sf: Optional[float] = None

    # Component specs (JSONB)
    shower_spec: Optional[Dict[str, Any]] = None
    bathtub_spec: Optional[Dict[str, Any]] = None
    vanity_spec: Optional[Dict[str, Any]] = None
    toilet_spec: Optional[Dict[str, Any]] = None
    floor_spec: Optional[Dict[str, Any]] = None
    walls_spec: Optional[Dict[str, Any]] = None
    accessories_spec: Optional[Dict[str, Any]] = None
    plumbing_spec: Optional[Dict[str, Any]] = None
    electrical_spec: Optional[Dict[str, Any]] = None
    substrate_spec: Optional[Dict[str, Any]] = None
    hidden_costs: Optional[Dict[str, Any]] = None

    # Sketch data
    sketch_data: Optional[Dict[str, Any]] = None

    # Overview & O&P
    overview_text: Optional[str] = None
    include_overhead_profit: bool = False
    overhead_pct: float = 0.10
    profit_pct: float = 0.10
    notes: Optional[str] = None

    # Target total (reverse pricing)
    target_total: Optional[float] = None


class BathroomEstimateCreate(BathroomEstimateBase):
    # insurance → the new estimate is the restoration; remodel → Option A
    project_type: Literal["insurance", "remodel"] = "insurance"


class BathroomEstimateUpdate(BaseModel):
    customer_id: Optional[str] = None
    claim_number: Optional[str] = Field(None, max_length=100)
    property_address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=5)
    zip_code: Optional[str] = Field(None, max_length=10)
    building_type: Optional[str] = Field(None, max_length=50)
    year_built: Optional[int] = None
    designation: Optional[str] = Field(None, max_length=50)
    bath_function: Optional[str] = Field(None, max_length=50)
    length_ft: Optional[float] = None
    width_ft: Optional[float] = None
    height_ft: Optional[float] = None
    floor_sf: Optional[float] = None
    wall_sf: Optional[float] = None
    demo_floor: Optional[bool] = None
    demo_floor_sf: Optional[float] = None
    demo_walls: Optional[bool] = None
    demo_wall_sf: Optional[float] = None
    demo_ceiling: Optional[bool] = None
    demo_ceiling_sf: Optional[float] = None
    replace_shower: Optional[bool] = None
    replace_tub: Optional[bool] = None
    replace_vanity: Optional[bool] = None
    replace_toilet: Optional[bool] = None
    detach_reset_shower: Optional[bool] = None
    detach_reset_tub: Optional[bool] = None
    detach_reset_vanity: Optional[bool] = None
    detach_reset_toilet: Optional[bool] = None
    replace_mirror: Optional[bool] = None
    detach_reset_mirror: Optional[bool] = None
    replace_vanity_light: Optional[bool] = None
    detach_reset_vanity_light: Optional[bool] = None
    water_damage: Optional[bool] = None
    water_damage_source: Optional[str] = None
    mold_suspected: Optional[bool] = None
    existing_tub_material: Optional[str] = None
    demo_already_done: Optional[bool] = None
    repair_drywall_walls: Optional[bool] = None
    repair_drywall_walls_sf: Optional[float] = None
    repair_drywall_ceiling: Optional[bool] = None
    repair_drywall_ceiling_sf: Optional[float] = None
    repair_subfloor: Optional[bool] = None
    repair_subfloor_sf: Optional[float] = None
    demo_cement_board: Optional[bool] = None
    demo_cement_board_sf: Optional[float] = None
    demo_insulation_walls: Optional[bool] = None
    demo_insulation_walls_sf: Optional[float] = None
    demo_insulation_ceiling: Optional[bool] = None
    demo_insulation_ceiling_sf: Optional[float] = None
    install_insulation_walls: Optional[bool] = None
    install_insulation_walls_sf: Optional[float] = None
    install_insulation_ceiling: Optional[bool] = None
    install_insulation_ceiling_sf: Optional[float] = None
    shower_spec: Optional[Dict[str, Any]] = None
    bathtub_spec: Optional[Dict[str, Any]] = None
    vanity_spec: Optional[Dict[str, Any]] = None
    toilet_spec: Optional[Dict[str, Any]] = None
    floor_spec: Optional[Dict[str, Any]] = None
    walls_spec: Optional[Dict[str, Any]] = None
    accessories_spec: Optional[Dict[str, Any]] = None
    plumbing_spec: Optional[Dict[str, Any]] = None
    electrical_spec: Optional[Dict[str, Any]] = None
    substrate_spec: Optional[Dict[str, Any]] = None
    hidden_costs: Optional[Dict[str, Any]] = None
    sketch_data: Optional[Dict[str, Any]] = None
    overview_text: Optional[str] = None
    include_overhead_profit: Optional[bool] = None
    overhead_pct: Optional[float] = None
    profit_pct: Optional[float] = None
    notes: Optional[str] = None
    target_total: Optional[float] = None


# ── Line item schemas ──

class LineItemCreate(BaseModel):
    phase: int
    description: str
    quantity: float = 1.0
    unit: str = "EA"
    unit_price: float = 0.0
    total: Optional[float] = None
    category: Optional[str] = None
    notes: Optional[str] = None

class LineItemUpdate(BaseModel):
    phase: Optional[int] = None
    description: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    unit_price: Optional[float] = None
    total: Optional[float] = None
    category: Optional[str] = None
    notes: Optional[str] = None

class LineItemResponse(BaseModel):
    id: str
    estimate_id: str
    phase: int
    description: str
    quantity: float
    unit: str
    unit_price: float
    total: float
    category: Optional[str] = None
    notes: Optional[str] = None
    display_order: int = 0
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Estimate group schemas ──

class GroupMemberSummary(BaseModel):
    """One estimate of a bathroom job, as the group switcher shows it."""
    id: str
    kind: str
    option_label: Optional[str] = None
    option_order: int = 0
    status: str
    total: float = 0
    updated_at: Optional[datetime] = None


class OptionLabelUpdate(BaseModel):
    option_label: str = Field(..., min_length=1, max_length=100)


class SelectionPick(BaseModel):
    """A product from the library for one of an option's slots."""
    product_id: UUID
    # A vanity sold with its top (and sink): no separate top is priced
    includes_top: Optional[bool] = None


class ProjectTypeUpdate(BaseModel):
    project_type: Literal["insurance", "remodel"]


# ── Response schemas ──

class BathroomEstimateResponse(BaseModel):
    id: str
    customer_id: Optional[str] = None
    created_by_id: Optional[str] = None
    status: str

    # Estimate group
    group_id: Optional[str] = None
    project_type: str = "insurance"
    kind: str = "restore"
    option_label: Optional[str] = None
    option_order: int = 0
    group_members: List[GroupMemberSummary] = []
    # The prices it is priced with (unit_prices): when they're from, and
    # whether today's prices for its company differ
    price_book: Optional[PriceBookSummary] = None

    # Project meta
    property_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    building_type: Optional[str] = None
    year_built: Optional[int] = None

    # Bathroom info
    designation: Optional[str] = None
    bath_function: Optional[str] = None
    length_ft: Optional[float] = None
    width_ft: Optional[float] = None
    height_ft: Optional[float] = 8.0
    floor_sf: Optional[float] = None
    wall_sf: Optional[float] = None

    # Demo flags
    demo_floor: bool = False
    demo_floor_sf: Optional[float] = None
    demo_walls: bool = False
    demo_wall_sf: Optional[float] = None
    demo_ceiling: bool = False
    demo_ceiling_sf: Optional[float] = None
    replace_shower: bool = False
    replace_tub: bool = False
    replace_vanity: bool = False
    replace_toilet: bool = False
    detach_reset_shower: bool = False
    detach_reset_tub: bool = False
    detach_reset_vanity: bool = False
    detach_reset_toilet: bool = False
    replace_mirror: bool = False
    detach_reset_mirror: bool = False
    replace_vanity_light: bool = False
    detach_reset_vanity_light: bool = False
    water_damage: bool = False
    water_damage_source: Optional[str] = Field(None, max_length=100)
    mold_suspected: bool = False
    existing_tub_material: Optional[str] = None
    demo_already_done: bool = False
    repair_drywall_walls: bool = False
    repair_drywall_walls_sf: Optional[float] = None
    repair_drywall_ceiling: bool = False
    repair_drywall_ceiling_sf: Optional[float] = None
    repair_subfloor: bool = False
    repair_subfloor_sf: Optional[float] = None
    demo_cement_board: bool = False
    demo_cement_board_sf: Optional[float] = None

    # Insulation flags (Optional to handle NULL in existing rows)
    demo_insulation_walls: Optional[bool] = False
    demo_insulation_walls_sf: Optional[float] = None
    demo_insulation_ceiling: Optional[bool] = False
    demo_insulation_ceiling_sf: Optional[float] = None
    install_insulation_walls: Optional[bool] = False
    install_insulation_walls_sf: Optional[float] = None
    install_insulation_ceiling: Optional[bool] = False
    install_insulation_ceiling_sf: Optional[float] = None

    # Component specs
    shower_spec: Optional[Dict[str, Any]] = None
    bathtub_spec: Optional[Dict[str, Any]] = None
    vanity_spec: Optional[Dict[str, Any]] = None
    toilet_spec: Optional[Dict[str, Any]] = None
    floor_spec: Optional[Dict[str, Any]] = None
    walls_spec: Optional[Dict[str, Any]] = None
    accessories_spec: Optional[Dict[str, Any]] = None
    plumbing_spec: Optional[Dict[str, Any]] = None
    electrical_spec: Optional[Dict[str, Any]] = None
    substrate_spec: Optional[Dict[str, Any]] = None
    hidden_costs: Optional[Dict[str, Any]] = None
    sketch_data: Optional[Dict[str, Any]] = None
    # Products picked for an option, by slot (selections.SLOTS); never on a restoration
    selections: Optional[Dict[str, Any]] = None

    # Overview & O&P
    overview_text: Optional[str] = None
    include_overhead_profit: bool = False
    overhead_pct: float = 0.10
    profit_pct: float = 0.10

    # Target total
    target_total: Optional[float] = None
    adjustment_factor: Optional[float] = None

    # Totals
    subtotal: float = 0
    overhead_amount: float = 0
    profit_amount: float = 0
    tax_amount: float = 0
    total: float = 0

    # Documentation
    methodology_notes: Optional[str] = None
    warning_flags: Optional[List[str]] = None
    notes: Optional[str] = None

    # Relations
    line_items: List[LineItemResponse] = []

    # The claim number, and the linked customer's name
    claim_number: Optional[str] = None
    client_name: Optional[str] = None
    # The Scopit estimate it was last sent to
    scopit_estimate_id: Optional[str] = None

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BathroomEstimateListResponse(BaseModel):
    items: List[BathroomEstimateResponse]
    total: int
    page: int
    page_size: int


class BathroomEstimateGroupResponse(BaseModel):
    """Every estimate of a bathroom job with its line items, for comparing them."""
    group_id: str
    project_type: str
    members: List[BathroomEstimateResponse]


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


# ── Pricing info (for frontend dropdowns) ──

class PricingInfoResponse(BaseModel):
    building_types: List[str]
    designations: List[str]
    bath_functions: List[str]
    shower_types: List[str]
    enclosure_types: List[str]
    shower_door_types: List[str]
    showerhead_types: List[str]
    trim_grades: List[str]
    bathtub_types: List[str]
    bathtub_materials: List[str]
    vanity_widths: List[int]
    vanity_sources: List[str]
    vanity_top_materials: List[str]
    vanity_mountings: List[str]
    faucet_types: List[str]
    mirror_types: List[str]
    toilet_types: List[str]
    tile_materials: List[str]
    tile_patterns: List[str]
    tile_sizes: List[str]
    waterproof_types: List[str]
    accessory_finishes: List[str]
    accessory_grades: List[str]
    exhaust_fan_cfms: List[int]
    exhaust_fan_switch_types: List[str]
    paint_grades: List[str]
    baseboard_materials: List[str]
    # Rate tables the Cost Guide quotes. Mixed shapes: most entries are
    # a flat rate, a few are keyed sub-tables (exhaust fan by CFM,
    # switch by type), so these stay loosely typed.
    plumbing_rates: Dict[str, Any]
    electrical_rates: Dict[str, Any]
