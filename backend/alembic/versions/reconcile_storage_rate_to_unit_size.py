"""reconcile the climate-controlled storage rate to market

Code 2840 is billed per SF per month and was seeded at $2.18 for every unit
size.  Self-storage is not priced that way: the fixed cost of a unit -- door,
climate control, security, access -- is spread over its floor area, so $/SF/mo
falls sharply as units grow.  2026 climate-controlled market rates run about

    5x5    $2.46/SF     10x15  $1.10/SF
    5x10   $1.70/SF     10x20  $1.12/SF
    10x10  $1.35/SF     10x30  $1.13/SF

so a single flat rate was roughly right at the smallest unit and close to 2x
the market on the large ones -- which is where house-sized pack-outs land.  A
3-bedroom job billed $436/mo against a market rent near $225.

The calculator now scales the rate by unit size
(STORAGE_RATE_MULT_BY_SIZE), normalised so 10x10 == 1.00.  That makes 2840 the
anchor rather than a universal rate, and the anchor is the 10x10 market price:

    2840 Climate-Controlled Storage  2.18 -> 1.35

A company that has edited 2840 keeps its own number and gets the same
size-shaped curve scaled around it, so only rows still holding the seeded
$2.18 are moved.

Note this is a rate correction, not a discount: the size multipliers below
1.00 are applied by the calculator on top of this anchor, and the storage
sizing was rebased onto operator-published capacity in the same change.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-09-08

"""
import sqlalchemy as sa
from sqlalchemy.orm import Session

from alembic import op

# revision identifiers, used by Alembic.
revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


# (code, seeded flat rate, 10x10-anchored market rate).
STORAGE_RATE_CORRECTIONS = [
    # code,  from,  to
    ("2840", 2.18, 1.35),
]


def upgrade():
    bind = op.get_bind()
    session = Session(bind=bind)

    moved = 0
    for code, old_price, new_price in STORAGE_RATE_CORRECTIONS:
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
        moved += result.rowcount or 0

    session.commit()
    print(f"Reconciled {moved} packing storage line items to the market anchor rate")


def downgrade():
    """Move rows still at the corrected price back to the seeded flat rate."""
    bind = op.get_bind()
    session = Session(bind=bind)

    for code, old_price, new_price in STORAGE_RATE_CORRECTIONS:
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
