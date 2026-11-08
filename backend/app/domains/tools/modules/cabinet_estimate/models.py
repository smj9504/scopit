"""
Scopit - Cabinet Estimate models

A kitchen cabinet estimate: the cabinet boxes counted off the kitchen, the
scope around them (demo, install, countertop, plumbing, appliances...) and
the line items the calculator prices from them. One kitchen job is one
group: an insurance job holds its restoration (what the carrier sees) plus
any upgrade options; a remodel job holds options only.

Ported from MJ Estimate's cabinet_estimate domain. There an estimate hung
off a claim; in Scopit it belongs to the signed-in user's company and may
link a customer.
"""
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.common.utils import generate_uuid
from app.core.database import Base

from .pricing import DEFAULT_OVERHEAD_PCT, DEFAULT_PROFIT_PCT


class CabinetEstimate(Base):
    __tablename__ = "cabinet_estimates"
    __table_args__ = (
        Index("ix_cabinet_estimates_company_id", "company_id"),
        Index("ix_cabinet_estimates_customer_id", "customer_id"),
        Index("ix_cabinet_estimates_group_id", "group_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    company_id = Column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False,
    )
    customer_id = Column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="SET NULL"), nullable=True,
    )
    created_by_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    # The Scopit estimate this kitchen estimate was last sent to
    scopit_estimate_id = Column(
        UUID(as_uuid=True), ForeignKey("estimates.id", ondelete="SET NULL"), nullable=True,
    )

    # ── Estimate group ──
    # Every member is a full estimate of its own; group_id is the first
    # member's id.
    group_id = Column(UUID(as_uuid=True), nullable=True)
    project_type = Column(String(20), default="insurance", nullable=False)  # insurance / remodel
    kind = Column(String(20), default="restore", nullable=False)  # restore / option
    option_label = Column(String(100), nullable=True)  # "Option A"; none on the restoration
    option_order = Column(Integer, default=0, nullable=False)  # restoration 0, options after
    # An option's products from the library, by slot (selections.SLOTS):
    # {"countertop": {ProductSnapshot}, ...}. Copies, so the estimate stays
    # as it was priced. A restoration never has any.
    selections = Column(JSON, nullable=True)

    # Status: draft / calculated / approved / exported
    status = Column(String(50), default="draft", nullable=False)

    # Project info
    property_address = Column(String(500))
    zip_code = Column(String(10))
    # An insurance job's claim number, as printed on the PDF
    claim_number = Column(String(100), nullable=True)

    # Kitchen layout
    layout_type = Column(String(50))
    kitchen_size_sqft = Column(Float)
    ceiling_height = Column(Float)
    has_soffit = Column(Boolean, default=False)

    # Specifications
    tier = Column(String(50))          # Stock / Semi-Custom / Custom
    box_material = Column(String(50))  # Plywood / MDF / Particle
    finish = Column(String(50))        # Painted / Stained / Glazed / Laminate
    door_style = Column(String(50))    # Shaker / Raised Panel / Arched Raised Panel / Slab / Glass
    # Full Overlay / Partial Overlay / Inset. Inset runs +15-25% because
    # the door sits flush inside the face frame.
    overlay_style = Column(String(50), nullable=True)

    # Which pricing world this estimate is quoted in. An insurance claim
    # and a retail remodel price the same physical work differently -
    # most visibly on appliance detach & reset, where a carrier pays
    # crew time and a homeowner pays a trip minimum too.
    # INSURANCE_DR (default, claim work) | RETAIL_INSTALL (remodel).
    pricing_basis = Column(String(30), nullable=True, server_default="INSURANCE_DR")

    # Scope of work flags
    include_demo = Column(Boolean, default=True)
    include_install = Column(Boolean, default=True)
    include_delivery = Column(Boolean, default=True)
    include_plumbing = Column(Boolean, default=False)
    sink_type = Column(String(20), default="single")  # single / double
    # Under-sink components, quoted for a single sink. P-trap, supply
    # lines and angle stops always come with the plumbing scope; these
    # are the ones that depend on the specific kitchen.
    include_aav = Column(Boolean, default=False)
    include_air_gap = Column(Boolean, default=False)
    include_soap_dispenser = Column(Boolean, default=False)
    include_instant_hot = Column(Boolean, default=False)
    include_dw_hookup = Column(Boolean, default=False)
    include_countertop_reset = Column(Boolean, default=False)
    include_hardware = Column(Boolean, default=True)

    # Additional scope flags
    include_crown_molding = Column(Boolean, default=False)
    include_backsplash = Column(Boolean, default=False)
    backsplash_type = Column(String(50), nullable=True)
    backsplash_sqft = Column(Float, nullable=True)
    include_toe_kick = Column(Boolean, default=True)
    # Shoe molding along the toe kick at the floor; only some kitchens
    include_quarter_round = Column(Boolean, default=False)
    include_countertop = Column(Boolean, default=False)
    include_drywall_repair = Column(Boolean, default=False)
    drywall_repair_type = Column(String(20), default="patch", nullable=True)  # patch / rr
    drywall_repair_sqft = Column(Float, nullable=True)
    include_painting = Column(Boolean, default=False)
    painting_sqft = Column(Float, nullable=True)
    include_appliance_rr = Column(Boolean, default=False)
    appliance_list = Column(JSON, nullable=True)  # [{type, qty}]
    include_dumpster = Column(Boolean, default=True)
    include_electrical = Column(Boolean, default=False)
    include_permit = Column(Boolean, default=False)
    # Trim and panel scope
    filler_count = Column(Integer, default=0)
    # Places a run or island turns at an angle other than 90°: each takes a
    # wedge filler, extra fitting and (with a countertop) an angled cut.
    angled_joint_count = Column(Integer, default=0)
    # Island top: how far it overhangs for seating (inches; null/0 = the
    # 1.5" edge only), and the support brackets that overhang needs.
    island_seating_overhang_in = Column(Float, nullable=True)
    countertop_support_count = Column(Integer, default=0)
    # {"wall": n, "base": n, "tall": n, "refrigerator": n}
    end_panel_counts = Column(JSON, nullable=True)
    dishwasher_return_panel_count = Column(Integer, default=0)
    include_light_rail = Column(Boolean, default=False)
    light_rail_lf = Column(Float, nullable=True)
    outlet_relocation_count = Column(Integer, default=0)
    delivery_floor = Column(Integer, default=1)  # 1, 2, 3+

    # Island type: "custom" (LF-based) or "prefab" (EA-based)
    island_type = Column(String(20), default="custom", nullable=False)
    island_prefab_size = Column(String(20), nullable=True)  # small / medium / large / xl
    island_prefab_price = Column(Float, nullable=True)  # user-overridable supply price
    # Island panels (SF) — custom build only
    island_end_panel_sqft = Column(Float, default=0)
    island_back_panel_sqft = Column(Float, default=0)
    # Cabinets on both long sides of the island, back to back: no back
    # panel, no seating side, and the Sketch lays the island out in two rows.
    island_two_sided = Column(Boolean, default=False)

    # Countertop (perimeter)
    countertop_material = Column(String(100), nullable=True)
    countertop_sqft = Column(Float, nullable=True)
    # 4" countertop backsplash (matching piece)
    include_countertop_backsplash = Column(Boolean, default=False)
    countertop_backsplash_lf = Column(Float, nullable=True)

    # Island countertop
    island_countertop_material = Column(String(100), nullable=True)
    island_countertop_sqft = Column(Float, nullable=True)

    # Overview text for PDF
    overview_text = Column(Text, nullable=True)

    # Target total (reverse pricing)
    target_total = Column(Float, nullable=True)

    # Calculated totals
    subtotal = Column(Float, default=0)
    overhead_pct = Column(Float, default=DEFAULT_OVERHEAD_PCT)
    overhead_amount = Column(Float, default=0)
    profit_pct = Column(Float, default=DEFAULT_PROFIT_PCT)
    profit_amount = Column(Float, default=0)
    adjustment_factor = Column(Float, nullable=True)
    total = Column(Float, default=0)

    # Documentation
    methodology_notes = Column(Text, nullable=True)
    warning_flags = Column(JSONB, nullable=True, default=list)
    notes = Column(Text, nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    # Relationships
    customer = relationship("Customer")
    boxes = relationship(
        "CabinetBox",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="CabinetBox.display_order",
        lazy="selectin",
    )
    line_items = relationship(
        "CabinetEstimateLineItem",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="CabinetEstimateLineItem.display_order",
        lazy="selectin",
    )
    history = relationship(
        "CabinetEstimateHistory",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="CabinetEstimateHistory.version_number.desc()",
        lazy="select",
    )
    sketch = relationship(
        "CabinetSketch",
        back_populates="estimate",
        uselist=False,
        cascade="all, delete-orphan",
        lazy="select",
    )


class CabinetBox(Base):
    """Individual cabinet box within an estimate"""
    __tablename__ = "cabinet_boxes"
    __table_args__ = (
        Index("ix_cabinet_boxes_estimate_id", "estimate_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    estimate_id = Column(
        UUID(as_uuid=True), ForeignKey("cabinet_estimates.id", ondelete="CASCADE"), nullable=False,
    )

    code = Column(String(20), nullable=False)        # "B30", "SB36", "BBC36"
    cab_type = Column(String(20), nullable=False)     # base / wall / tall / specialty
    location = Column(String(20), default="perimeter", nullable=False)  # perimeter / island
    width_inches = Column(Integer, nullable=False)
    height_inches = Column(Float, nullable=False)
    is_specialty = Column(Boolean, default=False)
    # sink_base / lazy_susan / blind_corner / drawer_base / diagonal_corner_wall
    # / three_door_corner_wall / angle_end_wall / two_door_angle_end_wall
    # / three_door_angle_end_wall / oven_cabinet / refrigerator_cabinet
    # / range_base_slide_in / range_base_drop_in
    specialty_type = Column(String(50), nullable=True)
    has_glass_door = Column(Boolean, default=False)
    # Finished end panels flanking a slide-in range opening (0-2).
    # Only meaningful when specialty_type == "range_base_slide_in".
    range_panel_count = Column(Integer, nullable=True)
    # lattice / lattice_band / mullion; NULL is a plain door in the job's door style.
    door_pattern = Column(String(30), nullable=True)
    qty = Column(Integer, default=1, nullable=False)
    display_order = Column(Integer, default=0)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    estimate = relationship("CabinetEstimate", back_populates="boxes")


class CabinetEstimateLineItem(Base):
    """Calculated line item in the estimate output"""
    __tablename__ = "cabinet_estimate_line_items"
    __table_args__ = (
        Index("ix_cabinet_line_items_estimate_id", "estimate_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    estimate_id = Column(
        UUID(as_uuid=True), ForeignKey("cabinet_estimates.id", ondelete="CASCADE"), nullable=False,
    )

    description = Column(String(500), nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String(10), nullable=False)  # LF, EA, SF, HR
    unit_price = Column(Float, nullable=False)   # material + labor combined
    total = Column(Float, nullable=False)
    # Breakdown of the two figures above. The estimate and its PDF quote the
    # combined numbers; these are the internal split.
    material_unit_price = Column(Float, default=0)
    labor_unit_price = Column(Float, default=0)
    material_total = Column(Float, default=0)
    labor_total = Column(Float, default=0)
    category = Column(String(50), nullable=True)  # supply / labor / scope / premium
    location = Column(String(20), default="perimeter", nullable=False)  # perimeter / island / shared
    notes = Column(String(500), nullable=True)
    display_order = Column(Integer, default=0)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    estimate = relationship("CabinetEstimate", back_populates="line_items")


class CabinetEstimateHistory(Base):
    """Version history snapshot for an estimate"""
    __tablename__ = "cabinet_estimate_history"
    __table_args__ = (
        Index("ix_cabinet_history_estimate_id", "estimate_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    estimate_id = Column(
        UUID(as_uuid=True), ForeignKey("cabinet_estimates.id", ondelete="CASCADE"), nullable=False,
    )
    version_number = Column(Integer, nullable=False)
    snapshot_data = Column(JSONB, nullable=False)  # full estimate + boxes + line_items
    changed_by_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    change_description = Column(String(500), nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    estimate = relationship("CabinetEstimate", back_populates="history")


class CabinetSketch(Base):
    """The layout drawing of an estimate's kitchen: one canvas per estimate.

    Walls, placed cabinets and appliances live only in overlay_data
    ({"walls": [...], "cabinets": [...], "appliances": [...]}; see
    sketch_schemas.py), so there are no child tables.
    """
    __tablename__ = "cabinet_sketches"
    __table_args__ = (
        Index("ix_cabinet_sketches_estimate_id", "estimate_id", unique=True),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    estimate_id = Column(
        UUID(as_uuid=True), ForeignKey("cabinet_estimates.id", ondelete="CASCADE"), nullable=False,
    )

    canvas_width = Column(Integer, default=1200, nullable=False)
    canvas_height = Column(Integer, default=900, nullable=False)
    scale_pixels_per_foot = Column(Float, default=20.0, nullable=False)
    overlay_data = Column(JSONB, default=dict, nullable=False)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    estimate = relationship("CabinetEstimate", back_populates="sketch")
