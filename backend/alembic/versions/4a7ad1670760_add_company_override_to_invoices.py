"""add company_override to invoices

Revision ID: 4a7ad1670760
Revises: cd099e784668
Create Date: 2026-07-09 17:06:04.167636

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '4a7ad1670760'
down_revision = 'cd099e784668'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'invoices',
        sa.Column(
            'company_override',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column('invoices', 'company_override')
