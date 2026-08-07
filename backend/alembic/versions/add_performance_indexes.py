"""add_performance_indexes

Revision ID: add_performance_indexes
Revises: f1a2b3c4d5e6
Create Date: 2026-02-26

Adds database indexes for frequently filtered columns:
- estimates.status (single)
- estimates.company_id + status (composite)
- invoices.status (single)
- invoices.company_id + status (composite)
- customers.is_active (single)
- customers.company_id + is_active (composite)
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'add_performance_indexes'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    # ===================
    # Estimates indexes
    # ===================
    op.create_index(
        'ix_estimates_status',
        'estimates',
        ['status']
    )
    op.create_index(
        'ix_estimates_company_status',
        'estimates',
        ['company_id', 'status']
    )
    op.create_index(
        'ix_estimates_company_created',
        'estimates',
        ['company_id', 'created_at']
    )

    # ===================
    # Invoices indexes
    # ===================
    op.create_index(
        'ix_invoices_status',
        'invoices',
        ['status']
    )
    op.create_index(
        'ix_invoices_company_status',
        'invoices',
        ['company_id', 'status']
    )
    op.create_index(
        'ix_invoices_company_created',
        'invoices',
        ['company_id', 'created_at']
    )

    # ===================
    # Customers indexes
    # ===================
    op.create_index(
        'ix_customers_is_active',
        'customers',
        ['is_active']
    )
    op.create_index(
        'ix_customers_company_active',
        'customers',
        ['company_id', 'is_active']
    )


def downgrade():
    # Drop customers indexes
    op.drop_index('ix_customers_company_active', 'customers')
    op.drop_index('ix_customers_is_active', 'customers')

    # Drop invoices indexes
    op.drop_index('ix_invoices_company_created', 'invoices')
    op.drop_index('ix_invoices_company_status', 'invoices')
    op.drop_index('ix_invoices_status', 'invoices')

    # Drop estimates indexes
    op.drop_index('ix_estimates_company_created', 'estimates')
    op.drop_index('ix_estimates_company_status', 'estimates')
    op.drop_index('ix_estimates_status', 'estimates')
