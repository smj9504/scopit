"""add payment_schedule to invoices

Revision ID: cd099e784668
Revises: e5f6g7h8i9j0
Create Date: 2026-07-09 13:57:54.806530

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'cd099e784668'
down_revision = 'e5f6g7h8i9j0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('invoices', sa.Column('payment_schedule', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade():
    op.drop_column('invoices', 'payment_schedule')
