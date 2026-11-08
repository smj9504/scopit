"""
Scopit - Bathroom Estimate service

Ported from MJ Estimate's bathroom_estimate service. Every query is limited
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
from sqlalchemy.orm.attributes import flag_modified

from app.domains.unit_prices.service import UnitPriceService
from app.domains.unit_prices.tables import use_prices

from .calculator import calculate_estimate
from .layout_changes import layout_changes
from .models import (
    BathroomEstimate,
    BathroomEstimateHistory,
    BathroomEstimateLineItem,
)
from .schemas import BathroomEstimateCreate, BathroomEstimateUpdate
from .selections import SLOTS, sold_with_top

logger = logging.getLogger(__name__)

# Facts about the job rather than the scope: every estimate of a bathroom
# job shares them, so changing one estimate's changes them all.
GROUP_SHARED_FIELDS = (
    "customer_id", "claim_number", "property_address", "city", "state",
    "zip_code", "building_type", "year_built", "designation",
)

# Columns a copy never takes from its source: its identity, its place in a
# job and its bookkeeping. Everything else is the scope and is copied, so a
# column added later is copied without anyone having to list it.
_NOT_COPIED = {
    "id", "created_at", "updated_at", "created_by_id", "status",
    "group_id", "project_type", "kind", "option_label", "option_order",
    "scopit_estimate_id",
}

# The JSON columns an update may replace wholesale
_JSON_FIELDS = (
    "sketch_data", "shower_spec", "bathtub_spec", "vanity_spec", "toilet_spec",
    "floor_spec", "walls_spec", "accessories_spec", "plumbing_spec",
    "electrical_spec", "substrate_spec", "hidden_costs",
)

_LINE_FIELDS = (
    "phase", "description", "quantity", "unit", "unit_price", "total",
    "category", "notes", "display_order",
)

# What an existing (current-layout) member is called
CURRENT_LAYOUT_LABEL = "Current layout"

# The price catalog bathroom estimates are priced from (unit_prices)
PRICE_DOMAIN = "bathroom"


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


def _next_option_label(members: List[BathroomEstimate]) -> str:
    taken = {m.option_label for m in members}
    for letter in string.ascii_uppercase:
        if f"Option {letter}" not in taken:
            return f"Option {letter}"
    n = len(string.ascii_uppercase) + 1
    while f"Option {n}" in taken:
        n += 1
    return f"Option {n}"


def _renumber(members: List[BathroomEstimate]):
    """The restoration first, then the options in the order they had, and a
    remodel's current layout last (so the job's list row is an option)."""
    ordered = sorted(members, key=lambda m: (m.kind == "existing", m.kind != "restore", m.option_order))
    for i, m in enumerate(ordered):
        m.option_order = i


def _group_key():
    """The job an estimate belongs to; one saved without a group is a job of its own."""
    return func.coalesce(BathroomEstimate.group_id, BathroomEstimate.id)


class BathroomEstimateService:
    def __init__(self, db: Session, company_id):
        self.db = db
        self.company_id = company_id

    # ── Queries (always this company's) ──

    def _query(self):
        return self.db.query(BathroomEstimate).filter(BathroomEstimate.company_id == self.company_id)

    def find(self, estimate_id) -> Optional[BathroomEstimate]:
        """This company's estimate, with its current line items.

        Line items are added and deleted with bulk deletes and new rows,
        which don't touch an estimate already in the session, so its list is
        expired to be read afresh the next time it's used.
        """
        eid = _uuid(estimate_id)
        if eid is None:
            return None
        estimate = (
            self._query()
            .options(selectinload(BathroomEstimate.line_items))
            .filter(BathroomEstimate.id == eid)
            .first()
        )
        if estimate is not None:
            self.db.expire(estimate, ["line_items"])
        return estimate

    def _group_members(self, estimate: BathroomEstimate) -> List[BathroomEstimate]:
        """Every estimate of a bathroom job, restoration first, then options in order."""
        return (
            self._query()
            .filter(_group_key() == (estimate.group_id or estimate.id))
            .order_by(BathroomEstimate.option_order, BathroomEstimate.created_at)
            .all()
        )

    def _member_summaries(self, group_ids: List[UUID]) -> list:
        if not group_ids:
            return []
        return (
            self.db.query(
                _group_key().label("group_id"),
                BathroomEstimate.id,
                BathroomEstimate.kind,
                BathroomEstimate.option_label,
                BathroomEstimate.option_order,
                BathroomEstimate.status,
                BathroomEstimate.total,
                BathroomEstimate.updated_at,
            )
            .filter(BathroomEstimate.company_id == self.company_id, _group_key().in_(group_ids))
            .order_by(BathroomEstimate.option_order, BathroomEstimate.created_at)
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

    def create_estimate(self, data: BathroomEstimateCreate, created_by_id=None) -> Dict[str, Any]:
        """Create a new bathroom estimate, the first of its own job.

        An insurance job starts with its restoration, a remodel job with
        Option A.
        """
        values = data.model_dump()
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
        self.db.add(BathroomEstimate(**values))
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

        grouped: one row per bathroom job (its first member: the
        restoration, or the first option of a remodel), each with the
        summaries of all its estimates.
        """
        query = self._query()
        if grouped:
            first = (
                self.db.query(
                    _group_key().label("group_id"),
                    func.min(BathroomEstimate.option_order).label("option_order"),
                )
                .filter(BathroomEstimate.company_id == self.company_id)
                .group_by(_group_key())
                .subquery()
            )
            query = query.join(first, and_(
                _group_key() == first.c.group_id,
                BathroomEstimate.option_order == first.c.option_order,
            ))
        if kind:
            query = query.filter(BathroomEstimate.kind == kind)
        if customer_id:
            cid = _uuid(customer_id)
            if cid is None:
                return [], 0
            query = query.filter(BathroomEstimate.customer_id == cid)
        if status:
            query = query.filter(BathroomEstimate.status == status)
        if search:
            term = f"%{search}%"
            from app.domains.customer.models import Customer

            matching_customers = self.db.query(Customer.id).filter(
                Customer.company_id == self.company_id, Customer.name.ilike(term),
            )
            query = query.filter(or_(
                BathroomEstimate.property_address.ilike(term),
                BathroomEstimate.city.ilike(term),
                BathroomEstimate.zip_code.ilike(term),
                BathroomEstimate.claim_number.ilike(term),
                BathroomEstimate.notes.ilike(term),
                BathroomEstimate.customer_id.in_(matching_customers),
            ))

        total = query.count()
        estimates = (
            query.options(
                selectinload(BathroomEstimate.line_items),
                selectinload(BathroomEstimate.customer),
            )
            .order_by(desc(BathroomEstimate.created_at))
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
            item["line_items"] = [row_dict(li) for li in est.line_items]
            item["group_members"] = members_by_group.get(str(est.group_id or est.id), [])
            item["client_name"] = est.customer.name if est.customer else None
            items.append(item)
        return items, total

    def update_estimate(
        self, estimate_id, data: BathroomEstimateUpdate, skip_full_read: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Update estimate fields."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None

        changes = data.model_dump(exclude_unset=True)
        if "customer_id" in changes:
            changes["customer_id"] = self._check_customer(changes["customer_id"])
        for key, value in changes.items():
            setattr(estimate, key, value)
            # A JSON column given back the same dict it was read as isn't
            # seen as changed otherwise
            if key in _JSON_FIELDS:
                flag_modified(estimate, key)
        self._share_with_group(estimate, changes)

        self.db.flush()
        if skip_full_read:
            return {"id": str(estimate.id)}
        return self._full(estimate.id)

    def _share_with_group(self, estimate: BathroomEstimate, changes: Dict[str, Any]):
        """Carry job facts (customer, claim number, address...) to the job's other estimates."""
        shared = {k: changes[k] for k in GROUP_SHARED_FIELDS if k in changes}
        if not shared:
            return
        for member in self._group_members(estimate):
            if member.id == estimate.id:
                continue
            for key, value in shared.items():
                if getattr(member, key) != value:
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
        """Run the calculator on the estimate and save the line items."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        if estimate.kind == "existing":
            raise ValueError(
                "The current layout is the bathroom as it is today; it isn't "
                "priced. Calculate its options instead."
            )

        if save_history:
            self._save_history(estimate, changed_by_id, "Calculation executed")

        baseline = self._layout_baseline(estimate)
        changes = (
            layout_changes(baseline.sketch_data, estimate.sketch_data)
            if baseline is not None else None
        )
        # Priced with the prices it was first priced with (a price book),
        # pinned now if this is the first time
        book = UnitPriceService(self.db).book_for(
            PRICE_DOMAIN, estimate, self._group_members(estimate),
        )
        with use_prices(book.prices):
            result = calculate_estimate(estimate, layout_changes=changes)

        self._replace_line_items(estimate.id, result["line_items"])

        estimate.subtotal = result["subtotal"]
        estimate.overhead_amount = result["overhead_amount"]
        estimate.profit_amount = result["profit_amount"]
        estimate.tax_amount = result["tax_amount"]
        estimate.total = result["total"]
        estimate.adjustment_factor = result.get("adjustment_factor")
        estimate.methodology_notes = result.get("methodology_notes")
        estimate.warning_flags = result.get("warning_flags", [])
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
            if member.kind == "existing" or not member.line_items:
                continue
            self.calculate(member.id, save_history=True, changed_by_id=changed_by_id)
        self.db.flush()
        return self._full(estimate.id)

    def _replace_line_items(self, estimate_id: UUID, line_items: List[Dict[str, Any]]) -> None:
        self.db.query(BathroomEstimateLineItem).filter(
            BathroomEstimateLineItem.estimate_id == estimate_id
        ).delete()
        for i, li in enumerate(line_items):
            self.db.add(BathroomEstimateLineItem(
                estimate_id=estimate_id,
                phase=li["phase"],
                description=li["description"],
                quantity=li["quantity"],
                unit=li["unit"],
                unit_price=li["unit_price"],
                total=li["total"],
                category=li["category"],
                notes=li.get("notes"),
                display_order=i,
            ))
        self.db.flush()

    # ── Clone ──

    def clone_estimate(self, estimate_id, created_by_id=None) -> Optional[Dict[str, Any]]:
        """Clone an existing estimate into a new draft, the first of a new job."""
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
            # A clone that starts an insurance job is its restoration: no products
            "selections": copy.deepcopy(source.selections) if remodel else None,
            # A new job is priced at today's prices when it is calculated
            "price_book_id": None,
        })
        self._recalc_estimate_totals(new_id)
        return self._full(new_id)

    def _copy_estimate(self, source: BathroomEstimate, fields: Dict[str, Any]) -> UUID:
        """A new estimate with source's whole scope and line items, plus `fields`."""
        values = {
            col.name: copy.deepcopy(getattr(source, col.name))
            for col in BathroomEstimate.__table__.columns
            if col.name not in _NOT_COPIED
        }
        values.update(fields)
        new_id = values.setdefault("id", uuid.uuid4())
        self.db.add(BathroomEstimate(**values))
        self.db.flush()

        for li in source.line_items:
            self.db.add(BathroomEstimateLineItem(
                estimate_id=new_id, **{f: getattr(li, f) for f in _LINE_FIELDS},
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
        insurance, the estimate this is asked from becomes the restoration.
        """
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        members = self._group_members(estimate)
        if project_type == "remodel":
            for member in members:
                if member.kind == "restore":
                    member.kind = "option"
                    member.option_label = _next_option_label(members)
        elif not any(m.kind == "restore" for m in members):
            # The bathroom as it is today is what a restoration puts back;
            # without one drawn, the estimate this is asked from becomes it
            current = next((m for m in members if m.kind == "existing"), None)
            restore = current or estimate
            restore.kind = "restore"
            restore.option_label = None
            # Priced from the rate tables, never from products
            restore.selections = None
        for member in members:
            member.project_type = project_type
        _renumber(members)
        self.db.flush()
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

    def _layout_baseline(self, estimate: BathroomEstimate) -> Optional[BathroomEstimate]:
        """The bathroom as it is, for an option to price its layout changes
        against: the restoration of an insurance job, the current layout of a
        remodel. None for anything but an option, or a remodel without one."""
        if estimate.kind != "option":
            return None
        members = self._group_members(estimate)
        for kind in ("restore", "existing"):
            found = next((m for m in members if m.kind == kind and m.id != estimate.id), None)
            if found is not None:
                return found
        return None

    def get_layout_changes(self, estimate_id) -> Optional[Dict[str, Any]]:
        """How this option's saved sketch differs from its baseline's, and which changes are left out."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        baseline = self._layout_baseline(estimate)
        if baseline is None:
            return {"baseline": None, "changes": [], "skips": []}
        return {
            "baseline": {
                "id": str(baseline.id),
                "kind": baseline.kind,
                "name": "Restoration" if baseline.kind == "restore" else CURRENT_LAYOUT_LABEL,
            },
            "changes": [c.to_dict() for c in layout_changes(baseline.sketch_data, estimate.sketch_data)],
            "skips": list((estimate.plumbing_spec or {}).get("layout_change_skips") or []),
        }

    def add_current_layout(self, estimate_id, created_by_id=None) -> Optional[Dict[str, Any]]:
        """A remodel's bathroom as it is today, unpriced, for its options to
        price moved plumbing and walls against. It starts as a copy of this
        estimate, to be drawn back to how the room is now."""
        source = self.find(estimate_id)
        if not source:
            return None
        if source.project_type != "remodel":
            raise ValueError("An insurance job's restoration is already the bathroom as it is.")
        members = self._group_members(source)
        if any(m.kind == "existing" for m in members):
            raise ValueError("This job already has its current layout.")
        new_id = self._copy_estimate(source, {
            "group_id": source.group_id or source.id,
            "project_type": "remodel",
            "kind": "existing",
            "option_label": CURRENT_LAYOUT_LABEL,
            "option_order": max((m.option_order for m in members), default=0) + 1,
            "created_by_id": created_by_id,
            "status": "draft",
            "target_total": None,
            # The bathroom as it is has none of the option's new products
            "selections": None,
            # It isn't priced: no totals (and no line items, below)
            "subtotal": 0, "overhead_amount": 0, "profit_amount": 0, "tax_amount": 0, "total": 0,
            "adjustment_factor": None, "methodology_notes": None, "warning_flags": [],
        })
        self._replace_line_items(new_id, [])
        return self._full(new_id)

    # ── Selections: the products an option is built from ──

    def set_selection(
        self, estimate_id, slot: str, product_id, includes_top: Optional[bool] = None,
    ) -> Optional[Dict[str, Any]]:
        """Pick a library product for one of an option's slots. The estimate
        keeps a copy of it, so changing the library later doesn't move it.

        LookupError when the product isn't in this company's library.
        """
        from app.domains.product_library.service import ProductError, ProductService, snapshot

        estimate = self.find(estimate_id)
        if not estimate:
            return None
        if estimate.kind != "option":
            raise ValueError(
                "Only an option is built from products; the restoration stays "
                "priced from the rate tables."
            )
        if slot not in SLOTS:
            raise ValueError(f"Unknown product slot {slot!r}")
        try:
            product = ProductService(self.db, self.company_id).get(UUID(str(product_id)))
        except (ProductError, ValueError):
            raise LookupError("That product isn't in the library")
        if product.category not in SLOTS[slot]["categories"]:
            raise ValueError(f"That product isn't a {SLOTS[slot]['label'].lower()}.")
        entry = snapshot(product).model_dump(mode="json")
        if slot == "vanity":
            entry["includes_top"] = sold_with_top(product.title) if includes_top is None else includes_top
        self._write_selections(estimate, {**(estimate.selections or {}), slot: entry})
        return self._full(estimate.id)

    def clear_selection(self, estimate_id, slot: str) -> Optional[Dict[str, Any]]:
        """Take a slot's product off an option; it goes back to the rate table's allowance."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        remaining = {k: v for k, v in (estimate.selections or {}).items() if k != slot}
        self._write_selections(estimate, remaining or None)
        return self._full(estimate.id)

    def product_pictures(self, estimates: List[Dict[str, Any]]) -> Dict[str, bytes]:
        """The main picture of each product the options among `estimates`
        picked, by file id, for their PDFs. One that can't be had is left
        out; the PDF goes without it."""
        from app.domains.product_library.service import image_bytes

        wanted = {
            sel["image_file_ids"][0]
            for e in estimates if e.get("kind") == "option"
            for sel in (e.get("selections") or {}).values()
            if isinstance(sel, dict) and sel.get("image_file_ids")
        }
        pictures: Dict[str, bytes] = {}
        for file_id in wanted:
            data = image_bytes(self.db, self.company_id, str(file_id))
            if data:
                pictures[str(file_id)] = data
        return pictures

    def _write_selections(self, estimate: BathroomEstimate, selections: Optional[Dict[str, Any]]):
        estimate.selections = selections
        flag_modified(estimate, "selections")
        self.db.flush()

    # ── Line items, edited by hand ──

    def _line_item(self, estimate_id, item_id) -> Optional[BathroomEstimateLineItem]:
        """One of this company's estimate's line items."""
        estimate = self.find(estimate_id)
        iid = _uuid(item_id)
        if not estimate or iid is None:
            return None
        return (
            self.db.query(BathroomEstimateLineItem)
            .filter(BathroomEstimateLineItem.id == iid, BathroomEstimateLineItem.estimate_id == estimate.id)
            .first()
        )

    def update_line_item(self, estimate_id, item_id, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a single line item and recalculate totals."""
        item = self._line_item(estimate_id, item_id)
        if not item:
            return None
        update = {k: v for k, v in data.items() if v is not None}
        qty = update.get("quantity", item.quantity)
        rate = update.get("unit_price", item.unit_price)
        if "total" not in update:
            update["total"] = round(qty * rate, 2)
        for key, value in update.items():
            setattr(item, key, value)
        self.db.flush()
        self._recalc_estimate_totals(item.estimate_id)
        return self._full(item.estimate_id)

    def delete_line_item(self, estimate_id, item_id) -> Optional[Dict[str, Any]]:
        """Delete a single line item and recalculate totals."""
        item = self._line_item(estimate_id, item_id)
        if not item:
            return None
        parent_id = item.estimate_id
        self.db.delete(item)
        self.db.flush()
        self._recalc_estimate_totals(parent_id)
        return self._full(parent_id)

    def add_line_item(self, estimate_id, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Add a new line item to the estimate, at the end."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        max_order = max((li.display_order or 0 for li in estimate.line_items), default=-1)
        qty = data.get("quantity", 1.0)
        rate = data.get("unit_price", 0.0)
        self.db.add(BathroomEstimateLineItem(
            estimate_id=estimate.id,
            phase=data["phase"],
            description=data["description"],
            quantity=qty,
            unit=data.get("unit") or "EA",
            unit_price=rate,
            total=data.get("total") or round(qty * rate, 2),
            category=data.get("category") or "misc",
            notes=data.get("notes"),
            display_order=max_order + 1,
        ))
        self.db.flush()
        self._recalc_estimate_totals(estimate.id)
        return self._full(estimate.id)

    def delete_phase(self, estimate_id, phase: int) -> Optional[Dict[str, Any]]:
        """Delete all items in a phase and renumber the phases after it."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        for li in list(estimate.line_items):
            if li.phase == phase:
                self.db.delete(li)
            elif li.phase > phase:
                li.phase = li.phase - 1
        self.db.flush()
        self._recalc_estimate_totals(estimate.id)
        return self._full(estimate.id)

    def _recalc_estimate_totals(self, estimate_id) -> None:
        """Re-sum the estimate's subtotal and total from its current line items.

        O&P is already absorbed into line item pricing by the calculator.
        The total is never rounded, so no line item is ever changed behind
        the user.
        """
        estimate = self.find(estimate_id)
        if not estimate:
            return
        subtotal = round(sum(li.total for li in estimate.line_items), 2)
        estimate.subtotal = subtotal
        estimate.overhead_amount = 0
        estimate.profit_amount = 0
        estimate.total = subtotal
        self.db.flush()

    # ── History ──

    def get_history(self, estimate_id) -> List[Dict[str, Any]]:
        estimate = self.find(estimate_id)
        if not estimate:
            return []
        rows = (
            self.db.query(BathroomEstimateHistory)
            .filter(BathroomEstimateHistory.estimate_id == estimate.id)
            .order_by(desc(BathroomEstimateHistory.version_number))
            .all()
        )
        return [row_dict(h) for h in rows]

    def _save_history(self, estimate: BathroomEstimate, changed_by_id, description: str):
        """Save a snapshot of the current estimate state."""
        latest = (
            self.db.query(func.max(BathroomEstimateHistory.version_number))
            .filter(BathroomEstimateHistory.estimate_id == estimate.id)
            .scalar()
        )
        snapshot = row_dict(estimate)
        snapshot["line_items"] = [row_dict(li) for li in estimate.line_items]
        self.db.add(BathroomEstimateHistory(
            estimate_id=estimate.id,
            version_number=(latest or 0) + 1,
            snapshot_data=snapshot,
            changed_by_id=changed_by_id,
            change_description=description,
        ))

    # ── Overview note ──

    def generate_overview(self, estimate_id) -> Optional[str]:
        """Write the PDF's overview note from the estimate's scope."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        from .note_generator import generate_overview_note

        overview = generate_overview_note(estimate)
        estimate.overview_text = overview
        self.db.flush()
        return overview

    # ── Helpers ──

    def _full(self, estimate_id) -> Optional[Dict[str, Any]]:
        """The estimate with line items, job members, customer and company."""
        estimate = self.find(estimate_id)
        if not estimate:
            return None
        result = row_dict(estimate)
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
            "logo": company.logo_url or None,
        }
