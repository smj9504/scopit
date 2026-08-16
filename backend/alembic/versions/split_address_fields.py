"""split address fields into structured columns

Revision ID: d3e4f5a6b7c8
Revises: d8e9f0a1b2c3
Create Date: 2026-08-16

"""
import sqlalchemy as sa

from alembic import op

revision = 'd3e4f5a6b7c8'
down_revision = 'd8e9f0a1b2c3'
branch_labels = None
depends_on = None


def upgrade():
    # -- estimates --
    op.add_column('estimates', sa.Column('customer_address_line1', sa.Text(), nullable=True))
    op.add_column('estimates', sa.Column('customer_address_line2', sa.String(255), nullable=True))
    op.add_column('estimates', sa.Column('customer_city', sa.String(100), nullable=True))
    op.add_column('estimates', sa.Column('customer_state', sa.String(50), nullable=True))
    op.add_column('estimates', sa.Column('customer_zipcode', sa.String(20), nullable=True))
    op.execute("UPDATE estimates SET customer_address_line1 = customer_address WHERE customer_address IS NOT NULL")
    op.drop_column('estimates', 'customer_address')

    # -- invoices --
    op.add_column('invoices', sa.Column('customer_address_line1', sa.Text(), nullable=True))
    op.add_column('invoices', sa.Column('customer_address_line2', sa.String(255), nullable=True))
    op.add_column('invoices', sa.Column('customer_city', sa.String(100), nullable=True))
    op.add_column('invoices', sa.Column('customer_state', sa.String(50), nullable=True))
    op.add_column('invoices', sa.Column('customer_zipcode', sa.String(20), nullable=True))
    op.execute("UPDATE invoices SET customer_address_line1 = customer_address WHERE customer_address IS NOT NULL")
    op.drop_column('invoices', 'customer_address')

    # -- packing_leads --
    op.add_column('packing_leads', sa.Column('company_address_line1', sa.Text(), nullable=True))
    op.add_column('packing_leads', sa.Column('company_address_line2', sa.String(255), nullable=True))
    op.add_column('packing_leads', sa.Column('company_city', sa.String(100), nullable=True))
    op.add_column('packing_leads', sa.Column('company_state', sa.String(50), nullable=True))
    op.add_column('packing_leads', sa.Column('company_zipcode', sa.String(20), nullable=True))
    op.add_column('packing_leads', sa.Column('property_address_line1', sa.Text(), nullable=True))
    op.add_column('packing_leads', sa.Column('property_address_line2', sa.String(255), nullable=True))
    op.add_column('packing_leads', sa.Column('property_city', sa.String(100), nullable=True))
    op.add_column('packing_leads', sa.Column('property_state', sa.String(50), nullable=True))
    op.add_column('packing_leads', sa.Column('property_zipcode', sa.String(20), nullable=True))
    op.execute("UPDATE packing_leads SET company_address_line1 = company_address WHERE company_address IS NOT NULL")
    op.execute("UPDATE packing_leads SET property_address_line1 = property_address WHERE property_address IS NOT NULL")
    op.drop_column('packing_leads', 'company_address')
    op.drop_column('packing_leads', 'property_address')


def downgrade():
    # -- packing_leads --
    op.add_column('packing_leads', sa.Column('property_address', sa.Text(), nullable=True))
    op.add_column('packing_leads', sa.Column('company_address', sa.Text(), nullable=True))
    op.execute("UPDATE packing_leads SET property_address = property_address_line1 WHERE property_address_line1 IS NOT NULL")
    op.execute("UPDATE packing_leads SET company_address = company_address_line1 WHERE company_address_line1 IS NOT NULL")
    op.drop_column('packing_leads', 'property_zipcode')
    op.drop_column('packing_leads', 'property_state')
    op.drop_column('packing_leads', 'property_city')
    op.drop_column('packing_leads', 'property_address_line2')
    op.drop_column('packing_leads', 'property_address_line1')
    op.drop_column('packing_leads', 'company_zipcode')
    op.drop_column('packing_leads', 'company_state')
    op.drop_column('packing_leads', 'company_city')
    op.drop_column('packing_leads', 'company_address_line2')
    op.drop_column('packing_leads', 'company_address_line1')

    # -- invoices --
    op.add_column('invoices', sa.Column('customer_address', sa.Text(), nullable=True))
    op.execute("UPDATE invoices SET customer_address = customer_address_line1 WHERE customer_address_line1 IS NOT NULL")
    op.drop_column('invoices', 'customer_zipcode')
    op.drop_column('invoices', 'customer_state')
    op.drop_column('invoices', 'customer_city')
    op.drop_column('invoices', 'customer_address_line2')
    op.drop_column('invoices', 'customer_address_line1')

    # -- estimates --
    op.add_column('estimates', sa.Column('customer_address', sa.Text(), nullable=True))
    op.execute("UPDATE estimates SET customer_address = customer_address_line1 WHERE customer_address_line1 IS NOT NULL")
    op.drop_column('estimates', 'customer_zipcode')
    op.drop_column('estimates', 'customer_state')
    op.drop_column('estimates', 'customer_city')
    op.drop_column('estimates', 'customer_address_line2')
    op.drop_column('estimates', 'customer_address_line1')
