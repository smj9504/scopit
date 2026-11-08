"""
Scopit - Cabinet Estimate service

Ported from MJ Estimate's cabinet_estimate service. Every query is limited
to one company: the service is built for the signed-in user's company and
never sees another's estimates. Callers commit.
"""
import copy
import logging
import string
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import and_, desc, func, or_
from sqlalchemy.orm import Session, selectinload

from app.domains.unit_prices.service import UnitPriceService
from app.domains.unit_prices.tables import use_prices

from .calculator import BoxInput, calculate_estimate
from .models import (
    CabinetBox,
    CabinetEstimate,
    CabinetEstimateHistory,
    CabinetEstimateLineItem,
    CabinetSketch,
)
from .pricing import DOOR_PATTERN_LABELS
from .schemas import CabinetEstimateCreate, CabinetEstimateUpdate
from .selections import SLOT_CATEGORY, SLOT_KEYS, clean_selections

logger = logging.getLogger(__name__)

# Facts about the job rather than the scope: every estimate of a kitchen job
# shares them, so changing one estimate's changes them all.
GROUP_SHARED_FIELDS = ("customer_id", "claim_number", "property_address", "zip_code")

# The price catalog cabinet estimates are priced from (unit_prices)
PRICE_DOMAIN = "cabinet"

# Columns a copy never takes from its source: its identity, its place in a
# job and its bookkeeping. Everything else is the scope and is copied, so a
# column added later is copied without anyone having to list it.
_NOT_COPIED = {
    "id", "created_at", "updated_at", "created_by_id", "status",
    "group_id", "project_type", "kind", "option_label", "option_order",
    "scopit_estimate_id",
}

_BOX_FIELDS = (
    "code", "cab_type", "location", "width_inches", "height_inches",
    "is_specialty", "specialty_type", "has_glass_door", "range_panel_count",
    "door_pattern", "qty",
)
_LINE_FIELDS = (
    "description", "quantity", "unit", "unit_price", "total",
    "material_unit_price", "labor_unit_price", "material_total", "labor_total",
    "category", "location", "notes", "display_order",
)


def row_dict(entity) -> Dict[str, Any]:
    """An ORM row's columns as plain JSON-safe values."""
    out: Dict[str, Any] = {}
    for column in entity.__table__.columns:
        value = getattr(entity, column.name, None)
        if isinstance(value, UUID):
            value = str(value)
        elif isinstance(value, Decimal):
            value = float(value)
        elif isinstance(value, datetime):
            value = value.isoformat()
        out[column.name] = value
    return out


def _uuid(value) -> Optional[UUID]:
    if value in (None, ""):
        return None
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except (ValueError, TypeError):
        return None


def _next_option_label(members: List[CabinetEstimate]) -> str:
    taken = {m.option_label for m in members}
    for letter in string.ascii_uppercase:
        if f"Option {letter}" not in taken:
            return f"Option {letter}"
    n = len(string.ascii_uppercase) + 1
    while f"Option {n}" in taken:
        n += 1
    return f"Option {n}"


def _renumber(members: List[CabinetEstimate]):
    """The restoration first, then the options in the order they had."""
    ordered = sorted(members, key=lambda m: (m.kind != "restore", m.option_order))
    for i, m in enumerate(ordered):
        m.option_order = i


def _group_key():
    """The job an estimate belongs to; one saved without a group is a job of its own."""
    return func.coalesce(CabinetEstimate.group_id, CabinetEstimate.id)


class CabinetEstimateService:
    def __init__(self, db: Session, company_id):
        self.db = db
        self.company_id = company_id

    # ── Queries (always this company's) ──

    def _query(self):
        return self.db.query(CabinetEstimate).filter(CabinetEstimate.company_id == self.company_id)

    def find(self, estimate_id) -> Optional[CabinetEstimate]:
        """This company's estimate, with its current boxes and line items.

        Boxes and line items are replaced with bulk deletes and new rows,
        which don't touch an estimate already in the session, so its lists
        are expired to be read afresh the next time they're used.
        """
        eid = _uuid(estimate_id)
        if eid is None:
            return None
        estimate = (
            self._query()
            .options(selectinload(CabinetEstimate.boxes), selectinload(CabinetEstimate.line_items))
            .filter(CabinetEstimate.id == eid)
            .first()
        )
        if estimate is not None:
            self.db.expire(estimate, ["boxes", "line_items"])
        return estimate

    def _group_members(self, estimate: CabinetEstimate) -> List[CabinetEstimate]:
        """Every estimate of a kitchen job, restoration first, then options in order."""
        return (
            self._query()
            .filter(_group_key() == (estimate.group_id or estimate.id))
            .order_by(CabinetEstimate.option_order, CabinetEstimate.created_at)
            .all()
        )

    def _member_summaries(self, group_ids: List[UUID]) -> list:
        if not group_ids:
            return []
        return (
            self.db.query(
                _group_key().label("group_id"),
                CabinetEstimate.id,
                CabinetEstimate.kind,
                CabinetEstimate.option_label,
                CabinetEstimate.option_order,
                CabinetEstimate.status,
                CabinetEstimate.total,
                CabinetEstimate.updated_at,
            )
            .filter(CabinetEstimate.company_id == self.company_id, _group_key().in_(group_ids))
            .order_by(CabinetEstimate.option_order, CabinetEstimate.created_at)
            .all()
        )

    def _check_customer(self, customer_id) -> Optional[UUID]:
        """The customer id if it is one of this company's customers; ValueError otherwise."""
        if customer_id in (None, ""):
            return None
        from app.domains.customer.models import Customer

        cid = _uuid(customer_id)
        found = cid and self.db.query(Customer.id).filter(
            Customer.id == cid, Customer.company_id == self.company_id,
        ).first()
        if not found:
            raise ValueError("That customer isn't in your customer list")
        return cid

    # ── CRUD ──

    def create_estimate(self, data: CabinetEstimateCreate, created_by_id=None) -> Dict[str, Any]:
        """Create a new cabinet estimate with boxes, the first of its own job.

        An insurance job starts with its restoration, a remodel job with
        Option A.
        """
        values = data.model_dump(exclude={"boxes"})
        values["customer_id"] = self._check_customer(values.get("customer_id"))
        estimate_id = uuid.uuid4()
        remodel = values.get("project_type") == "remodel"
        values.update({
            "id": estimate_id,
            "company_id": self.company_id,
            "group_id": estimate_id,
            "kind": "option" if remodel else "restore",
            "option_label": "Option A" if remodel else None,
            "option_order": 0,
            "created_by_id": created_by_id,
            "status": "draft",
        })
        self.db.add(CabinetEstimate(**values))
        self.db.flush()
        self._replace_boxes(estimate_id, data.boxes)
        self.db.flush()
        return self._full(estimate_id)

    def get_estimate(self, estimate_id) -> Optional[Dict[str, Any]]:
        return self._full(estimate_id)

    def list_estimates(
        self,
        customer_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        kind: Optional[str] = None,
        grouped: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Estimates with filters.

        grouped: one row per kitchen job (its first member: the restoration,
        or the first option of a remodel), each with the summaries of all
        its estimates.
        """
        query = self._query()
        if grouped:
            first = (
                self.db.query(
                    _group_key().label("group_id"),
                    func.min(CabinetEstimate.option_order).label("option_order"),
                )
                .filter(CabinetEstimate.company_id == self.company_id)
                .group_by(_group_key())
                .subquery()
            )
            query = query.join(first, and_(
                _group_key() == first.c.group_id,
                CabinetEstimate.option_order == first.c.option_order,
            ))
        if kind:
            query = query.filter(CabinetEstimate.kind == kind)
        if customer_id:
            cid = _uuid(customer_id)
            if cid is None:
                return [], 0
            query = query.filter(CabinetEstimate.customer_id == cid)
        if status:
            query = query.filter(CabinetEstimate.status == status)
        if search:
            term = f"%{search}%"
            from app.domains.customer.models import Customer

            matching_customers = self.db.query(Customer.id).filter(
                Customer.company_id == self.company_id, Customer.name.ilike(term),
            )
            query = query.filter(or_(
                CabinetEstimate.property_address.ilike(term),
                CabinetEstimate.zip_code.ilike(term),
                CabinetEstimate.claim_number.ilike(term),
                CabinetEstimate.notes.ilike(term),
                CabinetEstimate.customer_id.in_(matching_customers),
            ))

        total = query.count()
        estimates = (
            query.options(
                selectinload(CabinetEstimate.boxes),
                selectinload(CabinetEstimate.line_items),
                selectinload(CabinetEstimate.customer),
            )
            .order_by(desc(CabinetEstimate.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        members_by_group: Dict[str, List[Dict[str, Any]]] = {}
        for row in self._member_summaries([est.group_id or est.id for est in estimates]):
            members_by_group.setdefault(str(row.group_id), []).append(self._member_summary(row))
        items = []
        for est in estimates:
            item = row_dict(est)
            item["boxes"] = [row_dict(b) for b in est.boxes]
            item["line_items"] = [row_dict(li) for li in est.line_items]
            item["group_members"] = members_by_group.get(str(est.group_id or est.id), [])
            item["client_name"] = est.customer.name if est.customer else None
            items.append(item)
        return items, total

    def update_estimate(
        self, estimate_id, data: CabinetEstimateUpdate, skip_full_read: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Update estimate fields and optionally replace boxes."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None

        changes = data.model_dump(exclude_unset=True, exclude={"boxes"})
        if "customer_id" in changes:
            changes["customer_id"] = self._check_customer(changes["customer_id"])
        for key, value in changes.items():
            setattr(estimate, key, value)
        self._share_with_group(estimate, changes)

        if data.boxes is not None:
            self._replace_boxes(estimate.id, data.boxes)

        self.db.flush()
        if skip_full_read:
            return {"id": str(estimate.id)}
        return self._full(estimate.id)

    def _replace_boxes(self, estimate_id: UUID, boxes) -> None:
        self.db.query(CabinetBox).filter(CabinetBox.estimate_id == estimate_id).delete()
        for i, box in enumerate(boxes or []):
            values = box.model_dump() if hasattr(box, "model_dump") else dict(box)
            values["estimate_id"] = estimate_id
            values["display_order"] = i
            self.db.add(CabinetBox(**values))
        self.db.flush()

    def _share_with_group(self, estimate: CabinetEstimate, changes: Dict[str, Any]):
        """Carry job facts (customer, claim number, address) to the job's other estimates."""
        shared = {k: changes[k] for k in GROUP_SHARED_FIELDS if k in changes}
        if not shared:
            return
        for member in self._group_members(estimate):
            if member.id == estimate.id:
                continue
            for key, value in shared.items():
                if str(getattr(member, key) or "") != str(value or ""):
                    setattr(member, key, value)

    def delete_estimate(self, estimate_id, whole_group: bool = False) -> bool:
        """Delete an estimate and all related data (cascaded).

        whole_group deletes every estimate of the job. A restoration that
        still has options can't go on its own: the options were priced as
        upgrades on it.
        """
        estimate = self.find(estimate_id)
        if not estimate:
            return False
        members = self._group_members(estimate)
        if whole_group:
            for member in members:
                self.db.delete(member)
            self.db.flush()
            return True
        if estimate.kind == "restore" and len(members) > 1:
            raise ValueError(
                "This restoration still has upgrade options. Delete the "
                "options first, or delete the whole job from the estimate list."
            )
        self.db.delete(estimate)
        _renumber([m for m in members if m.id != estimate.id])
        self.db.flush()
        return True

    # ── Calculation ──

    def calculate(
        self, estimate_id, save_history: bool = True, changed_by_id=None,
    ) -> Optional[Dict[str, Any]]:
        """Run the calculator on an estimate's boxes and save the line items."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        if not estimate.tier:
            raise ValueError("Tier is required to calculate")
        if not estimate.boxes:
            raise ValueError("At least one cabinet box is required")

        e = estimate
        box_inputs = [
            BoxInput(
                code=b.code,
                cab_type=b.cab_type,
                location=b.location or "perimeter",
                width_inches=b.width_inches,
                height_inches=b.height_inches,
                is_specialty=b.is_specialty,
                specialty_type=b.specialty_type,
                has_glass_door=b.has_glass_door or False,
                range_panel_count=b.range_panel_count,
                door_pattern=b.door_pattern,
                qty=b.qty,
            )
            for b in e.boxes
        ]

        def flag(value, default=False):
            return default if value is None else bool(value)

        # Priced with the prices it was first priced with (a price book),
        # pinned now if this is the first time
        book = UnitPriceService(self.db).book_for(
            PRICE_DOMAIN, estimate, self._group_members(estimate),
        )
        with use_prices(book.prices):
            result = calculate_estimate(
                boxes=box_inputs,
                tier=e.tier,
                zip_code=e.zip_code or "",
                box_material=e.box_material,
                finish=e.finish,
                door_style=e.door_style,
                overlay_style=e.overlay_style,
                pricing_basis=e.pricing_basis,
                include_demo=e.include_demo,
                include_install=e.include_install,
                include_delivery=e.include_delivery,
                include_plumbing=e.include_plumbing,
                sink_type=e.sink_type or "single",
                include_aav=flag(e.include_aav),
                include_air_gap=flag(e.include_air_gap),
                include_soap_dispenser=flag(e.include_soap_dispenser),
                include_instant_hot=flag(e.include_instant_hot),
                include_dw_hookup=flag(e.include_dw_hookup),
                include_countertop_reset=e.include_countertop_reset,
                include_hardware=flag(e.include_hardware, True),
                include_crown_molding=flag(e.include_crown_molding),
                include_backsplash=flag(e.include_backsplash),
                backsplash_type=e.backsplash_type,
                backsplash_sqft=e.backsplash_sqft,
                include_toe_kick=flag(e.include_toe_kick, True),
                include_quarter_round=flag(e.include_quarter_round),
                include_countertop=flag(e.include_countertop),
                countertop_material=e.countertop_material,
                countertop_sqft=e.countertop_sqft,
                include_countertop_backsplash=flag(e.include_countertop_backsplash),
                countertop_backsplash_lf=e.countertop_backsplash_lf,
                island_countertop_material=e.island_countertop_material,
                island_countertop_sqft=e.island_countertop_sqft,
                include_drywall_repair=flag(e.include_drywall_repair),
                drywall_repair_type=e.drywall_repair_type or "patch",
                drywall_repair_sqft=e.drywall_repair_sqft,
                include_painting=flag(e.include_painting),
                painting_sqft=e.painting_sqft,
                include_appliance_rr=flag(e.include_appliance_rr),
                appliance_list=e.appliance_list,
                include_dumpster=flag(e.include_dumpster, True),
                include_electrical=flag(e.include_electrical),
                include_permit=flag(e.include_permit),
                filler_count=e.filler_count or 0,
                angled_joint_count=e.angled_joint_count or 0,
                countertop_support_count=e.countertop_support_count or 0,
                island_seating_overhang_in=e.island_seating_overhang_in,
                end_panel_counts=e.end_panel_counts,
                dishwasher_return_panel_count=e.dishwasher_return_panel_count or 0,
                include_light_rail=flag(e.include_light_rail),
                light_rail_lf=e.light_rail_lf,
                outlet_relocation_count=e.outlet_relocation_count or 0,
                delivery_floor=e.delivery_floor or 1,
                island_type=e.island_type or "custom",
                island_prefab_size=e.island_prefab_size,
                island_prefab_price=e.island_prefab_price,
                island_end_panel_sqft=e.island_end_panel_sqft or 0,
                island_back_panel_sqft=e.island_back_panel_sqft or 0,
                island_two_sided=bool(e.island_two_sided),
                overhead_pct=e.overhead_pct if e.overhead_pct is not None else 0.15,
                profit_pct=e.profit_pct if e.profit_pct is not None else 0.15,
                target_total=e.target_total,
                # The restoration is priced from the rate tables alone
                products=clean_selections(e.selections) if e.kind == "option" else None,
            )

        if save_history:
            self._save_history(estimate, changed_by_id, "Calculation executed")

        self.db.query(CabinetEstimateLineItem).filter(
            CabinetEstimateLineItem.estimate_id == estimate.id
        ).delete()
        for i, li in enumerate(result.line_items):
            self.db.add(CabinetEstimateLineItem(
                estimate_id=estimate.id,
                description=li.description,
                quantity=li.quantity,
                unit=li.unit,
                unit_price=li.unit_price,
                total=li.total,
                material_unit_price=li.material_unit_price,
                labor_unit_price=li.labor_unit_price,
                material_total=li.material_total,
                labor_total=li.labor_total,
                category=li.category,
                location=li.location,
                notes=li.notes,
                display_order=i,
            ))

        estimate.subtotal = result.subtotal
        estimate.overhead_pct = result.overhead_pct
        estimate.overhead_amount = result.overhead_amount
        estimate.profit_pct = result.profit_pct
        estimate.profit_amount = result.profit_amount
        estimate.adjustment_factor = result.adjustment_factor
        estimate.total = result.total
        estimate.methodology_notes = result.methodology_notes
        estimate.warning_flags = result.warning_flags
        estimate.status = "calculated"

        self.db.flush()
        return self._full(estimate.id)

    def use_current_prices(self, estimate_id, changed_by_id=None) -> Optional[Dict[str, Any]]:
        """Move a whole job onto today's prices (the defaults with the
        company's figures) and reprice every estimate of it that was priced."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        members = self._group_members(estimate)
        UnitPriceService(self.db).repin_group(PRICE_DOMAIN, members, self.company_id)
        for member in members:
            if not member.line_items:
                continue
            self._recalculate_quietly(member.id, changed_by_id, "Repriced at current prices")
        self.db.flush()
        return self._full(estimate.id)

    # ── Clone ──

    def clone_estimate(self, estimate_id, created_by_id=None) -> Optional[Dict[str, Any]]:
        """Clone an existing estimate into a new draft, the first of a new job.

        Every input column is copied so a clone recalculates to the same
        numbers; calculate() regenerates the results.
        """
        source = self.find(estimate_id)
        if not source:
            return None
        new_id = uuid.uuid4()
        remodel = source.project_type == "remodel"
        self._copy_estimate(source, {
            "id": new_id,
            "group_id": new_id,
            "project_type": source.project_type,
            "kind": "option" if remodel else "restore",
            "option_label": "Option A" if remodel else None,
            "option_order": 0,
            "created_by_id": created_by_id,
            "status": "draft",
            "notes": "Cloned from estimate",
            # A restoration never carries products
            "selections": source.selections if remodel else None,
            # A new job is priced at today's prices when it is calculated
            "price_book_id": None,
            "subtotal": 0, "overhead_amount": 0, "profit_amount": 0,
            "adjustment_factor": None, "total": 0,
            "methodology_notes": None, "warning_flags": [],
        }, with_line_items=False)
        return self._full(new_id)

    def _copy_estimate(
        self, source: CabinetEstimate, fields: Dict[str, Any], with_line_items: bool = True,
    ) -> UUID:
        """A new estimate with source's whole scope, boxes, sketch and (with
        with_line_items) line items, plus `fields`."""
        values = {
            col.name: copy.deepcopy(getattr(source, col.name))
            for col in CabinetEstimate.__table__.columns
            if col.name not in _NOT_COPIED
        }
        values.update(fields)
        new_id = values.setdefault("id", uuid.uuid4())
        self.db.add(CabinetEstimate(**values))
        self.db.flush()

        for i, box in enumerate(source.boxes):
            box_values = {f: getattr(box, f) for f in _BOX_FIELDS}
            box_values["location"] = box.location or "perimeter"
            box_values["has_glass_door"] = box.has_glass_door or False
            self.db.add(CabinetBox(estimate_id=new_id, display_order=i, **box_values))
        if with_line_items:
            for li in source.line_items:
                self.db.add(CabinetEstimateLineItem(
                    estimate_id=new_id, **{f: getattr(li, f) for f in _LINE_FIELDS},
                ))

        # The layout drawing comes along: an option is the same kitchen
        sketch = self.db.query(CabinetSketch).filter(CabinetSketch.estimate_id == source.id).first()
        if sketch is not None:
            self.db.add(CabinetSketch(
                estimate_id=new_id,
                canvas_width=sketch.canvas_width,
                canvas_height=sketch.canvas_height,
                scale_pixels_per_foot=sketch.scale_pixels_per_foot,
                overlay_data=copy.deepcopy(sketch.overlay_data or {}),
            ))
        self.db.flush()
        return new_id

    # ── Estimate group ──

    @staticmethod
    def _member_summary(member) -> Dict[str, Any]:
        return {
            "id": str(member.id),
            "kind": member.kind,
            "option_label": member.option_label,
            "option_order": member.option_order,
            "status": member.status,
            "total": member.total or 0,
            "updated_at": member.updated_at,
        }

    def add_option(self, estimate_id, created_by_id=None) -> Optional[Dict[str, Any]]:
        """A new option in the same job, starting as a copy of this estimate.

        It doesn't take the source's target total: that pins the total, so a
        recalculated option would come back at the restoration's figure
        whatever was upgraded.
        """
        source = self.find(estimate_id)
        if not source:
            return None
        members = self._group_members(source)
        new_id = self._copy_estimate(source, {
            "group_id": source.group_id or source.id,
            "project_type": source.project_type,
            "kind": "option",
            "option_label": _next_option_label(members),
            "option_order": max((m.option_order for m in members), default=0) + 1,
            "created_by_id": created_by_id,
            "status": "calculated" if source.line_items else "draft",
            "target_total": None,
            "adjustment_factor": None,
        })
        return self._full(new_id)

    def rename_option(self, estimate_id, label: str) -> Optional[Dict[str, Any]]:
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        if estimate.kind != "option":
            raise ValueError("The restoration estimate has no option name.")
        estimate.option_label = label.strip()
        self.db.flush()
        return self._full(estimate.id)

    def set_project_type(self, estimate_id, project_type: str) -> Optional[Dict[str, Any]]:
        """Switch the whole job between insurance and remodel.

        To remodel, the restoration becomes an option like the others. To
        insurance, the estimate this is asked from becomes the restoration,
        and lets go of its products: a restoration is priced from the rate
        tables alone.
        """
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        members = self._group_members(estimate)
        reprice = None
        if project_type == "remodel":
            for member in members:
                if member.kind == "restore":
                    member.kind = "option"
                    member.option_label = _next_option_label(members)
        elif not any(m.kind == "restore" for m in members):
            estimate.kind = "restore"
            estimate.option_label = None
            if clean_selections(estimate.selections):
                estimate.selections = None
                reprice = estimate
        for member in members:
            member.project_type = project_type
        _renumber(members)
        self.db.flush()
        if reprice is not None and reprice.status != "draft":
            self._recalculate_quietly(reprice.id)
        return self._full(estimate.id)

    def get_group(self, estimate_id) -> Optional[Dict[str, Any]]:
        """Every estimate of this one's job, with line items, to compare them."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        members = [self._full(m.id) for m in self._group_members(estimate)]
        return {
            "group_id": str(estimate.group_id or estimate.id),
            "project_type": estimate.project_type,
            "members": members,
        }

    # ── Products (an option's selections) ──

    def set_selection(
        self, estimate_id, slot: str, product_id: Optional[str], changed_by_id=None,
    ) -> Optional[Dict[str, Any]]:
        """Put a library product in one of an option's slots, or empty it.

        The estimate keeps a copy of the product as it is now. A calculated
        option is repriced at once, so its total follows the choice.
        """
        from app.domains.product_library.service import ProductError, ProductService, snapshot

        if slot not in SLOT_KEYS:
            raise ValueError(f"Unknown product slot: {slot}")
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        if estimate.kind != "option":
            raise ValueError(
                "The restoration is priced from the rate tables alone. Add an "
                "upgrade option to choose products."
            )
        selections = dict(clean_selections(estimate.selections))
        if product_id is None:
            selections.pop(slot, None)
        else:
            try:
                product = ProductService(self.db, self.company_id).get(UUID(str(product_id)))
            except (ProductError, ValueError):
                raise LookupError("That product isn't in the library")
            if product.category != SLOT_CATEGORY[slot]:
                raise ValueError(
                    f"That product is a {product.category.replace('_', ' ')}, "
                    f"not a {SLOT_CATEGORY[slot].replace('_', ' ')}."
                )
            selections[slot] = snapshot(product).model_dump(mode="json")
        estimate.selections = selections or None
        self.db.flush()
        if estimate.status != "draft":
            self._recalculate_quietly(estimate.id, changed_by_id, f"Product changed: {slot}")
        return self._full(estimate.id)

    def _recalculate_quietly(self, estimate_id, changed_by_id=None, description: str = "Recalculated"):
        """Reprice after a change that moves the total; a scope the
        calculator can't price yet (no tier, no boxes) is left as it was."""
        try:
            self.calculate(estimate_id, save_history=True, changed_by_id=changed_by_id)
        except ValueError as e:
            logger.info("Not repricing %s: %s", estimate_id, e)

    # ── History ──

    def get_history(self, estimate_id) -> List[Dict[str, Any]]:
        estimate = self.find(estimate_id)
        if not estimate:
            return []
        rows = (
            self.db.query(CabinetEstimateHistory)
            .filter(CabinetEstimateHistory.estimate_id == estimate.id)
            .order_by(desc(CabinetEstimateHistory.version_number))
            .all()
        )
        return [row_dict(h) for h in rows]

    def _save_history(self, estimate: CabinetEstimate, changed_by_id, description: str):
        """Save a snapshot of the current estimate state."""
        latest = (
            self.db.query(func.max(CabinetEstimateHistory.version_number))
            .filter(CabinetEstimateHistory.estimate_id == estimate.id)
            .scalar()
        )
        snapshot = row_dict(estimate)
        snapshot["boxes"] = [row_dict(b) for b in estimate.boxes]
        snapshot["line_items"] = [row_dict(li) for li in estimate.line_items]
        self.db.add(CabinetEstimateHistory(
            estimate_id=estimate.id,
            version_number=(latest or 0) + 1,
            snapshot_data=snapshot,
            changed_by_id=changed_by_id,
            change_description=description,
        ))

    # ── Purchase Order ──

    def get_purchase_order(self, estimate_id) -> Optional[Dict[str, Any]]:
        """Grouped box list for supplier ordering."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None

        # Group boxes by code + location + door pattern: a lattice W3030 and a
        # plain one are different things to order.
        box_groups: Dict[str, Dict] = {}
        for box in estimate.boxes:
            loc = box.location or "perimeter"
            pattern = box.door_pattern
            key = f"{box.code}_{loc}_{pattern or ''}"
            if key in box_groups:
                box_groups[key]["qty"] += box.qty
                continue
            loc_label = " (Island)" if loc == "island" else ""
            # A supplier doesn't know this code, so it says what it is.
            corner_label = {
                "three_door_corner_wall": (
                    " - Three-Door End Corner (12\" deep, doors wrap the run end)"
                ),
                "two_door_angle_end_wall": (
                    " - Two-Door Angle End (12\" x 12\", the front bent once,"
                    " a door on each face; as Wolf WEC1230D)"
                ),
                "three_door_angle_end_wall": (
                    " - Three-Door Angle End (12\" deep, a door on the front,"
                    " the 45° cut and the end)"
                ),
            }.get(box.specialty_type, "")
            pattern_label = (
                f" - {DOOR_PATTERN_LABELS[pattern]} Doors" if pattern in DOOR_PATTERN_LABELS else ""
            )
            box_groups[key] = {
                "code": box.code,
                "description": (
                    f"{box.cab_type.title()} Cabinet {box.code} "
                    f"({box.width_inches}\"W x {box.height_inches}\"H)"
                    f"{corner_label}{pattern_label}{loc_label}"
                ),
                "cab_type": box.cab_type,
                "width_inches": box.width_inches,
                "height_inches": box.height_inches,
                "qty": box.qty,
            }

        items = sorted(box_groups.values(), key=lambda x: (x["cab_type"], x["code"]))
        return {
            "estimate_id": str(estimate.id),
            "property_address": estimate.property_address,
            "items": items,
            "total_boxes": sum(i["qty"] for i in items),
        }

    # ── Sketch ──

    def sketch(self, estimate_id) -> Optional[CabinetSketch]:
        """The estimate's layout sketch, made empty the first time it's asked for."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        sketch = self.db.query(CabinetSketch).filter(CabinetSketch.estimate_id == estimate.id).first()
        if sketch is None:
            sketch = CabinetSketch(estimate_id=estimate.id, overlay_data=dict(EMPTY_OVERLAY))
            self.db.add(sketch)
            self.db.flush()
        return sketch

    # ── Helpers ──

    def _full(self, estimate_id) -> Optional[Dict[str, Any]]:
        """The estimate with boxes, line items, job members, customer and company."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        result = row_dict(estimate)
        result["boxes"] = [row_dict(b) for b in estimate.boxes]
        result["line_items"] = [row_dict(li) for li in estimate.line_items]
        result["group_members"] = [
            self._member_summary(row)
            for row in self._member_summaries([estimate.group_id or estimate.id])
        ]
        result["client_name"] = estimate.customer.name if estimate.customer else None
        result["company_info"] = self._company_info()
        result["price_book"] = UnitPriceService(self.db).book_summary(PRICE_DOMAIN, estimate)
        return result

    def _company_info(self) -> Optional[Dict[str, Any]]:
        """The company's details for a PDF header, in the shape the PDFs read."""
        from app.domains.company.models import Company

        company = self.db.query(Company).filter(Company.id == self.company_id).first()
        if not company:
            return None
        street = ", ".join(filter(None, [company.address_line1, company.address_line2]))
        return {
            "name": company.name,
            "address": street,
            "city": company.city,
            "state": company.state,
            "zipcode": company.zipcode,
            "phone": company.phone,
            "email": company.email,
            "website": company.website,
            "license_number": None,
            # A data: URL (see company/api.py); the PDFs embed it as an image
            "logo": company.logo_url or None,
        }


EMPTY_OVERLAY = {"walls": [], "cabinets": [], "appliances": [], "element_order": []}
