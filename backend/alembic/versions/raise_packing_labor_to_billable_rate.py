"""raise packing labor to the 2026 restoration billable rate

The labor prices came from the Xactimate price list, which is a claims
reimbursement basis: Content Manipulation sat at $57.31/hr against a cited
Xactimate standard labor hour of $56.25. The 2026 restoration billable market
is $75-150/hr, so the base was roughly a third below even the low end, and the
earlier 3% market adjustment compounded that gap rather than closing it.

Move the labor group to a $75/hr basis -- the bottom of the billable range, the
most conservative rate that is actually a market rate. The whole group is
scaled by the same factor (75.00 / 57.31) so the supervisor and specialty
premiums over base labor are preserved.

Each code lists two source prices because the preceding migration
(b1c2d3e4f5a6) failed on its first deploy: a row may hold either the 3%
figure that migration writes, or the original price if it has not yet run
successfully. Matching both means no company is left behind either way, and a
price a user has edited themselves still matches neither and is left alone.

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-09-05

"""
import sqlalchemy as sa
from sqlalchemy.orm import Session

from alembic import op

# revision identifiers, used by Alembic.
revision = 'c2d3e4f5a6b7'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


# (code, a price the row may currently hold, raised billable price)
LABOR_INCREASES = [
    # code,   from,    to
    ("2825", 59.03, 75.0),
    ("2825", 57.31, 75.0),
    ("2911", 89.75, 114.04),
    ("2911", 87.14, 114.04),
    ("2912", 128.75, 163.58),
    ("2912", 125.0, 163.58),
    ("2833", 190.55, 242.1),
    ("2833", 185.0, 242.1),
    ("2834", 293.55, 372.97),
    ("2834", 285.0, 372.97),
    ("2835", 427.45, 543.1),
    ("2835", 415.0, 543.1),
]


def upgrade():
    bind = op.get_bind()
    session = Session(bind=bind)

    raised = 0
    for code, old_price, new_price in LABOR_INCREASES:
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

    session.commit()
    print(f"Raised {raised} packing labor line items to the billable rate")


def downgrade():
    """Move rows back to the price the preceding migration would have set.

    Only the first source listed for each code is restored -- that is the
    state this migration is the successor to.
    """
    bind = op.get_bind()
    session = Session(bind=bind)

    seen = set()
    for code, old_price, new_price in LABOR_INCREASES:
        if code in seen:
            continue
        seen.add(code)
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
