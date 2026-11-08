"""
Scopit - Bathroom Estimate models

A bathroom remodel or restoration estimate: the room, the scope (demo,
fixtures, tile, plumbing, electrical...), the layout sketch with its 3D view,
and the line items the calculator prices from them. One bathroom job is one
group: an insurance job holds its restoration (what the carrier sees) plus
any upgrade options; a remodel job holds options only, and may hold the
bathroom as it is today ("existing", unpriced) for its options to price
layout changes against.

Ported from MJ Estimate's bathroom_estimate domain. There an estimate hung
off a claim; in Scopit it belongs to the signed-in user's company, may link
a customer, and keeps the claim number itself.
"""
from sqlalchemy import (
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


class BathroomEstimate(Base):
    __tablename__ = "bathroom_estimates"
    __table_args__ = (
        Index("ix_bathroom_estimates_company_id", "company_id"),
        Index("ix_bathroom_estimates_customer_id", "customer_id"),
        Index("ix_bathroom_estimates_group_id", "group_id"),
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
    # The Scopit estimate this bathroom estimate was last sent to
    scopit_estimate_id = Column(
        UUID(as_uuid=True), ForeignKey("estimates.id", ondelete="SET NULL"), nullable=True,
    )
    # The prices it is priced with (unit_prices.PriceBook), set the first
    # time it is calculated: a later default update or company price change
    # doesn't move it. NULL until then; a copy in the same job keeps it.
    price_book_id = Column(
        UUID(as_uuid=True), ForeignKey("price_books.id", ondelete="SET NULL"), nullable=True,
    )

    # ── Estimate group ──
    # Every member is a full estimate of its own; group_id is the first
    # member's id.
    group_id = Column(UUID(as_uuid=True), nullable=True)
    project_type = Column(String(20), default="insurance", nullable=False)  # insurance / remodel
    kind = Column(String(20), default="restore", nullable=False)  # restore / option / existing
    option_label = Column(String(100), nullable=True)  # "Option A"; none on the restoration
    option_order = Column(Integer, default=0, nullable=False)  # restoration 0, options after

    # Status: draft / calculated / approved / exported
    status = Column(String(50), default="draft", nullable=False)

    # ── Project meta ──
    property_address = Column(String(500))
    city = Column(String(100))
    state = Column(String(5))          # MD / VA / DC
    zip_code = Column(String(10))
    building_type = Column(String(50))  # sfh / townhouse / condo
    year_built = Column(Integer)       # pre-1978 → lead RRP flag
    # An insurance job's claim number, as printed on the PDF
    claim_number = Column(String(100), nullable=True)

    # ── Bathroom info ──
    designation = Column(String(50))   # master / hall / powder / three_quarter / jack_jill
    bath_function = Column(String(50))  # full / three_quarter / half
    length_ft = Column(Float)
    width_ft = Column(Float)
    height_ft = Column(Float, default=8.0)
    floor_sf = Column(Float)           # computed or manual
    wall_sf = Column(Float)            # computed (minus door/vanity/tub area)

    # ── Demo scope flags ──
    demo_scope = Column(String(50))    # full_gut / floor_only / walls_only / etc.
    demo_floor = Column(Boolean, default=False)
    demo_floor_sf = Column(Float, nullable=True)      # override: actual demo floor area
    demo_walls = Column(Boolean, default=False)
    demo_wall_sf = Column(Float, nullable=True)        # override: actual demo wall area
    demo_ceiling = Column(Boolean, default=False)
    demo_ceiling_sf = Column(Float, nullable=True)     # override: actual demo ceiling area
    replace_shower = Column(Boolean, default=False)
    replace_tub = Column(Boolean, default=False)
    replace_vanity = Column(Boolean, default=False)
    replace_toilet = Column(Boolean, default=False)
    replace_floor = Column(Boolean, default=False)
    # Detach & reset (labor only, no new material)
    detach_reset_shower = Column(Boolean, default=False)
    detach_reset_tub = Column(Boolean, default=False)
    detach_reset_vanity = Column(Boolean, default=False)
    detach_reset_toilet = Column(Boolean, default=False)
    replace_mirror = Column(Boolean, default=False)
    detach_reset_mirror = Column(Boolean, default=False)
    replace_vanity_light = Column(Boolean, default=False)
    detach_reset_vanity_light = Column(Boolean, default=False)
    water_damage = Column(Boolean, default=False)
    # Where the water damage started (the plumber already fixed it).
    # Comma-separated: "shower,bathtub". Values: shower, bathtub, vanity,
    # toilet, supply_line, other
    water_damage_source = Column(String(100), nullable=True)
    mold_suspected = Column(Boolean, default=False)
    existing_tub_material = Column(String(50))  # for the cast iron surcharge
    demo_already_done = Column(Boolean, default=False)  # mitigation team already demoed
    # Water damage repairs
    repair_drywall_walls = Column(Boolean, default=False)
    repair_drywall_walls_sf = Column(Float, nullable=True)
    repair_drywall_ceiling = Column(Boolean, default=False)
    repair_drywall_ceiling_sf = Column(Float, nullable=True)
    repair_subfloor = Column(Boolean, default=False)
    repair_subfloor_sf = Column(Float, nullable=True)

    demo_cement_board = Column(Boolean, default=False)
    demo_cement_board_sf = Column(Float, nullable=True)
    replace_cement_board = Column(Boolean, default=False)
    replace_cement_board_sf = Column(Float, nullable=True)

    # Insulation
    demo_insulation_walls = Column(Boolean, default=False)
    demo_insulation_walls_sf = Column(Float, nullable=True)
    demo_insulation_ceiling = Column(Boolean, default=False)
    demo_insulation_ceiling_sf = Column(Float, nullable=True)
    install_insulation_walls = Column(Boolean, default=False)
    install_insulation_walls_sf = Column(Float, nullable=True)
    install_insulation_ceiling = Column(Boolean, default=False)
    install_insulation_ceiling_sf = Column(Float, nullable=True)

    # ── Component specs (shapes in the frontend's types/bathroomEstimate.ts) ──
    shower_spec = Column(JSONB, nullable=True)
    bathtub_spec = Column(JSONB, nullable=True)
    vanity_spec = Column(JSONB, nullable=True)
    toilet_spec = Column(JSONB, nullable=True)
    floor_spec = Column(JSONB, nullable=True)
    walls_spec = Column(JSONB, nullable=True)
    accessories_spec = Column(JSONB, nullable=True)
    plumbing_spec = Column(JSONB, nullable=True)
    electrical_spec = Column(JSONB, nullable=True)
    substrate_spec = Column(JSONB, nullable=True)
    hidden_costs = Column(JSONB, nullable=True)

    # ── Overview note for the PDF ──
    overview_text = Column(Text, nullable=True)

    # ── O&P (optional) ──
    include_overhead_profit = Column(Boolean, default=False)
    overhead_pct = Column(Float, default=0.10)
    profit_pct = Column(Float, default=0.10)

    # ── Target total (reverse-engineer pricing) ──
    target_total = Column(Float, nullable=True)         # desired grand total
    adjustment_factor = Column(Float, nullable=True)    # multiplier applied to line items

    # ── Calculated totals ──
    subtotal = Column(Float, default=0)
    overhead_amount = Column(Float, default=0)
    profit_amount = Column(Float, default=0)
    tax_amount = Column(Float, default=0)
    total = Column(Float, default=0)

    # ── Sketch ──
    # { version, walls, rooms, fixtures, tileZones, damageZones, settings }
    sketch_data = Column(JSONB, nullable=True)

    # ── Products picked for an option (never a restoration) ──
    # { slot: product snapshot (+ includes_top for a vanity) }; see selections.SLOTS
    selections = Column(JSONB, nullable=True)

    # ── Documentation ──
    methodology_notes = Column(Text, nullable=True)
    warning_flags = Column(JSONB, nullable=True, default=list)
    notes = Column(Text, nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    customer = relationship("Customer")
    line_items = relationship(
        "BathroomEstimateLineItem",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="BathroomEstimateLineItem.display_order",
        lazy="selectin",
    )
    history = relationship(
        "BathroomEstimateHistory",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="BathroomEstimateHistory.version_number.desc()",
        lazy="select",
    )


class BathroomEstimateLineItem(Base):
    """Calculated line item in the estimate output"""
    __tablename__ = "bathroom_estimate_line_items"
    __table_args__ = (
        Index("ix_bath_line_items_estimate_id", "estimate_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    estimate_id = Column(
        UUID(as_uuid=True), ForeignKey("bathroom_estimates.id", ondelete="CASCADE"), nullable=False,
    )

    phase = Column(Integer, nullable=False)  # 1-7, the estimate's phases
    description = Column(String(500), nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String(10), nullable=False)  # SF, EA, LF, HR, LS
    unit_price = Column(Float, nullable=False)
    total = Column(Float, nullable=False)
    # demo / plumbing / electrical / substrate / tile / fixture / finish / misc
    category = Column(String(50), nullable=True)
    notes = Column(String(500), nullable=True)
    display_order = Column(Integer, default=0)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    estimate = relationship("BathroomEstimate", back_populates="line_items")


class BathroomEstimateHistory(Base):
    """Version history snapshot for a bathroom estimate"""
    __tablename__ = "bathroom_estimate_history"
    __table_args__ = (
        Index("ix_bath_history_estimate_id", "estimate_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    estimate_id = Column(
        UUID(as_uuid=True), ForeignKey("bathroom_estimates.id", ondelete="CASCADE"), nullable=False,
    )
    version_number = Column(Integer, nullable=False)
    snapshot_data = Column(JSONB, nullable=False)
    changed_by_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    change_description = Column(String(500), nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    estimate = relationship("BathroomEstimate", back_populates="history")
