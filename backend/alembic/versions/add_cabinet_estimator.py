"""add_cabinet_estimator

The Cabinet Estimator tool, ported from MJ Estimate: kitchen cabinet
estimates (cabinet_estimates) with their boxes, calculated line items,
version history and layout sketch, plus the company's product library
(products) its upgrade options are built from.

Idempotent: the container runs `alembic upgrade head` on every start.

Revision ID: d8a3c5e7f9b1
Revises: c4f2a8e6d1b3
Create Date: 2026-11-08

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'd8a3c5e7f9b1'
down_revision = 'c4f2a8e6d1b3'
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect
    tables = set(inspect(op.get_bind()).get_table_names())

    if 'products' not in tables:
        op.create_table(
            'products',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
            sa.Column('created_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('category', sa.String(40), nullable=False),
            sa.Column('title', sa.String(300), nullable=False),
            sa.Column('brand', sa.String(120), nullable=True),
            sa.Column('model_number', sa.String(120), nullable=True),
            sa.Column('sku', sa.String(120), nullable=True),
            sa.Column('finish', sa.String(160), nullable=True),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('retailer', sa.String(40), nullable=False),
            sa.Column('source_url', sa.Text(), nullable=True),
            sa.Column('price', sa.Numeric(10, 2), nullable=True),
            sa.Column('price_unit', sa.String(10), nullable=False),
            sa.Column('box_sf', sa.Float(), nullable=True),
            sa.Column('width_in', sa.Float(), nullable=True),
            sa.Column('depth_in', sa.Float(), nullable=True),
            sa.Column('height_in', sa.Float(), nullable=True),
            sa.Column('tile_width_in', sa.Float(), nullable=True),
            sa.Column('tile_length_in', sa.Float(), nullable=True),
            sa.Column('image_file_ids', sa.JSON(), nullable=False),
            sa.Column('swatch_file_id', sa.String(200), nullable=True),
            sa.Column('look', sa.JSON(), nullable=False),
            sa.Column('specs', sa.JSON(), nullable=False),
            sa.Column('is_archived', sa.Boolean(), nullable=False),
            sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )
        op.create_index('ix_products_company_category', 'products', ['company_id', 'category'])

    if 'cabinet_estimates' not in tables:
        op.create_table(
            'cabinet_estimates',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
            sa.Column('customer_id', UUID(as_uuid=True), sa.ForeignKey('customers.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('scopit_estimate_id', UUID(as_uuid=True), sa.ForeignKey('estimates.id', ondelete='SET NULL'), nullable=True),
            sa.Column('group_id', UUID(as_uuid=True), nullable=True),
            sa.Column('project_type', sa.String(20), nullable=False),
            sa.Column('kind', sa.String(20), nullable=False),
            sa.Column('option_label', sa.String(100), nullable=True),
            sa.Column('option_order', sa.Integer(), nullable=False),
            sa.Column('selections', sa.JSON(), nullable=True),
            sa.Column('status', sa.String(50), nullable=False),
            sa.Column('property_address', sa.String(500), nullable=True),
            sa.Column('zip_code', sa.String(10), nullable=True),
            sa.Column('claim_number', sa.String(100), nullable=True),
            sa.Column('layout_type', sa.String(50), nullable=True),
            sa.Column('kitchen_size_sqft', sa.Float(), nullable=True),
            sa.Column('ceiling_height', sa.Float(), nullable=True),
            sa.Column('has_soffit', sa.Boolean(), nullable=True),
            sa.Column('tier', sa.String(50), nullable=True),
            sa.Column('box_material', sa.String(50), nullable=True),
            sa.Column('finish', sa.String(50), nullable=True),
            sa.Column('door_style', sa.String(50), nullable=True),
            sa.Column('overlay_style', sa.String(50), nullable=True),
            sa.Column('pricing_basis', sa.String(30), nullable=True, server_default='INSURANCE_DR'),
            sa.Column('include_demo', sa.Boolean(), nullable=True),
            sa.Column('include_install', sa.Boolean(), nullable=True),
            sa.Column('include_delivery', sa.Boolean(), nullable=True),
            sa.Column('include_plumbing', sa.Boolean(), nullable=True),
            sa.Column('sink_type', sa.String(20), nullable=True),
            sa.Column('include_aav', sa.Boolean(), nullable=True),
            sa.Column('include_air_gap', sa.Boolean(), nullable=True),
            sa.Column('include_soap_dispenser', sa.Boolean(), nullable=True),
            sa.Column('include_instant_hot', sa.Boolean(), nullable=True),
            sa.Column('include_dw_hookup', sa.Boolean(), nullable=True),
            sa.Column('include_countertop_reset', sa.Boolean(), nullable=True),
            sa.Column('include_hardware', sa.Boolean(), nullable=True),
            sa.Column('include_crown_molding', sa.Boolean(), nullable=True),
            sa.Column('include_backsplash', sa.Boolean(), nullable=True),
            sa.Column('backsplash_type', sa.String(50), nullable=True),
            sa.Column('backsplash_sqft', sa.Float(), nullable=True),
            sa.Column('include_toe_kick', sa.Boolean(), nullable=True),
            sa.Column('include_quarter_round', sa.Boolean(), nullable=True),
            sa.Column('include_countertop', sa.Boolean(), nullable=True),
            sa.Column('include_drywall_repair', sa.Boolean(), nullable=True),
            sa.Column('drywall_repair_type', sa.String(20), nullable=True),
            sa.Column('drywall_repair_sqft', sa.Float(), nullable=True),
            sa.Column('include_painting', sa.Boolean(), nullable=True),
            sa.Column('painting_sqft', sa.Float(), nullable=True),
            sa.Column('include_appliance_rr', sa.Boolean(), nullable=True),
            sa.Column('appliance_list', sa.JSON(), nullable=True),
            sa.Column('include_dumpster', sa.Boolean(), nullable=True),
            sa.Column('include_electrical', sa.Boolean(), nullable=True),
            sa.Column('include_permit', sa.Boolean(), nullable=True),
            sa.Column('filler_count', sa.Integer(), nullable=True),
            sa.Column('angled_joint_count', sa.Integer(), nullable=True),
            sa.Column('island_seating_overhang_in', sa.Float(), nullable=True),
            sa.Column('countertop_support_count', sa.Integer(), nullable=True),
            sa.Column('end_panel_counts', sa.JSON(), nullable=True),
            sa.Column('dishwasher_return_panel_count', sa.Integer(), nullable=True),
            sa.Column('include_light_rail', sa.Boolean(), nullable=True),
            sa.Column('light_rail_lf', sa.Float(), nullable=True),
            sa.Column('outlet_relocation_count', sa.Integer(), nullable=True),
            sa.Column('delivery_floor', sa.Integer(), nullable=True),
            sa.Column('island_type', sa.String(20), nullable=False),
            sa.Column('island_prefab_size', sa.String(20), nullable=True),
            sa.Column('island_prefab_price', sa.Float(), nullable=True),
            sa.Column('island_end_panel_sqft', sa.Float(), nullable=True),
            sa.Column('island_back_panel_sqft', sa.Float(), nullable=True),
            sa.Column('island_two_sided', sa.Boolean(), nullable=True),
            sa.Column('countertop_material', sa.String(100), nullable=True),
            sa.Column('countertop_sqft', sa.Float(), nullable=True),
            sa.Column('include_countertop_backsplash', sa.Boolean(), nullable=True),
            sa.Column('countertop_backsplash_lf', sa.Float(), nullable=True),
            sa.Column('island_countertop_material', sa.String(100), nullable=True),
            sa.Column('island_countertop_sqft', sa.Float(), nullable=True),
            sa.Column('overview_text', sa.Text(), nullable=True),
            sa.Column('target_total', sa.Float(), nullable=True),
            sa.Column('subtotal', sa.Float(), nullable=True),
            sa.Column('overhead_pct', sa.Float(), nullable=True),
            sa.Column('overhead_amount', sa.Float(), nullable=True),
            sa.Column('profit_pct', sa.Float(), nullable=True),
            sa.Column('profit_amount', sa.Float(), nullable=True),
            sa.Column('adjustment_factor', sa.Float(), nullable=True),
            sa.Column('total', sa.Float(), nullable=True),
            sa.Column('methodology_notes', sa.Text(), nullable=True),
            sa.Column('warning_flags', JSONB(), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )
        op.create_index('ix_cabinet_estimates_group_id', 'cabinet_estimates', ['group_id'])
        op.create_index('ix_cabinet_estimates_company_id', 'cabinet_estimates', ['company_id'])
        op.create_index('ix_cabinet_estimates_customer_id', 'cabinet_estimates', ['customer_id'])

    if 'cabinet_boxes' not in tables:
        op.create_table(
            'cabinet_boxes',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('estimate_id', UUID(as_uuid=True), sa.ForeignKey('cabinet_estimates.id', ondelete='CASCADE'), nullable=False),
            sa.Column('code', sa.String(20), nullable=False),
            sa.Column('cab_type', sa.String(20), nullable=False),
            sa.Column('location', sa.String(20), nullable=False),
            sa.Column('width_inches', sa.Integer(), nullable=False),
            sa.Column('height_inches', sa.Float(), nullable=False),
            sa.Column('is_specialty', sa.Boolean(), nullable=True),
            sa.Column('specialty_type', sa.String(50), nullable=True),
            sa.Column('has_glass_door', sa.Boolean(), nullable=True),
            sa.Column('range_panel_count', sa.Integer(), nullable=True),
            sa.Column('door_pattern', sa.String(30), nullable=True),
            sa.Column('qty', sa.Integer(), nullable=False),
            sa.Column('display_order', sa.Integer(), nullable=True),
            sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )
        op.create_index('ix_cabinet_boxes_estimate_id', 'cabinet_boxes', ['estimate_id'])

    if 'cabinet_estimate_line_items' not in tables:
        op.create_table(
            'cabinet_estimate_line_items',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('estimate_id', UUID(as_uuid=True), sa.ForeignKey('cabinet_estimates.id', ondelete='CASCADE'), nullable=False),
            sa.Column('description', sa.String(500), nullable=False),
            sa.Column('quantity', sa.Float(), nullable=False),
            sa.Column('unit', sa.String(10), nullable=False),
            sa.Column('unit_price', sa.Float(), nullable=False),
            sa.Column('total', sa.Float(), nullable=False),
            sa.Column('material_unit_price', sa.Float(), nullable=True),
            sa.Column('labor_unit_price', sa.Float(), nullable=True),
            sa.Column('material_total', sa.Float(), nullable=True),
            sa.Column('labor_total', sa.Float(), nullable=True),
            sa.Column('category', sa.String(50), nullable=True),
            sa.Column('location', sa.String(20), nullable=False),
            sa.Column('notes', sa.String(500), nullable=True),
            sa.Column('display_order', sa.Integer(), nullable=True),
            sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )
        op.create_index('ix_cabinet_line_items_estimate_id', 'cabinet_estimate_line_items', ['estimate_id'])

    if 'cabinet_estimate_history' not in tables:
        op.create_table(
            'cabinet_estimate_history',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('estimate_id', UUID(as_uuid=True), sa.ForeignKey('cabinet_estimates.id', ondelete='CASCADE'), nullable=False),
            sa.Column('version_number', sa.Integer(), nullable=False),
            sa.Column('snapshot_data', JSONB(), nullable=False),
            sa.Column('changed_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('change_description', sa.String(500), nullable=True),
            sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )
        op.create_index('ix_cabinet_history_estimate_id', 'cabinet_estimate_history', ['estimate_id'])

    if 'cabinet_sketches' not in tables:
        op.create_table(
            'cabinet_sketches',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('estimate_id', UUID(as_uuid=True), sa.ForeignKey('cabinet_estimates.id', ondelete='CASCADE'), nullable=False),
            sa.Column('canvas_width', sa.Integer(), nullable=False),
            sa.Column('canvas_height', sa.Integer(), nullable=False),
            sa.Column('scale_pixels_per_foot', sa.Float(), nullable=False),
            sa.Column('overlay_data', JSONB(), nullable=False),
            sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )
        op.create_index('ix_cabinet_sketches_estimate_id', 'cabinet_sketches', ['estimate_id'], unique=True)


def downgrade():
    for table in (
        'cabinet_sketches',
        'cabinet_estimate_history',
        'cabinet_estimate_line_items',
        'cabinet_boxes',
        'cabinet_estimates',
        'products',
    ):
        op.execute(f'DROP TABLE IF EXISTS {table}')
