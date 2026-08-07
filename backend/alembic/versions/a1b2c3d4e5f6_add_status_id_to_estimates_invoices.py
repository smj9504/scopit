"""add_status_id_to_estimates_invoices

Revision ID: a1b2c3d4e5f6
Revises: 892f08211f6b
Create Date: 2026-01-28

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '892f08211f6b'
branch_labels = None
depends_on = None


def upgrade():
    # Add status_id column to estimates table (nullable initially for migration)
    op.add_column('estimates',
        sa.Column('status_id', UUID(as_uuid=True), nullable=True)
    )

    # Add foreign key constraint for estimates.status_id
    op.create_foreign_key(
        'fk_estimates_status_id',
        'estimates',
        'estimate_status_configs',
        ['status_id'],
        ['id'],
        ondelete='SET NULL'
    )

    # Create index for estimates.status_id
    op.create_index('ix_estimates_status_id', 'estimates', ['status_id'])

    # Add status_id column to invoices table (nullable initially for migration)
    op.add_column('invoices',
        sa.Column('status_id', UUID(as_uuid=True), nullable=True)
    )

    # Add foreign key constraint for invoices.status_id
    op.create_foreign_key(
        'fk_invoices_status_id',
        'invoices',
        'invoice_status_configs',
        ['status_id'],
        ['id'],
        ondelete='SET NULL'
    )

    # Create index for invoices.status_id
    op.create_index('ix_invoices_status_id', 'invoices', ['status_id'])


def downgrade():
    # Drop index and foreign key for invoices
    op.drop_index('ix_invoices_status_id', 'invoices')
    op.drop_constraint('fk_invoices_status_id', 'invoices', type_='foreignkey')
    op.drop_column('invoices', 'status_id')

    # Drop index and foreign key for estimates
    op.drop_index('ix_estimates_status_id', 'estimates')
    op.drop_constraint('fk_estimates_status_id', 'estimates', type_='foreignkey')
    op.drop_column('estimates', 'status_id')
