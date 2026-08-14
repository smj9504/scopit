"""add packing lead analysis progress columns

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-08-14

"""
import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = 'd8e9f0a1b2c3'
down_revision = 'c7d8e9f0a1b2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'packing_leads',
        sa.Column('analysis_completed_rooms', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'packing_leads',
        sa.Column('analysis_processed_photos', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade():
    op.drop_column('packing_leads', 'analysis_processed_photos')
    op.drop_column('packing_leads', 'analysis_completed_rooms')
