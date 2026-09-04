"""
Scopit - Packing Tool Line Item Seeder

Seeds default moving/packing prices as LineItem records for a company.
Prices are Xactimate-derived (VAAR8X_MAR26), reconciled to current
market rates.

2026 market adjustment applied per category, rather than as a single
across-the-board figure, because the cost drivers diverged this year:
  labor / room  +3%  -- restoration wage growth; matches the only
                        published Xactimate 2026 labor move (3%).
  box, mattress,
  protective    +8%  -- containerboard up ~$100/ton over 2026 and
                        corrugated box prices +9.7% Apr-May; pulp and
                        resin drive the wrap/paper items alongside.
  transport      0%  -- 26' truck retail day rates ($50-120) remain
                        well under the billed rate; no support.
  storage        0%  -- self-storage rents SOFTENED in 2026
                        (climate-controlled flat YoY), so a raise here
                        would move against the market.
The padlock (2844) is filed under storage but priced as hardware, so it
follows the material adjustment.

IMPORTANT: DEFAULT_MOVING_PRICES below must stay in sync with
service.DEFAULT_PRICES (same codes, prices, names and units).  The
calculator falls back to that table for any code missing from the
database, so a divergence makes the same estimate priced differently
depending on whether this seeder has been run.
"""

from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.domains.line_item.models import LineItem, LineItemVisibility

# ── Category mapping ─────────────────────────────────────────────────
# Maps original moving_estimate categories to Scopit line item categories
CATEGORY_MAP = {
    "labor": "Moving - Labor",
    "room": "Moving - Room Rates",
    "box": "Moving - Boxes",
    "mattress": "Moving - Mattress",
    "protective": "Moving - Protective",
    "transport": "Moving - Transport",
    "storage": "Moving - Storage",
}


# ── Default prices (Xactimate VAAR8X_MAR26) ─────────────────────────
DEFAULT_MOVING_PRICES = [
    # Labor
    {"code": "2825", "name": "Content Manipulation", "category": "labor", "unit": "HR", "price": 75.0},
    {"code": "2911", "name": "Supervisor/Admin", "category": "labor", "unit": "HR", "price": 114.04},
    {"code": "2912", "name": "Specialty Item Handler", "category": "labor", "unit": "HR", "price": 163.58},

    # Room rates (composite reference)
    {"code": "2833", "name": "Small Room Pack/Reset", "category": "room", "unit": "EA", "price": 242.1},
    {"code": "2834", "name": "Large Room Pack/Reset", "category": "room", "unit": "EA", "price": 372.97},
    {"code": "2835", "name": "Extra Large Room Pack/Reset", "category": "room", "unit": "EA", "price": 543.1},

    # Boxes
    {"code": "3025", "name": "Medium Box (3.0cf)", "category": "box", "unit": "EA", "price": 6.44},
    {"code": "3026", "name": "Small Box (1.5cf)", "category": "box", "unit": "EA", "price": 5.21},
    {"code": "3027", "name": "Large Box (4.5cf)", "category": "box", "unit": "EA", "price": 7.71},
    {"code": "3028", "name": "XL Box (6.0cf)", "category": "box", "unit": "EA", "price": 9.64},
    {"code": "3029", "name": "Book Box", "category": "box", "unit": "EA", "price": 5.21},
    {"code": "3030", "name": "Dish Pack", "category": "box", "unit": "EA", "price": 10.78},
    {"code": "3031", "name": "Lamp Box Set", "category": "box", "unit": "EA", "price": 9.62},
    {"code": "3033", "name": "Mirror/Picture Box", "category": "box", "unit": "EA", "price": 11.11},
    {"code": "3039", "name": "Wardrobe Box", "category": "box", "unit": "EA", "price": 19.96},
    {"code": "3039L", "name": "Wardrobe Box - Large", "category": "box", "unit": "EA", "price": 30.12},
    {"code": "3039S", "name": "Wardrobe Box - Small", "category": "box", "unit": "EA", "price": 17.29},
    {"code": "3899", "name": "TV Box", "category": "box", "unit": "EA", "price": 30.81},

    # Mattress
    {"code": "3876", "name": "Mattress Bag - Twin", "category": "mattress", "unit": "EA", "price": 9.64},
    {"code": "3877", "name": "Mattress Bag - Queen", "category": "mattress", "unit": "EA", "price": 13.5},
    {"code": "3878", "name": "Mattress Bag - King", "category": "mattress", "unit": "EA", "price": 15.43},
    {"code": "3905", "name": "Mattress Bag - Full", "category": "mattress", "unit": "EA", "price": 11.57},

    # Protective
    {"code": "2915", "name": "Moving Blanket", "category": "protective", "unit": "EA", "price": 15.43},
    {"code": "2916", "name": "Furniture Pad", "category": "protective", "unit": "EA", "price": 19.72},
    {"code": "2917", "name": "Chair Cover", "category": "protective", "unit": "EA", "price": 5.79},
    {"code": "2918", "name": "Couch/Sofa Cover", "category": "protective", "unit": "EA", "price": 9.64},
    {"code": "2936", "name": "Shrink Wrap 20\"", "category": "protective", "unit": "RL", "price": 32.22},
    {"code": "3018", "name": "Bubble Wrap 24\"", "category": "protective", "unit": "RL", "price": 23.76},
    {"code": "3022", "name": "Corner Protectors (100)", "category": "protective", "unit": "BX", "price": 37.98},
    {"code": "3023", "name": "Bubble Wrap 12\"", "category": "protective", "unit": "RL", "price": 11.88},
    {"code": "3035", "name": "Packing Tape Roll", "category": "protective", "unit": "EA", "price": 4.82},
    {"code": "3089", "name": "Packing Paper Bundle", "category": "protective", "unit": "BN", "price": 94.45},

    # Transport
    {"code": "2932", "name": "Moving Van 14'-15'", "category": "transport", "unit": "EA", "price": 198.0},
    {"code": "2933", "name": "Moving Van 16'-20'", "category": "transport", "unit": "EA", "price": 206.0},
    {"code": "2934", "name": "Moving Van 26'", "category": "transport", "unit": "EA", "price": 227.0},
    {"code": "2935", "name": "Cargo Van", "category": "transport", "unit": "EA", "price": 156.69},

    # Storage
    {"code": "2840", "name": "Climate-Controlled Storage", "category": "storage", "unit": "SF", "price": 2.18},
    {"code": "2844", "name": "Padlock", "category": "storage", "unit": "EA", "price": 17.33},
]


def seed_moving_line_items(
    db: Session,
    company_id: UUID,
    created_by: UUID,
    commit: bool = True,
) -> int:
    """
    Seed default moving/packing prices as LineItem records for a company.

    Idempotent: skips items whose code already exists for the company.
    Returns the count of newly created items.

    Args:
        db: Database session
        company_id: Company UUID
        created_by: User UUID recorded as the creator of these items
        commit: Commit the new rows.  Pass False when the caller is
            mid-transaction (e.g. signup, which is still building the
            company and user) and will commit itself.
    """
    # Get existing codes for this company (packing tool items)
    existing_codes = set(
        code for (code,) in db.query(LineItem.code).filter(
            LineItem.company_id == company_id,
            LineItem.tool_id == "packing",
            LineItem.is_active == True,
        ).all()
        if code
    )

    created = 0
    for price_data in DEFAULT_MOVING_PRICES:
        code = price_data["code"]
        if code in existing_codes:
            continue

        item = LineItem(
            code=code,
            name=price_data["name"],
            includes=f"Xactimate VAAR8X_MAR26 - {price_data['category'].title()}",
            unit=price_data["unit"],
            unit_price=Decimal(str(price_data["price"])),
            cat=CATEGORY_MAP[price_data["category"]],
            is_taxable=True,
            company_id=company_id,
            created_by=created_by,
            visibility=LineItemVisibility.COMPANY,
            is_active=True,
            tool_id="packing",
        )
        db.add(item)
        created += 1

    if created and commit:
        db.commit()

    return created


def get_moving_categories() -> list:
    """Return all moving line item category names."""
    return list(CATEGORY_MAP.values())
