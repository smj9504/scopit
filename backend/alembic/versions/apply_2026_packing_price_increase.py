"""apply the 2026 market price increase to existing packing line items

The previous migration (a9b8c7d6e5f4) reconciled the two price tables and
seeded companies, but it shipped and ran with the pre-increase prices as its
targets.  Alembic will not re-run a stamped revision, so environments that
already applied it hold the old values -- 3025 at $5.96 where the price table
now says $6.44 -- and correcting that migration in place cannot reach them.

This migration moves those rows the rest of the way.  Only rows still sitting
at the value the previous migration wrote are touched, so a price a user has
since edited is left alone.

Two codes (2912 Specialty Item Handler, 3035 Packing Tape Roll) were added to
the price table after the earlier seeding, so companies seeded before then are
missing them entirely; they are inserted rather than updated.

Revision ID: b1c2d3e4f5a6
Revises: a9b8c7d6e5f4
Create Date: 2026-09-05

"""
import sqlalchemy as sa
from sqlalchemy.orm import Session

from alembic import op

# revision identifiers, used by Alembic.
revision = 'b1c2d3e4f5a6'
down_revision = 'a9b8c7d6e5f4'
branch_labels = None
depends_on = None


# (code, price the previous migration left in place, raised 2026 price).
# Increases are per category, not across the board: labour/room +3%,
# boxes/mattress/protective +8%, transport and storage unchanged.
PRICE_INCREASES = [
    # code,   from,    to
    ("2825", 57.31, 59.03),
    ("2833", 185.0, 190.55),
    ("2834", 285.0, 293.55),
    ("2835", 415.0, 427.45),
    ("2844", 16.05, 17.33),
    ("2911", 87.14, 89.75),
    ("2915", 14.29, 15.43),
    ("2916", 18.26, 19.72),
    ("2917", 5.36, 5.79),
    ("2918", 8.93, 9.64),
    ("2936", 29.83, 32.22),
    ("3018", 22.0, 23.76),
    ("3022", 35.17, 37.98),
    ("3023", 11.0, 11.88),
    ("3025", 5.96, 6.44),
    ("3026", 4.82, 5.21),
    ("3027", 7.14, 7.71),
    ("3028", 8.93, 9.64),
    ("3029", 4.82, 5.21),
    ("3030", 9.98, 10.78),
    ("3031", 8.91, 9.62),
    ("3033", 10.29, 11.11),
    ("3039", 18.48, 19.96),
    ("3039L", 27.89, 30.12),
    ("3039S", 16.01, 17.29),
    ("3089", 87.45, 94.45),
    ("3876", 8.93, 9.64),
    ("3877", 12.5, 13.5),
    ("3878", 14.29, 15.43),
    ("3899", 28.53, 30.81),
    ("3905", 10.71, 11.57),
]

# Codes absent from companies seeded before they were added to the table.
MISSING_CODES = ["2912", "3035"]


def upgrade():
    bind = op.get_bind()
    session = Session(bind=bind)

    raised = 0
    for code, old_price, new_price in PRICE_INCREASES:
        result = session.execute(
            sa.text("""
                UPDATE line_items
                SET unit_price = :new_price
                WHERE tool_id = 'packing'
                  AND code = :code
                  AND unit_price = :old_price
            """),
            {"code": code, "old_price": old_price, "new_price": new_price},
        )
        raised += result.rowcount or 0

    # Insert the two later-added codes for any company that has packing
    # items but is missing them.  Raw SQL for the same reason as the
    # previous migration: the LineItem ORM model's relationship("Company")
    # cannot resolve under alembic/env.py, which imports only Base.
    from app.domains.tools.modules.packing.seed import (
        CATEGORY_MAP,
        DEFAULT_MOVING_PRICES,
    )

    by_code = {d["code"]: d for d in DEFAULT_MOVING_PRICES}
    inserted = 0
    for code in MISSING_CODES:
        spec = by_code.get(code)
        if spec is None:
            continue
        category = spec["category"]
        result = session.execute(
            sa.text("""
                INSERT INTO line_items (
                    id, code, name, includes, unit, unit_price, cat,
                    is_taxable, company_id, created_by, visibility,
                    tool_id, is_active, created_at
                )
                SELECT
                    gen_random_uuid(), :code, :name, :includes, :unit,
                    :unit_price, :cat, true, li.company_id,
                    CAST(MIN(li.created_by::text) AS uuid),
                    CAST('company' AS lineitemvisibility),
                    'packing', true, now()
                FROM line_items li
                WHERE li.tool_id = 'packing'
                  AND li.is_active = true
                GROUP BY li.company_id
                HAVING NOT bool_or(li.code = :code)
            """),
            {
                "code": code,
                "name": spec["name"],
                "includes": "Xactimate VAAR8X_MAR26 - " + category.title(),
                "unit": spec["unit"],
                "unit_price": spec["price"],
                "cat": CATEGORY_MAP[category],
            },
        )
        inserted += result.rowcount or 0

    session.commit()
    print(f"Raised {raised} packing line items; inserted {inserted} missing")


def downgrade():
    """Move rows still at the raised price back to the previous value."""
    bind = op.get_bind()
    session = Session(bind=bind)

    for code, old_price, new_price in PRICE_INCREASES:
        session.execute(
            sa.text("""
                UPDATE line_items
                SET unit_price = :old_price
                WHERE tool_id = 'packing'
                  AND code = :code
                  AND unit_price = :new_price
            """),
            {"code": code, "old_price": old_price, "new_price": new_price},
        )

    session.commit()
