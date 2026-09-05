"""
Scopit - Packing & Moving Estimator Schemas

Pydantic models for the packing/moving estimation tool.
Ported from moving_estimate standalone application.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

# ============================================
# ENUMS
# ============================================

class RoomSize(str, Enum):
    SMALL = "small"
    LARGE = "large"
    XLARGE = "xlarge"


class Density(str, Enum):
    LIGHT = "light"
    NORMAL = "normal"
    DENSE = "dense"
    HEAVY = "heavy"
    EXTREME = "extreme"


class Floor(str, Enum):
    BASEMENT = "basement"
    FIRST = "1st"
    SECOND = "2nd"
    THIRD = "3rd"
    FOURTH_PLUS = "4th+"


class Region(str, Enum):
    MID_ATLANTIC = "mid_atlantic"
    NORTHEAST = "northeast"
    WEST = "west"
    MIDWEST = "midwest"
    SOUTHWEST = "southwest"
    SOUTHEAST = "southeast"


class ContaminationLevel(str, Enum):
    CLEAN = "clean"
    GRAY_WATER = "gray_water"
    BLACK_WATER = "black_water"


class StagingType(str, Enum):
    OFF_SITE = "off_site"
    ON_SITE = "on_site"


class ContentHint(str, Enum):
    CLOTHING_HANGING = "clothing_hanging"
    CLOTHING_FOLDED = "clothing_folded"
    BEDDING = "bedding"
    BOOKS = "books"
    DOCUMENTS = "documents"
    ELECTRONICS = "electronics"
    KITCHENWARE = "kitchenware"
    FRAGILE = "fragile"
    ARTWORK = "artwork"
    COLLECTIBLES = "collectibles"
    VALUABLES = "valuables"
    WINE_COLLECTION = "wine_collection"
    FURNITURE = "furniture"
    RUGS = "rugs"
    LAMPS_LIGHTING = "lamps_lighting"
    APPLIANCES_SMALL = "appliances_small"
    APPLIANCES_LARGE = "appliances_large"
    TOYS = "toys"
    SPORTS = "sports"
    BICYCLES = "bicycles"
    TOOLS = "tools"
    EQUIPMENT_HEAVY = "equipment_heavy"
    BOXES_STORED = "boxes_stored"
    HOLIDAY_DECOR = "holiday_decor"
    INSTRUMENTS = "instruments"
    BABY_ITEMS = "baby_items"
    OUTDOOR_FURNITURE = "outdoor_furniture"
    PLANTS = "plants"
    CHEMICALS = "chemicals"


# ============================================
# SPECIAL ITEM (defined early; referenced by RoomInput)
# ============================================

class CustomSpecialItem(BaseModel):
    name: str
    price: float = Field(ge=0)


# ============================================
# ROOM SCHEMAS
# ============================================

class RoomInput(BaseModel):
    preset: str = Field(..., description="Room preset key (e.g., 'bedroom_standard')")
    floor: Floor = Field(default=Floor.FIRST)
    density: Density = Field(default=Density.NORMAL)
    hints: List[str] = Field(default_factory=list)
    contamination: ContaminationLevel = Field(default=ContaminationLevel.CLEAN)
    hint_volume: Dict[str, int] = Field(
        default_factory=dict,
        description="Per-hint volume level index: 0=S, 1=M (default), 2=L, 3=XL"
    )
    hint_qty: Dict[str, int] = Field(
        default_factory=dict,
        description="Per-unit hint quantity (e.g. sofa=1, bed_small=2)"
    )
    special_items: List[str] = Field(
        default_factory=list,
        description="Per-room special item keys (e.g., 'piano', 'pool_table')"
    )
    custom_special_items: List[CustomSpecialItem] = Field(
        default_factory=list,
        description="Per-room custom special items with fixed cost"
    )


class RoomOutput(BaseModel):
    name: str
    size: RoomSize
    floor: Floor
    density: Density
    hints: List[str]
    item_count: int
    price: float


# ============================================
# ESTIMATE REQUEST/RESPONSE
# ============================================

class QuickEstimateRequest(BaseModel):
    rooms: List[RoomInput]
    crew_size: int = Field(default=4, ge=2, le=6)
    storage_months: int = Field(default=1, ge=0, le=12)
    staging_type: StagingType = Field(default=StagingType.OFF_SITE)
    include_packback: bool = Field(default=True)
    include_op: bool = Field(default=True)
    op_rate: int = Field(default=20, ge=0, le=30)
    material_rate: int = Field(default=0, ge=0, le=40,
        description="Handling & markup added on top of catalog material cost, %")
    include_contingency: bool = Field(default=False)
    contingency_rate: int = Field(default=0, ge=0, le=20)
    supplement_overrides: Dict[str, bool] = Field(default_factory=dict)
    region: Region = Field(default=Region.MID_ATLANTIC)
    special_items: List[str] = Field(default_factory=list)
    custom_special_items: List[CustomSpecialItem] = Field(default_factory=list)


class MaterialItem(BaseModel):
    code: str
    name: str
    quantity: int
    unit: str
    unit_price: float
    total: float
    detail: Optional[str] = None


class SectionBreakdown(BaseModel):
    name: str
    items: List[Dict]
    subtotal: float


class RoomItemSummary(BaseModel):
    room_name: str
    notable_items: List[str] = Field(default_factory=list)
    categories_present: List[str] = Field(default_factory=list)
    high_value_items: List[str] = Field(default_factory=list)
    packing_notes: List[str] = Field(default_factory=list)
    item_count: int = 0


class SupplementItem(BaseModel):
    key: str
    name: str
    description: str = ""
    amount: float = 0
    triggered: bool = False
    enabled: bool = True
    reason: str = ""


class EstimateResponse(BaseModel):
    id: Optional[str] = None
    created_at: Optional[datetime] = None

    # Summary
    total_rooms: int
    total_items: int
    total_hours: float
    crew_size: int
    # Scheduling / logistics quantities the editor can adjust by hand.
    # work_days = ceil(total_hours / 8-hr workday) — reported so the editor can
    # offer per-work-day van billing, which is an opt-in and NOT applied here.
    # truck_trips is the moving-van DY quantity, driven by load capacity alone
    # (0 for on-site jobs). truck_capacity_trips records that same calculated
    # figure permanently: the editor overwrites truck_trips when the user opts
    # in, and needs an untouched anchor to restore from when they opt back out.
    work_days: int = 1
    truck_trips: int = 0
    truck_capacity_trips: int = 0

    # Breakdown
    sections: Dict[str, float]
    section_details: Optional[Dict[str, Any]] = None
    materials: Dict[str, int]
    material_details: Optional[List[MaterialItem]] = None
    materials_detail: Optional[Dict[str, str]] = None
    materials_mode: Optional[str] = None
    storage_sf: int = 0
    staging_type: StagingType = StagingType.OFF_SITE
    room_summaries: Optional[List[RoomItemSummary]] = None

    # Totals
    subtotal: float
    include_op: bool
    op_rate: int
    op_amount: float
    include_contingency: bool = False
    contingency_rate: int = 0
    contingency_amount: float = 0
    supplements: List["SupplementItem"] = Field(default_factory=list)
    supplements_total: float = 0
    grand_total: float
    notes: List[str] = Field(default_factory=list)


# ============================================
# PHOTO ANALYSIS
# ============================================

class ExistingItem(BaseModel):
    name: str
    quantity: int = 1


class RoomPhotoAnalysisRequest(BaseModel):
    room_name: str = Field(..., description="Room name (preset or custom)")
    images: List[str] = Field(..., description="Base64 encoded images")
    existing_items: Optional[List[ExistingItem]] = Field(
        default=None,
        description="Previously inventoried items to cross-reference"
    )


class DetectedContentItem(BaseModel):
    name: str = Field(..., description="Item name")
    description: Optional[str] = Field(
        default=None,
        description="Size/dimension descriptor (e.g. '3-seat, ~84in wide')",
    )
    size: Optional[str] = Field(
        default=None,
        description="Size class: XS, S, M, L, XL, XXL",
    )
    weight: Optional[str] = Field(
        default=None,
        description="Weight class: light, medium, heavy, extra_heavy",
    )
    category: str = Field(..., description="Category (e.g. 'Furniture', 'Electronics')")
    quantity: int = Field(default=1, ge=1)
    is_high_value: bool = Field(default=False)
    estimated_value: Optional[str] = Field(default=None)
    is_fragile: bool = Field(default=False)
    needs_disassembly: bool = Field(default=False)
    packing_method: Optional[str] = Field(default=None)
    required_materials: Optional[List[str]] = Field(default=None)
    base_labor_hours: Optional[float] = Field(
        default=None, ge=0, le=1.0,
        description="Fixed setup/teardown time in hours, independent of quantity",
    )
    per_unit_labor_hours: Optional[float] = Field(
        default=None, ge=0, le=2.0,
        description="Marginal packing time per additional unit in hours",
    )
    estimated_labor_hours: Optional[float] = Field(
        default=None, ge=0,
        description="Total labor hours (auto-computed from base + per_unit * qty when available)",
    )
    special_instructions: Optional[str] = Field(default=None)
    estimator_flags: Optional[List[str]] = Field(default=None)
    match_confidence: Optional[float] = Field(default=None)
    confidence: Optional[float] = Field(
        default=None, ge=0.0, le=1.0,
        description="AI detection confidence for this item (0.0–1.0)",
    )

    @model_validator(mode="after")
    def compute_total_labor(self):
        if self.base_labor_hours is not None and self.per_unit_labor_hours is not None:
            self.estimated_labor_hours = round(
                self.base_labor_hours + (self.per_unit_labor_hours * self.quantity), 4
            )
        return self


class RoomAnalysisResponse(BaseModel):
    room_name: str
    items: List[DetectedContentItem]
    low_confidence_items: List[DetectedContentItem] = Field(
        default_factory=list,
        description="Items with confidence below threshold — "
        "included for user review, not auto-added to estimate",
    )
    density: str
    room_size: str
    confidence_score: float
    total_labor_hours: float = 0
    fragile_count: int = 0
    high_value_count: int = 0
    field_notes: List[str] = Field(default_factory=list)


class RoomContentInput(BaseModel):
    room_name: str
    preset_id: Optional[str] = None
    items: List[DetectedContentItem] = Field(default_factory=list)
    density: str = "normal"
    floor: str = "1st"
    contamination: str = "clean"
    # Preset-based fallback fields (used when AI analysis is unusable)
    use_preset: bool = Field(default=False, description="If true, use preset-based calculation instead of AI items")
    preset: Optional[str] = Field(default=None, description="Room preset key for preset-based calculation")
    hints: List[str] = Field(default_factory=list, description="Content hints for preset-based calculation")
    hint_volume: Dict[str, int] = Field(default_factory=dict, description="Per-hint volume level index")
    hint_qty: Dict[str, int] = Field(default_factory=dict, description="Per-unit hint quantity")
    special_items: List[str] = Field(
        default_factory=list,
        description="Per-room special item keys (e.g., 'piano', 'pool_table')"
    )
    custom_special_items: List[CustomSpecialItem] = Field(
        default_factory=list,
        description="Per-room custom special items with fixed cost"
    )


class RoomsEstimateRequest(BaseModel):
    rooms: List[RoomContentInput]
    crew_size: int = Field(default=4, ge=2, le=6)
    storage_months: int = Field(default=1, ge=0, le=12)
    staging_type: StagingType = Field(default=StagingType.OFF_SITE)
    include_packback: bool = Field(default=True)
    include_op: bool = Field(default=True)
    op_rate: int = Field(default=20, ge=0, le=30)
    material_rate: int = Field(default=0, ge=0, le=40,
        description="Handling & markup added on top of catalog material cost, %")
    materials_mode: Literal["pct_of_labor", "itemized"] = Field(
        default="pct_of_labor",
        description="Photo AI materials calc: % of pack-out labor, or itemized box/protection pricing",
    )
    include_contingency: bool = Field(default=False)
    contingency_rate: int = Field(default=0, ge=0, le=20)
    supplement_overrides: Dict[str, bool] = Field(default_factory=dict)
    region: Region = Field(default=Region.MID_ATLANTIC)
    special_items: List[str] = Field(default_factory=list)
    custom_special_items: List[CustomSpecialItem] = Field(default_factory=list)


# ============================================
# ITEM CORRECTIONS
# ============================================

class ItemCorrectionInput(BaseModel):
    original_name: str
    corrected_name: Optional[str] = None
    original_category: Optional[str] = None
    corrected_category: Optional[str] = None
    original_qty: Optional[int] = None
    corrected_qty: Optional[int] = None
    action: str = "edit"
    match_confidence: Optional[float] = None


class SubmitCorrectionsRequest(BaseModel):
    session_id: Optional[str] = None
    room_name: str
    corrections: List[ItemCorrectionInput]


class SubmitCorrectionsResponse(BaseModel):
    saved: int


# ============================================
# MASTER CONTENT LIST
# ============================================

class MasterContentItem(BaseModel):
    name: str
    category: str
    total_quantity: int
    rooms: List[str]
    is_high_value: bool
    is_fragile: bool
    estimator_flags: List[str]
    total_labor_hours: float


class MasterContentRoom(BaseModel):
    room_name: str
    items: List[dict]


class MasterContentRequest(BaseModel):
    rooms: List[MasterContentRoom]


class MasterContentResponse(BaseModel):
    items: List[MasterContentItem]
    total_items: int
    total_labor_hours: float
    high_value_count: int
    fragile_count: int
    flag_summary: Dict[str, int]


# ============================================
# EXPORT SCHEMAS
# ============================================

class CompanyInfoOverride(BaseModel):
    name: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    license: Optional[str] = None


class ExportRequest(BaseModel):
    session_id: str
    company_override: Optional[CompanyInfoOverride] = None
    tax_rate: float = Field(default=0.0, ge=0, le=100)
    show_breakdown: bool = Field(default=False, description="Show labor hour calculation breakdown in detail lines")


class ReportRoomPhoto(BaseModel):
    """A single photo to include in the report for a specific room."""
    image: str = Field(..., description="Base64 encoded image (JPEG/PNG)")
    caption: Optional[str] = None
    is_damage: bool = Field(default=False, description="Mark as pre-existing damage photo")


class ReportRoomData(BaseModel):
    """Per-room data for the report."""
    room_name: str
    photos: List[ReportRoomPhoto] = Field(default_factory=list)
    items: Optional[List[DetectedContentItem]] = Field(
        default=None, description="Inventory items for this room"
    )
    labor_hours: Optional[float] = None
    labor_notes: Optional[str] = None
    field_notes: List[str] = Field(default_factory=list)


class ReportSections(BaseModel):
    """Toggle which sections to include in the report."""
    inventory_list: bool = Field(default=True, description="Include room-by-room inventory list")
    damage_photos: bool = Field(default=False, description="Include pre-existing damage photos")
    labor_log: bool = Field(default=False, description="Include labor log per room")
    room_photos: bool = Field(default=True, description="Include room photos")
    estimate_summary: bool = Field(default=True, description="Include estimate summary totals")


class ReportExportRequest(BaseModel):
    """Request body for POST /export/report."""
    session_id: str
    sections: ReportSections = Field(default_factory=ReportSections)
    rooms: List[ReportRoomData] = Field(default_factory=list)
    company_override: Optional[CompanyInfoOverride] = None
    tax_rate: float = Field(default=0.0, ge=0, le=100)
    notes: Optional[str] = Field(default=None, description="Additional notes for the report")
    include_signature_page: bool = Field(default=False, description="Add signature page at end")
    include_field_notes: bool = Field(default=True, description="Include auto-generated handling notes per room")
    image_quality: int = Field(default=60, ge=20, le=90, description="JPEG quality for photos (lower = smaller file)")
    max_image_width: int = Field(default=800, ge=400, le=1200, description="Max image width in pixels")
    photos_per_page: int = Field(default=2, description="Number of photos per row in the report (2 or 4)")


# ============================================
# BATCH PHOTO ANALYSIS (SSE)
# ============================================

class BatchRoomInput(BaseModel):
    """A single room within a batch analysis request."""
    room_name: str = Field(
        ..., description="Room name (preset or custom)"
    )
    images: List[str] = Field(
        ..., min_length=1,
        description="Base64 encoded images",
    )
    existing_items: Optional[List[ExistingItem]] = None


class BatchRoomAnalysisRequest(BaseModel):
    """Request body for POST /analyze-batch."""
    rooms: List[BatchRoomInput] = Field(
        ...,
        min_length=1,
        max_length=15,
        description="Rooms to analyze in order",
    )
    batch_id: Optional[str] = Field(
        default=None,
        description="Client-generated UUID for tracking",
    )


class RoomAnalysisStatus(str, Enum):
    SUCCESS = "success"
    ERROR = "error"


class BatchRoomEvent(BaseModel):
    """One SSE data payload emitted per room."""
    event: str = "room_result"
    batch_id: Optional[str] = None
    room_index: int
    total_rooms: int
    status: RoomAnalysisStatus
    room_name: str
    result: Optional[RoomAnalysisResponse] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None


class BatchCompleteEvent(BaseModel):
    """Final SSE event after all rooms processed."""
    event: str = "batch_complete"
    batch_id: Optional[str] = None
    total_rooms: int
    succeeded: int
    failed: int
    failed_rooms: List[str] = Field(default_factory=list)
