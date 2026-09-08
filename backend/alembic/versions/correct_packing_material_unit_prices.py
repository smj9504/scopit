"""correct packing material prices that drifted from their catalog unit

Three protective materials carried prices the market does not support, and
two of them land on essentially every estimate the tool produces:

  3089 Packing Paper Bundle  $94.45 -> $34.00
      The row never stated a bundle weight, and $94.45 is roughly 3x any
      real source for a 25-lb bundle of 24x36 newsprint (U-Haul ~$30,
      Home Depot ~$28, Uline ~$41).  Because calculate_materials scales
      paper off the box count and floors it at one bundle, this single line
      reached ~29% of the material subtotal on a 3-bedroom pack-out.  The
      name now states the weight so the unit is auditable.

  2916 Furniture Pad         $19.72 -> $14.00
      Priced above every retail source for a 72x80 pad (U-Haul $9.95-13.95,
      Home Depot ~$10, Uline $12-18) and, more visibly, 28% above the
      Moving Blanket beside it at $15.43 -- an inversion of the real supply
      chain that a customer comparing the two lines cannot be told a story
      about.  18.26 was already high when the 2026 increase compounded it.

  3035 Packing Tape Roll     $4.82 -> $5.21
      The one protective code that never received the 2026 +8% increase.
      It was added to the price table late, so the increase migration
      INSERTed it at the seed price via MISSING_CODES instead of raising
      it.  Every other protective code moved by 1.080; 4.82 x 1.08 = 5.21,
      which is also exactly where box_small and box_book landed from the
      same starting price.

Only rows still holding the superseded value are touched, so a price a
company has since edited by hand is left alone.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-08

"""
import sqlalchemy as sa
from sqlalchemy.orm import Session

from alembic import op

# revision identifiers, used by Alembic.
revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


# (code, price a previous migration or the seeder left in place, corrected).
# A code may appear more than once when different vintages of the table
# wrote different values; all rows for a code must share one target.
PRICE_CORRECTIONS = [
    # code,   from,   to
    ("2916", 19.72, 14.0),
    ("2916", 18.26, 14.0),
    ("3035", 4.82, 5.21),
    ("3089", 94.45, 34.0),
    ("3089", 87.45, 34.0),
]

# Rows whose display name changed alongside the price. Stating the bundle
# weight is what makes the unit price auditable, so the rename travels with
# the correction rather than waiting for a reseed.
NAME_CORRECTIONS = [
    ("3089", "Packing Paper Bundle", "Packing Paper Bundle (25 lb)"),
]


def upgrade():
    bind = op.get_bind()
    session = Session(bind=bind)

    for code, old_price, new_price in PRICE_CORRECTIONS:
        session.execute(
            sa.text("""
                UPDATE line_items
                SET unit_price = :new_price
                WHERE tool_id = 'packing'
                  AND code = :code
                  AND unit_price = :old_price
            """),
            {"code": code, "old_price": old_price, "new_price": new_price},
        )

    for code, old_name, new_name in NAME_CORRECTIONS:
        session.execute(
            sa.text("""
                UPDATE line_items
                SET name = :new_name
                WHERE tool_id = 'packing'
                  AND code = :code
                  AND name = :old_name
            """),
            {"code": code, "old_name": old_name, "new_name": new_name},
        )

    session.commit()


def downgrade():
    bind = op.get_bind()
    session = Session(bind=bind)

    # Reverse only the rows still holding the corrected value, and only to
    # the price this migration actually superseded (the first source listed
    # for each code), so a hand-edited price is not clobbered on the way back.
    reverted = {}
    for code, old_price, new_price in PRICE_CORRECTIONS:
        reverted.setdefault(code, (old_price, new_price))

    for code, (old_price, new_price) in reverted.items():
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

    for code, old_name, new_name in NAME_CORRECTIONS:
        session.execute(
            sa.text("""
                UPDATE line_items
                SET name = :old_name
                WHERE tool_id = 'packing'
                  AND code = :code
                  AND name = :new_name
            """),
            {"code": code, "old_name": old_name, "new_name": new_name},
        )

    session.commit()
