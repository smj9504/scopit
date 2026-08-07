"""add_line_item_units

Revision ID: add_line_item_units
Revises: a1b2c3d4e5f6
Create Date: 2026-01-28

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'add_line_item_units'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    # Create line_item_units table
    op.create_table(
        'line_item_units',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(50), nullable=False),
        sa.Column('label', sa.String(100), nullable=True),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('order_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
    )

    # Add foreign key constraint
    op.create_foreign_key(
        'fk_line_item_units_company_id',
        'line_item_units',
        'companies',
        ['company_id'],
        ['id'],
        ondelete='CASCADE'
    )

    # Create index
    op.create_index('ix_line_item_units_company_id', 'line_item_units', ['company_id'])


def downgrade():
    # Drop index and foreign key
    op.drop_index('ix_line_item_units_company_id', 'line_item_units')
    op.drop_constraint('fk_line_item_units_company_id', 'line_item_units', type_='foreignkey')
    
    # Drop table
    op.drop_table('line_item_units')

