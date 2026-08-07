"""add tool_id to line_items and backfill packing items

Revision ID: e5f6g7h8i9j0
Revises: d4e5f6g7h8i9, b2c3d4e5f6a7
Create Date: 2026-04-01

"""
import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = 'e5f6g7h8i9j0'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add nullable tool_id column
    op.add_column('line_items', sa.Column('tool_id', sa.String(50), nullable=True))
    op.create_index('ix_line_items_tool_id', 'line_items', ['tool_id'])

    # 2. Backfill existing Moving% items with tool_id='packing'
    op.execute("""
        UPDATE line_items
        SET tool_id = 'packing'
        WHERE cat LIKE 'Moving%%'
          AND tool_id IS NULL
    """)


def downgrade():
    op.drop_index('ix_line_items_tool_id', table_name='line_items')
    op.drop_column('line_items', 'tool_id')
