"""add images column to invoice_items and estimate_items

Revision ID: c3d4e5f6g7h8
Revises: b2c3d4e5f6g7
Create Date: 2026-03-13

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision = 'c3d4e5f6g7h8'
down_revision = 'b2c3d4e5f6g7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'invoice_items',
        sa.Column('images', JSONB, server_default='[]', nullable=True)
    )
    op.add_column(
        'estimate_items',
        sa.Column('images', JSONB, server_default='[]', nullable=True)
    )


def downgrade():
    op.drop_column('invoice_items', 'images')
    op.drop_column('estimate_items', 'images')
