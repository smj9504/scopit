"""
Scopit - Packing Tool Line Item Seeder

Seeds default moving/packing prices as LineItem records for a company.
Prices are Xactimate-aligned (VAAR8X_MAR26).
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
    {"code": "2825", "name": "Content Manipulation", "category": "labor", "unit": "HR", "price": 57.31},
    {"code": "2911", "name": "Supervisor/Admin", "category": "labor", "unit": "HR", "price": 87.14},

    # Room rates (composite reference)
    {"code": "2833", "name": "Small Room Pack/Reset", "category": "room", "unit": "EA", "price": 74.52},
    {"code": "2834", "name": "Large Room Pack/Reset", "category": "room", "unit": "EA", "price": 148.80},
    {"code": "2835", "name": "Extra Large Room Pack/Reset", "category": "room", "unit": "EA", "price": 297.60},

    # Boxes
    {"code": "3026", "name": "Small Box (1.5cf)", "category": "box", "unit": "EA", "price": 2.95},
    {"code": "3025", "name": "Medium Box (3.0cf)", "category": "box", "unit": "EA", "price": 3.91},
    {"code": "3027", "name": "Large Box (4.5cf)", "category": "box", "unit": "EA", "price": 5.28},
    {"code": "3028", "name": "XL Box (6.0cf)", "category": "box", "unit": "EA", "price": 7.48},
    {"code": "3029", "name": "Book Box", "category": "box", "unit": "EA", "price": 2.84},
    {"code": "3030", "name": "Dish Pack", "category": "box", "unit": "EA", "price": 9.98},
    {"code": "3039", "name": "Wardrobe Box", "category": "box", "unit": "EA", "price": 18.48},
    {"code": "3039S", "name": "Wardrobe Box - Small", "category": "box", "unit": "EA", "price": 16.01},
    {"code": "3039L", "name": "Wardrobe Box - Large", "category": "box", "unit": "EA", "price": 27.89},
    {"code": "3033", "name": "Mirror/Picture Box", "category": "box", "unit": "EA", "price": 10.29},
    {"code": "3899", "name": "TV Box", "category": "box", "unit": "EA", "price": 28.53},
    {"code": "3031", "name": "Lamp Box Set", "category": "box", "unit": "EA", "price": 8.91},

    # Mattress
    {"code": "3876", "name": "Mattress Bag - Twin", "category": "mattress", "unit": "EA", "price": 6.12},
    {"code": "3905", "name": "Mattress Bag - Full", "category": "mattress", "unit": "EA", "price": 8.36},
    {"code": "3877", "name": "Mattress Bag - Queen", "category": "mattress", "unit": "EA", "price": 9.07},
    {"code": "3878", "name": "Mattress Bag - King", "category": "mattress", "unit": "EA", "price": 10.08},

    # Protective
    {"code": "2915", "name": "Moving Blanket", "category": "protective", "unit": "EA", "price": 9.07},
    {"code": "2916", "name": "Furniture Pad", "category": "protective", "unit": "EA", "price": 18.26},
    {"code": "2917", "name": "Chair Cover", "category": "protective", "unit": "EA", "price": 5.31},
    {"code": "2918", "name": "Couch/Sofa Cover", "category": "protective", "unit": "EA", "price": 8.57},
    {"code": "3023", "name": "Bubble Wrap 12\"", "category": "protective", "unit": "RL", "price": 11.00},
    {"code": "3018", "name": "Bubble Wrap 24\"", "category": "protective", "unit": "RL", "price": 22.00},
    {"code": "3089", "name": "Packing Paper Bundle", "category": "protective", "unit": "BN", "price": 87.45},
    {"code": "2936", "name": "Shrink Wrap 20\"", "category": "protective", "unit": "RL", "price": 29.83},
    {"code": "3022", "name": "Corner Protectors (100)", "category": "protective", "unit": "BX", "price": 35.17},

    # Transport
    {"code": "2932", "name": "Moving Van 14'-15'", "category": "transport", "unit": "EA", "price": 172.36},
    {"code": "2933", "name": "Moving Van 16'-20'", "category": "transport", "unit": "EA", "price": 179.25},
    {"code": "2934", "name": "Moving Van 26'", "category": "transport", "unit": "EA", "price": 197.36},
    {"code": "2935", "name": "Cargo Van", "category": "transport", "unit": "EA", "price": 156.69},

    # Storage
    {"code": "2840", "name": "Climate-Controlled Storage", "category": "storage", "unit": "SF", "price": 2.18},
    {"code": "2844", "name": "Padlock", "category": "storage", "unit": "EA", "price": 16.05},
]


def seed_moving_line_items(
    db: Session,
    company_id: UUID,
    created_by: UUID,
) -> int:
    """
    Seed default moving/packing prices as LineItem records for a company.

    Idempotent: skips items whose code already exists for the company.
    Returns the count of newly created items.
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

    if created:
        db.commit()

    return created


def get_moving_categories() -> list:
    """Return all moving line item category names."""
    return list(CATEGORY_MAP.values())
