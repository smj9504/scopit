"""raise packing transport rates to cover real all-in rental cost

The 2026 packing price increase (b1c2d3e4f5a6) left transport at 0%, on the
stated ground that "26' truck retail day rates ($50-120) remain well under the
billed rate".  That compared the wrong figure: $50-120 is the advertised BASE
day rate, which excludes mileage ($0.59-0.99/mi), fuel (a 26' diesel returns
8-10 mpg), the damage waiver (~$15/day) and environmental fees.

Priced the way a contractor actually pays it -- a 50-mile local move, all in --
2026 retail lands at roughly:

    Cargo van      $95-180   (realistic mid ~$145)
    14'-15'        $115-210  (mid ~$175)
    16'-20'        $130-250  (mid ~$200)
    26'            $160-300  (mid ~$240)

against billed rates of $156.69 / $198 / $206 / $227.  The 26' line was
therefore billing UNDER its own retail cost, before any allowance for fuel
surcharge, operator time or overhead -- and the Xactimate DY rate is a bundled
figure that is meant to carry all of those.

New rates target ~1.15x the realistic mid, capped at the peak-demand high so
each line stays defensible against a quote:

    2935 Cargo Van       156.69 -> 167.00   (+6.6%)
    2932 Moving Van 14'  198.00 -> 201.00   (+1.5%)
    2933 Moving Van 16'  206.00 -> 230.00   (+11.7%)
    2934 Moving Van 26'  227.00 -> 276.00   (+21.6%)

Only rows still sitting at the previous value are moved, so a price a company
has since edited is left alone.

Revision ID: d4e5f6a7b8c9
Revises: c2d3e4f5a6b7
Create Date: 2026-09-07

"""
import sqlalchemy as sa
from sqlalchemy.orm import Session

from alembic import op

# revision identifiers, used by Alembic.
revision = 'd4e5f6a7b8c9'
down_revision = 'c2d3e4f5a6b7'
branch_labels = None
depends_on = None


# (code, price the 2026 increase left in place, market-reconciled rate).
TRANSPORT_INCREASES = [
    # code,   from,    to
    ("2932", 198.0, 201.0),
    ("2933", 206.0, 230.0),
    ("2934", 227.0, 276.0),
    ("2935", 156.69, 167.0),
]


def upgrade():
    bind = op.get_bind()
    session = Session(bind=bind)

    raised = 0
    for code, old_price, new_price in TRANSPORT_INCREASES:
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
    print(f"Raised {raised} packing transport line items to market rates")


def downgrade():
    """Move rows still at the raised price back to the previous value."""
    bind = op.get_bind()
    session = Session(bind=bind)

    for code, old_price, new_price in TRANSPORT_INCREASES:
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
