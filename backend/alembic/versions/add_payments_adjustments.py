"""add_payments_adjustments

Revision ID: f1a2b3c4d5e6
Revises: a1b2c3d4e5f6
Create Date: 2026-02-02

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'add_admin_features'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()

    # Adjustment type enum: don't pre-create it here. The first create_table()
    # below that uses this enum ('estimate_adjustments') creates the Postgres
    # type as a side effect of the CREATE TABLE, and alembic's DDL runner
    # memoizes the type name so the second create_table() ('invoice_adjustments')
    # reusing it won't try to CREATE TYPE a second time.
    adjustment_type_enum = sa.Enum('premium', 'discount', name='adjustmenttype')

    # Payment method enum already exists from payments table, no need to create

    # Add new columns to estimates table (skip if exists)
    from sqlalchemy import inspect
    inspector = inspect(bind)

    estimate_columns = [c['name'] for c in inspector.get_columns('estimates')]
    if 'adjustments_total' not in estimate_columns:
        op.add_column('estimates', sa.Column('adjustments_total', sa.DECIMAL(15, 2), nullable=False, server_default='0'))
    if 'amount_paid' not in estimate_columns:
        op.add_column('estimates', sa.Column('amount_paid', sa.DECIMAL(15, 2), nullable=False, server_default='0'))
    if 'balance_due' not in estimate_columns:
        op.add_column('estimates', sa.Column('balance_due', sa.DECIMAL(15, 2), nullable=False, server_default='0'))

    # Add new column to invoices table (skip if exists)
    invoice_columns = [c['name'] for c in inspector.get_columns('invoices')]
    if 'adjustments_total' not in invoice_columns:
        op.add_column('invoices', sa.Column('adjustments_total', sa.DECIMAL(15, 2), nullable=False, server_default='0'))

    # Get existing tables
    existing_tables = inspector.get_table_names()

    # Reference existing payment method enum
    payment_method_enum = sa.Enum('cash', 'check', 'credit_card', 'bank_transfer', 'other', name='paymentmethod', create_type=False)

    # Create estimate_payments table (if not exists)
    if 'estimate_payments' not in existing_tables:
        op.create_table(
            'estimate_payments',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('estimate_id', UUID(as_uuid=True), sa.ForeignKey('estimates.id', ondelete='CASCADE'), nullable=False),
            sa.Column('amount', sa.DECIMAL(15, 2), nullable=False),
            sa.Column('payment_method', payment_method_enum, nullable=True),
            sa.Column('payment_date', sa.Date, nullable=True),
            sa.Column('reference_number', sa.String(100), nullable=True),
            sa.Column('notes', sa.Text, nullable=True),
            sa.Column('recorded_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
            sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index('ix_estimate_payments_estimate_id', 'estimate_payments', ['estimate_id'])

    # Create estimate_adjustments table (if not exists)
    if 'estimate_adjustments' not in existing_tables:
        op.create_table(
            'estimate_adjustments',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('estimate_id', UUID(as_uuid=True), sa.ForeignKey('estimates.id', ondelete='CASCADE'), nullable=False),
            sa.Column('type', adjustment_type_enum, nullable=False),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('percentage', sa.DECIMAL(5, 2), nullable=False),
            sa.Column('amount', sa.DECIMAL(15, 2), nullable=False, server_default='0'),
            sa.Column('order_index', sa.Integer, nullable=False, server_default='0'),
            sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index('ix_estimate_adjustments_estimate_id', 'estimate_adjustments', ['estimate_id'])

    # Create invoice_adjustments table (if not exists)
    if 'invoice_adjustments' not in existing_tables:
        op.create_table(
            'invoice_adjustments',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('invoice_id', UUID(as_uuid=True), sa.ForeignKey('invoices.id', ondelete='CASCADE'), nullable=False),
            sa.Column('type', adjustment_type_enum, nullable=False),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('percentage', sa.DECIMAL(5, 2), nullable=False),
            sa.Column('amount', sa.DECIMAL(15, 2), nullable=False, server_default='0'),
            sa.Column('order_index', sa.Integer, nullable=False, server_default='0'),
            sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index('ix_invoice_adjustments_invoice_id', 'invoice_adjustments', ['invoice_id'])

    # Make payment_date nullable in payments table
    op.alter_column('payments', 'payment_date', nullable=True)
    op.alter_column('payments', 'payment_method', nullable=True)


def downgrade():
    # Drop tables
    op.drop_index('ix_invoice_adjustments_invoice_id', table_name='invoice_adjustments')
    op.drop_table('invoice_adjustments')

    op.drop_index('ix_estimate_adjustments_estimate_id', table_name='estimate_adjustments')
    op.drop_table('estimate_adjustments')

    op.drop_index('ix_estimate_payments_estimate_id', table_name='estimate_payments')
    op.drop_table('estimate_payments')

    # Drop columns
    op.drop_column('invoices', 'adjustments_total')
    op.drop_column('estimates', 'balance_due')
    op.drop_column('estimates', 'amount_paid')
    op.drop_column('estimates', 'adjustments_total')

    # Drop enums
    sa.Enum(name='adjustmenttype').drop(op.get_bind(), checkfirst=True)

    # Revert payment columns
    op.alter_column('payments', 'payment_date', nullable=False)
    op.alter_column('payments', 'payment_method', nullable=False)
