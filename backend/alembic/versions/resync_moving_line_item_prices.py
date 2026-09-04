"""resync packing moving prices and backfill companies that have none

The packing tool holds prices in two places: the LineItem rows written by
seed_moving_line_items(), and the service.DEFAULT_PRICES fallback the
calculator uses for any code missing from the database.  The two had
drifted apart (room rates differed by more than 2x), so the same estimate
priced differently depending on whether a company had been seeded.

The tables are now reconciled to the higher of the two values.  This
migration brings existing data to that same state:

  1. Companies with no packing line items at all -- every company created
     after the original seed migration, since signup never seeded them --
     get the full set.
  2. Companies seeded earlier still hold the old, lower prices, so any
     untouched seeded row is updated to the reconciled price.

A row a user has edited themselves is left alone: only rows still at the
old seeded price are moved.

Revision ID: a9b8c7d6e5f4
Revises: d3e4f5a6b7c8
Create Date: 2026-09-05

"""
import sqlalchemy as sa
from sqlalchemy.orm import Session

from alembic import op

# revision identifiers, used by Alembic.
revision = 'a9b8c7d6e5f4'
down_revision = 'd3e4f5a6b7c8'
branch_labels = None
depends_on = None


# (code, old seeded price) -> new price.  Only rows still sitting at the
# old price are moved, so user edits survive.  Codes whose price did not
# change are omitted.
PRICE_CORRECTIONS = [
    # code,   old,     new
    ("2911", 87.14, 89.75),
    ("2833", 74.52, 190.55),
    ("2834", 148.8, 293.55),
    ("2835", 297.6, 427.45),
    ("3026", 2.95, 5.21),
    ("3025", 3.91, 6.44),
    ("3027", 5.28, 7.71),
    ("3028", 7.48, 9.64),
    ("3029", 2.84, 5.21),
    ("2915", 9.07, 15.43),
    ("2917", 5.31, 5.79),
    ("2918", 8.57, 9.64),
    ("3876", 6.12, 9.64),
    ("3905", 8.36, 11.57),
    ("3877", 9.07, 13.5),
    ("3878", 10.08, 15.43),
    ("2932", 172.36, 198.0),
    ("2933", 179.25, 206.0),
    ("2934", 197.36, 227.0),
    # 2026 market adjustment: rows still at the previously seeded
    # price move to the raised one; user-edited prices are left alone.
    ("2825", 57.31, 59.03),
    ("2844", 16.05, 17.33),
    ("2916", 18.26, 19.72),
    ("2936", 29.83, 32.22),
    ("3018", 22.0, 23.76),
    ("3022", 35.17, 37.98),
    ("3023", 11.0, 11.88),
    ("3030", 9.98, 10.78),
    ("3031", 8.91, 9.62),
    ("3033", 10.29, 11.11),
    ("3039", 18.48, 19.96),
    ("3039L", 27.89, 30.12),
    ("3039S", 16.01, 17.29),
    ("3089", 87.45, 94.45),
    ("3899", 28.53, 30.81),
]


def upgrade():
    bind = op.get_bind()
    session = Session(bind=bind)

    # ---- 1. Correct prices on rows still at the old seeded value ----
    corrected = 0
    for code, old_price, new_price in PRICE_CORRECTIONS:
        if abs(old_price - new_price) < 0.005:
            continue
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
        corrected += result.rowcount or 0

    # ---- 2. Seed companies that have no packing items at all ----
    result = session.execute(
        sa.text("""
            SELECT c.id AS company_id, MIN(u.id::text) AS user_id
            FROM companies c
            JOIN users u ON u.company_id = c.id
            WHERE c.is_active = true
              AND NOT EXISTS (
                  SELECT 1 FROM line_items li
                  WHERE li.company_id = c.id
                    AND li.tool_id = 'packing'
                    AND li.is_active = true
              )
            GROUP BY c.id
        """)
    )
    unseeded = [(row.company_id, row.user_id) for row in result]

    # Insert with raw SQL rather than seed_moving_line_items().  That
    # helper goes through the LineItem ORM model, whose
    # relationship("Company") cannot be resolved here: alembic/env.py
    # imports only Base, so the Company class is never registered and
    # mapper configuration fails with InvalidRequestError.
    seeded_rows = 0
    if unseeded:
        from app.domains.tools.modules.packing.seed import (
            CATEGORY_MAP,
            DEFAULT_MOVING_PRICES,
        )

        insert_stmt = sa.text("""
            INSERT INTO line_items (
                id, code, name, includes, unit, unit_price, cat,
                is_taxable, company_id, created_by, visibility,
                tool_id, is_active, created_at
            ) VALUES (
                gen_random_uuid(), :code, :name, :includes, :unit,
                :unit_price, :cat, true, CAST(:company_id AS uuid),
                CAST(:created_by AS uuid),
                CAST('company' AS lineitemvisibility), 'packing', true, now()
            )
        """)

        for company_id, user_id in unseeded:
            for price_data in DEFAULT_MOVING_PRICES:
                category = price_data["category"]
                session.execute(
                    insert_stmt,
                    {
                        "code": price_data["code"],
                        "name": price_data["name"],
                        "includes": (
                            "Xactimate VAAR8X_MAR26 - %s" % category.title()
                        ),
                        "unit": price_data["unit"],
                        "unit_price": price_data["price"],
                        "cat": CATEGORY_MAP[category],
                        "company_id": str(company_id),
                        "created_by": str(user_id),
                    },
                )
                seeded_rows += 1

    session.commit()
    print(
        f"Repriced {corrected} existing packing line items; "
        f"seeded {seeded_rows} items across {len(unseeded)} companies"
    )


def downgrade():
    """Restore the previous seeded prices.

    Only rows sitting at the reconciled price are moved back, so later
    user edits are preserved.  Rows seeded by this migration are left in
    place -- they are ordinary company line items at that point, and
    deleting them could remove prices the company has since relied on.
    """
    bind = op.get_bind()
    session = Session(bind=bind)

    for code, old_price, new_price in PRICE_CORRECTIONS:
        if abs(old_price - new_price) < 0.005:
            continue
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
