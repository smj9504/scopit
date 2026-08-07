"""seed moving/packing line items for existing companies

Revision ID: d4e5f6g7h8i9
Revises: c3d4e5f6g7h8
Create Date: 2026-03-22

"""
import sqlalchemy as sa
from sqlalchemy.orm import Session

from alembic import op

# revision identifiers, used by Alembic.
revision = 'd4e5f6g7h8i9'
down_revision = 'c3d4e5f6g7h8'
branch_labels = None
depends_on = None


def upgrade():
    """Seed default moving/packing prices as line items for all existing companies."""
    bind = op.get_bind()
    session = Session(bind=bind)

    try:
        # Get all active companies with at least one user (need created_by)
        result = session.execute(
            sa.text("""
                SELECT c.id as company_id, u.id as user_id
                FROM companies c
                JOIN users u ON u.company_id = c.id
                WHERE c.is_active = true
                GROUP BY c.id, u.id
            """)
        )
        companies = {}
        for row in result:
            # Use first user found per company
            if row.company_id not in companies:
                companies[row.company_id] = row.user_id

        if not companies:
            return

        # Import seed function
        from app.domains.tools.modules.packing.seed import seed_moving_line_items

        total_created = 0
        for company_id, user_id in companies.items():
            count = seed_moving_line_items(session, company_id, user_id)
            total_created += count

        print(f"Seeded {total_created} moving line items across {len(companies)} companies")

    except Exception as e:
        print(f"Warning: Could not seed moving line items: {e}")
        # Best-effort: do NOT rollback — that would revert the entire
        # Alembic transaction including the alembic_version update.


def downgrade():
    """Remove seeded moving line items."""
    bind = op.get_bind()
    session = Session(bind=bind)

    try:
        session.execute(
            sa.text("""
                DELETE FROM line_items
                WHERE cat LIKE 'Moving%'
            """)
        )
        session.commit()
    except Exception:
        session.rollback()
