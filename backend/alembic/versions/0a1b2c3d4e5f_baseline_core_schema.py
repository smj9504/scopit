"""baseline_core_schema

Revision ID: 0a1b2c3d4e5f
Revises:
Create Date: 2026-08-07

The original migration that created the app's core tables (companies, users,
customers, line_items, estimates, invoices, etc.) was never committed to this
repo -- the earliest migration on record (892f08211f6b) is an empty no-op
that was nevertheless stamped as the root (down_revision=None), so every
migration after it silently assumed these tables already existed.

That went unnoticed because every environment that ever ran migrations
already had the tables (created out-of-band). The gap only surfaces when
`alembic upgrade head` runs against a genuinely empty database, e.g. a fresh
Render/Neon deploy: it fails immediately on the first ALTER TABLE against a
table that was never CREATEd.

This migration recreates that missing baseline. Columns that a later
migration in this chain adds itself (e.g. estimates.status_id,
invoices.payment_schedule, users.occupation) are intentionally left out here
so that migration can add them as it always has -- this file only contains
the schema as it stood immediately before 892f08211f6b.

Existing databases (which already have all these tables) are unaffected:
alembic only runs migrations after their currently stamped revision, and
none of them are stamped at a revision before this one.
"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = '0a1b2c3d4e5f'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # ---------------------------------------------------------------
    # companies
    # ---------------------------------------------------------------
    op.create_table(
        'companies',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('legal_name', sa.String(255), nullable=True),
        sa.Column('email', sa.String(255), nullable=True),
        sa.Column('phone', sa.String(50), nullable=True),
        sa.Column('website', sa.String(255), nullable=True),
        sa.Column('address_line1', sa.String(255), nullable=True),
        sa.Column('address_line2', sa.String(255), nullable=True),
        sa.Column('city', sa.String(100), nullable=True),
        sa.Column('state', sa.String(50), nullable=True),
        sa.Column('zipcode', sa.String(20), nullable=True),
        sa.Column('country', sa.String(50), nullable=True),
        sa.Column('logo_url', sa.Text(), nullable=True),
        sa.Column('primary_color', sa.String(7), nullable=True),
        sa.Column('default_tax_rate', sa.DECIMAL(5, 3), nullable=True),
        sa.Column('default_tax_label', sa.String(50), nullable=True),
        sa.Column('estimate_prefix', sa.String(10), nullable=True),
        sa.Column('invoice_prefix', sa.String(10), nullable=True),
        sa.Column('next_estimate_number', sa.Integer(), nullable=True),
        sa.Column('next_invoice_number', sa.Integer(), nullable=True),
        sa.Column('default_estimate_validity_days', sa.Integer(), nullable=True),
        sa.Column('default_invoice_due_days', sa.Integer(), nullable=True),
        sa.Column('default_notes', sa.Text(), nullable=True),
        sa.Column('default_terms', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
    )

    # ---------------------------------------------------------------
    # users
    # ---------------------------------------------------------------
    op.create_table(
        'users',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=True),
        sa.Column('google_id', sa.String(255), nullable=True),
        sa.Column('full_name', sa.String(255), nullable=True),
        sa.Column('phone', sa.String(50), nullable=True),
        sa.Column('avatar_url', sa.String(500), nullable=True),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='SET NULL'), nullable=True),
        sa.Column('role', sa.String(50), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('is_superuser', sa.Boolean(), nullable=False),
        sa.Column('is_verified', sa.Boolean(), nullable=False),
        sa.Column('last_login_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)
    op.create_index('ix_users_google_id', 'users', ['google_id'], unique=True)

    # ---------------------------------------------------------------
    # customers
    # ---------------------------------------------------------------
    op.create_table(
        'customers',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('contact_name', sa.String(255), nullable=True),
        sa.Column('email', sa.String(255), nullable=True),
        sa.Column('phone', sa.String(50), nullable=True),
        sa.Column('address_line1', sa.String(255), nullable=True),
        sa.Column('address_line2', sa.String(255), nullable=True),
        sa.Column('city', sa.String(100), nullable=True),
        sa.Column('state', sa.String(50), nullable=True),
        sa.Column('zipcode', sa.String(20), nullable=True),
        sa.Column('country', sa.String(50), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('tags', sa.ARRAY(sa.String(255)), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
    )

    # ---------------------------------------------------------------
    # line_items / line_item_notes
    # ---------------------------------------------------------------
    op.create_table(
        'line_items',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('code', sa.String(50), nullable=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('includes', sa.Text(), nullable=True),
        sa.Column('unit', sa.String(50), nullable=True),
        sa.Column('unit_price', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('cat', sa.String(50), nullable=True),
        sa.Column('is_taxable', sa.Boolean(), nullable=False),
        sa.Column('tax_class', sa.String(50), nullable=True),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('visibility', sa.Enum('company', 'private', name='lineitemvisibility'), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
    )

    op.create_table(
        'line_item_notes',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('line_item_id', UUID(as_uuid=True), sa.ForeignKey('line_items.id', ondelete='CASCADE'), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ---------------------------------------------------------------
    # status / category config tables (referenced by estimates/invoices)
    # ---------------------------------------------------------------
    op.create_table(
        'estimate_status_configs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(50), nullable=False),
        sa.Column('label', sa.String(100), nullable=False),
        sa.Column('color', sa.String(20), nullable=False),
        sa.Column('bg_color', sa.String(20), nullable=False),
        sa.Column('is_default', sa.Boolean(), nullable=False),
        sa.Column('is_system', sa.Boolean(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
    )

    op.create_table(
        'invoice_status_configs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(50), nullable=False),
        sa.Column('label', sa.String(100), nullable=False),
        sa.Column('color', sa.String(20), nullable=False),
        sa.Column('bg_color', sa.String(20), nullable=False),
        sa.Column('is_default', sa.Boolean(), nullable=False),
        sa.Column('is_system', sa.Boolean(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
    )

    op.create_table(
        'line_item_categories',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('color', sa.String(20), nullable=True),
        sa.Column('is_default', sa.Boolean(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
    )

    # ---------------------------------------------------------------
    # estimates (converted_to_invoice_id FK added after invoices exists,
    # since estimates <-> invoices reference each other)
    # ---------------------------------------------------------------
    op.create_table(
        'estimates',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('customer_id', UUID(as_uuid=True), sa.ForeignKey('customers.id', ondelete='SET NULL'), nullable=True),
        sa.Column('estimate_number', sa.String(50), nullable=False),
        sa.Column('status', sa.Enum(
            'draft', 'sent', 'viewed', 'approved', 'declined', 'expired', 'converted',
            name='estimatestatus'), nullable=True),
        sa.Column('estimate_date', sa.Date(), server_default=sa.func.current_date(), nullable=False),
        sa.Column('valid_until', sa.Date(), nullable=True),
        sa.Column('sent_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('viewed_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('approved_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('declined_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('subtotal', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('taxable_subtotal', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('tax_rate', sa.DECIMAL(5, 3), nullable=True),
        sa.Column('tax_label', sa.String(50), nullable=True),
        sa.Column('tax_amount', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('discount_amount', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('total', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('title', sa.String(255), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('terms', sa.Text(), nullable=True),
        sa.Column('customer_name', sa.String(255), nullable=True),
        sa.Column('customer_email', sa.String(255), nullable=True),
        sa.Column('customer_address', sa.Text(), nullable=True),
        sa.Column('converted_to_invoice_id', UUID(as_uuid=True), nullable=True),
        sa.Column('converted_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
    )

    # ---------------------------------------------------------------
    # invoices
    # ---------------------------------------------------------------
    op.create_table(
        'invoices',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('customer_id', UUID(as_uuid=True), sa.ForeignKey('customers.id', ondelete='SET NULL'), nullable=True),
        sa.Column('estimate_id', UUID(as_uuid=True), sa.ForeignKey('estimates.id', ondelete='SET NULL'), nullable=True),
        sa.Column('invoice_number', sa.String(50), nullable=False),
        sa.Column('status', sa.Enum(
            'draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'canceled', 'refunded',
            name='invoicestatus'), nullable=True),
        sa.Column('invoice_date', sa.Date(), server_default=sa.func.current_date(), nullable=False),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column('sent_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('viewed_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('paid_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('subtotal', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('taxable_subtotal', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('tax_rate', sa.DECIMAL(5, 3), nullable=True),
        sa.Column('tax_label', sa.String(50), nullable=True),
        sa.Column('tax_amount', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('discount_amount', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('total', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('amount_paid', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('balance_due', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('title', sa.String(255), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('terms', sa.Text(), nullable=True),
        sa.Column('customer_name', sa.String(255), nullable=True),
        sa.Column('customer_email', sa.String(255), nullable=True),
        sa.Column('customer_address', sa.Text(), nullable=True),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
    )

    # Close the estimates <-> invoices cycle now that both tables exist.
    op.create_foreign_key(
        'fk_estimates_converted_to_invoice_id',
        'estimates',
        'invoices',
        ['converted_to_invoice_id'],
        ['id'],
    )

    # ---------------------------------------------------------------
    # estimate_sections / estimate_items
    # ---------------------------------------------------------------
    op.create_table(
        'estimate_sections',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('estimate_id', UUID(as_uuid=True), sa.ForeignKey('estimates.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('is_collapsed', sa.Boolean(), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'estimate_items',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('estimate_id', UUID(as_uuid=True), sa.ForeignKey('estimates.id', ondelete='CASCADE'), nullable=False),
        sa.Column('section_id', UUID(as_uuid=True), sa.ForeignKey('estimate_sections.id', ondelete='SET NULL'), nullable=True),
        sa.Column('line_item_id', UUID(as_uuid=True), sa.ForeignKey('line_items.id', ondelete='SET NULL'), nullable=True),
        sa.Column('code', sa.String(50), nullable=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('unit', sa.String(50), nullable=True),
        sa.Column('quantity', sa.DECIMAL(15, 4), nullable=False),
        sa.Column('unit_price', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('total', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('is_taxable', sa.Boolean(), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('notes', JSONB, nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ---------------------------------------------------------------
    # invoice_sections / invoice_items / payments
    # ---------------------------------------------------------------
    op.create_table(
        'invoice_sections',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('invoice_id', UUID(as_uuid=True), sa.ForeignKey('invoices.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('is_collapsed', sa.Boolean(), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'invoice_items',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('invoice_id', UUID(as_uuid=True), sa.ForeignKey('invoices.id', ondelete='CASCADE'), nullable=False),
        sa.Column('section_id', UUID(as_uuid=True), sa.ForeignKey('invoice_sections.id', ondelete='SET NULL'), nullable=True),
        sa.Column('line_item_id', UUID(as_uuid=True), sa.ForeignKey('line_items.id', ondelete='SET NULL'), nullable=True),
        sa.Column('code', sa.String(50), nullable=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('unit', sa.String(50), nullable=True),
        sa.Column('quantity', sa.DECIMAL(15, 4), nullable=False),
        sa.Column('unit_price', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('total', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('is_taxable', sa.Boolean(), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('notes', JSONB, nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'payments',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('invoice_id', UUID(as_uuid=True), sa.ForeignKey('invoices.id', ondelete='CASCADE'), nullable=False),
        sa.Column('amount', sa.DECIMAL(15, 2), nullable=False),
        sa.Column('payment_method', sa.Enum(
            'cash', 'check', 'credit_card', 'bank_transfer', 'other',
            name='paymentmethod'), nullable=False),
        sa.Column('payment_date', sa.Date(), nullable=False),
        sa.Column('reference_number', sa.String(100), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('recorded_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ---------------------------------------------------------------
    # tool_sessions / tool_files (generic tool scratch storage)
    # ---------------------------------------------------------------
    op.create_table(
        'tool_sessions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('tool_id', sa.String(50), nullable=False),
        sa.Column('name', sa.String(255), nullable=True),
        sa.Column('data', JSONB, server_default='{}', nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index('ix_tool_sessions_company_id', 'tool_sessions', ['company_id'])
    op.create_index('ix_tool_sessions_tool_id', 'tool_sessions', ['tool_id'])

    op.create_table(
        'tool_files',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('session_id', UUID(as_uuid=True), sa.ForeignKey('tool_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('file_name', sa.String(255), nullable=False),
        sa.Column('file_path', sa.String(500), nullable=False),
        sa.Column('file_type', sa.String(50), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=False),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_tool_files_session_id', 'tool_files', ['session_id'])


def downgrade():
    op.drop_table('tool_files')
    op.drop_table('tool_sessions')
    op.drop_table('payments')
    op.drop_table('invoice_items')
    op.drop_table('invoice_sections')
    op.drop_table('estimate_items')
    op.drop_table('estimate_sections')
    op.drop_constraint('fk_estimates_converted_to_invoice_id', 'estimates', type_='foreignkey')
    op.drop_table('invoices')
    op.drop_table('estimates')
    op.drop_table('line_item_categories')
    op.drop_table('invoice_status_configs')
    op.drop_table('estimate_status_configs')
    op.drop_table('line_item_notes')
    op.drop_table('line_items')
    op.drop_table('customers')
    op.drop_table('users')
    op.drop_table('companies')

    sa.Enum(name='paymentmethod').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='invoicestatus').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='estimatestatus').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='lineitemvisibility').drop(op.get_bind(), checkfirst=True)
