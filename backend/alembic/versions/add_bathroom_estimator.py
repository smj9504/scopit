"""add_bathroom_estimator

The Bathroom Estimator tool, ported from MJ Estimate: bathroom estimates
(bathroom_estimates) with their calculated line items and version history.
The layout sketch lives on the estimate (sketch_data). Its upgrade options
use the product library added with the Cabinet Estimator.

Idempotent: the container runs `alembic upgrade head` on every start.

Revision ID: e3b7d1f5a9c2
Revises: d8a3c5e7f9b1
Create Date: 2026-11-08

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'e3b7d1f5a9c2'
down_revision = 'd8a3c5e7f9b1'
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect
    tables = set(inspect(op.get_bind()).get_table_names())

    if 'bathroom_estimates' not in tables:
        op.create_table(
            'bathroom_estimates',
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
            sa.Column('status', sa.String(50), nullable=False),
            sa.Column('property_address', sa.String(500), nullable=True),
            sa.Column('city', sa.String(100), nullable=True),
            sa.Column('state', sa.String(5), nullable=True),
            sa.Column('zip_code', sa.String(10), nullable=True),
            sa.Column('building_type', sa.String(50), nullable=True),
            sa.Column('year_built', sa.Integer(), nullable=True),
            sa.Column('claim_number', sa.String(100), nullable=True),
            sa.Column('designation', sa.String(50), nullable=True),
            sa.Column('bath_function', sa.String(50), nullable=True),
            sa.Column('length_ft', sa.Float(), nullable=True),
            sa.Column('width_ft', sa.Float(), nullable=True),
            sa.Column('height_ft', sa.Float(), nullable=True),
            sa.Column('floor_sf', sa.Float(), nullable=True),
            sa.Column('wall_sf', sa.Float(), nullable=True),
            sa.Column('demo_scope', sa.String(50), nullable=True),
            sa.Column('demo_floor', sa.Boolean(), nullable=True),
            sa.Column('demo_floor_sf', sa.Float(), nullable=True),
            sa.Column('demo_walls', sa.Boolean(), nullable=True),
            sa.Column('demo_wall_sf', sa.Float(), nullable=True),
            sa.Column('demo_ceiling', sa.Boolean(), nullable=True),
            sa.Column('demo_ceiling_sf', sa.Float(), nullable=True),
            sa.Column('replace_shower', sa.Boolean(), nullable=True),
            sa.Column('replace_tub', sa.Boolean(), nullable=True),
            sa.Column('replace_vanity', sa.Boolean(), nullable=True),
            sa.Column('replace_toilet', sa.Boolean(), nullable=True),
            sa.Column('replace_floor', sa.Boolean(), nullable=True),
            sa.Column('detach_reset_shower', sa.Boolean(), nullable=True),
            sa.Column('detach_reset_tub', sa.Boolean(), nullable=True),
            sa.Column('detach_reset_vanity', sa.Boolean(), nullable=True),
            sa.Column('detach_reset_toilet', sa.Boolean(), nullable=True),
            sa.Column('replace_mirror', sa.Boolean(), nullable=True),
            sa.Column('detach_reset_mirror', sa.Boolean(), nullable=True),
            sa.Column('replace_vanity_light', sa.Boolean(), nullable=True),
            sa.Column('detach_reset_vanity_light', sa.Boolean(), nullable=True),
            sa.Column('water_damage', sa.Boolean(), nullable=True),
            sa.Column('water_damage_source', sa.String(100), nullable=True),
            sa.Column('mold_suspected', sa.Boolean(), nullable=True),
            sa.Column('existing_tub_material', sa.String(50), nullable=True),
            sa.Column('demo_already_done', sa.Boolean(), nullable=True),
            sa.Column('repair_drywall_walls', sa.Boolean(), nullable=True),
            sa.Column('repair_drywall_walls_sf', sa.Float(), nullable=True),
            sa.Column('repair_drywall_ceiling', sa.Boolean(), nullable=True),
            sa.Column('repair_drywall_ceiling_sf', sa.Float(), nullable=True),
            sa.Column('repair_subfloor', sa.Boolean(), nullable=True),
            sa.Column('repair_subfloor_sf', sa.Float(), nullable=True),
            sa.Column('demo_cement_board', sa.Boolean(), nullable=True),
            sa.Column('demo_cement_board_sf', sa.Float(), nullable=True),
            sa.Column('replace_cement_board', sa.Boolean(), nullable=True),
            sa.Column('replace_cement_board_sf', sa.Float(), nullable=True),
            sa.Column('demo_insulation_walls', sa.Boolean(), nullable=True),
            sa.Column('demo_insulation_walls_sf', sa.Float(), nullable=True),
            sa.Column('demo_insulation_ceiling', sa.Boolean(), nullable=True),
            sa.Column('demo_insulation_ceiling_sf', sa.Float(), nullable=True),
            sa.Column('install_insulation_walls', sa.Boolean(), nullable=True),
            sa.Column('install_insulation_walls_sf', sa.Float(), nullable=True),
            sa.Column('install_insulation_ceiling', sa.Boolean(), nullable=True),
            sa.Column('install_insulation_ceiling_sf', sa.Float(), nullable=True),
            sa.Column('shower_spec', JSONB(), nullable=True),
            sa.Column('bathtub_spec', JSONB(), nullable=True),
            sa.Column('vanity_spec', JSONB(), nullable=True),
            sa.Column('toilet_spec', JSONB(), nullable=True),
            sa.Column('floor_spec', JSONB(), nullable=True),
            sa.Column('walls_spec', JSONB(), nullable=True),
            sa.Column('accessories_spec', JSONB(), nullable=True),
            sa.Column('plumbing_spec', JSONB(), nullable=True),
            sa.Column('electrical_spec', JSONB(), nullable=True),
            sa.Column('substrate_spec', JSONB(), nullable=True),
            sa.Column('hidden_costs', JSONB(), nullable=True),
            sa.Column('overview_text', sa.String(None), nullable=True),
            sa.Column('include_overhead_profit', sa.Boolean(), nullable=True),
            sa.Column('overhead_pct', sa.Float(), nullable=True),
            sa.Column('profit_pct', sa.Float(), nullable=True),
            sa.Column('target_total', sa.Float(), nullable=True),
            sa.Column('adjustment_factor', sa.Float(), nullable=True),
            sa.Column('subtotal', sa.Float(), nullable=True),
            sa.Column('overhead_amount', sa.Float(), nullable=True),
            sa.Column('profit_amount', sa.Float(), nullable=True),
            sa.Column('tax_amount', sa.Float(), nullable=True),
            sa.Column('total', sa.Float(), nullable=True),
            sa.Column('sketch_data', JSONB(), nullable=True),
            sa.Column('selections', JSONB(), nullable=True),
            sa.Column('methodology_notes', sa.String(None), nullable=True),
            sa.Column('warning_flags', JSONB(), nullable=True),
            sa.Column('notes', sa.String(None), nullable=True),
            sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )
        op.create_index('ix_bathroom_estimates_customer_id', 'bathroom_estimates', ['customer_id'])
        op.create_index('ix_bathroom_estimates_group_id', 'bathroom_estimates', ['group_id'])
        op.create_index('ix_bathroom_estimates_company_id', 'bathroom_estimates', ['company_id'])

    if 'bathroom_estimate_line_items' not in tables:
        op.create_table(
            'bathroom_estimate_line_items',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('estimate_id', UUID(as_uuid=True), sa.ForeignKey('bathroom_estimates.id', ondelete='CASCADE'), nullable=False),
            sa.Column('phase', sa.Integer(), nullable=False),
            sa.Column('description', sa.String(500), nullable=False),
            sa.Column('quantity', sa.Float(), nullable=False),
            sa.Column('unit', sa.String(10), nullable=False),
            sa.Column('unit_price', sa.Float(), nullable=False),
            sa.Column('total', sa.Float(), nullable=False),
            sa.Column('category', sa.String(50), nullable=True),
            sa.Column('notes', sa.String(500), nullable=True),
            sa.Column('display_order', sa.Integer(), nullable=True),
            sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )
        op.create_index('ix_bath_line_items_estimate_id', 'bathroom_estimate_line_items', ['estimate_id'])

    if 'bathroom_estimate_history' not in tables:
        op.create_table(
            'bathroom_estimate_history',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('estimate_id', UUID(as_uuid=True), sa.ForeignKey('bathroom_estimates.id', ondelete='CASCADE'), nullable=False),
            sa.Column('version_number', sa.Integer(), nullable=False),
            sa.Column('snapshot_data', JSONB(), nullable=False),
            sa.Column('changed_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('change_description', sa.String(500), nullable=True),
            sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )
        op.create_index('ix_bath_history_estimate_id', 'bathroom_estimate_history', ['estimate_id'])


def downgrade():
    op.drop_table('bathroom_estimate_history')
    op.drop_table('bathroom_estimate_line_items')
    op.drop_table('bathroom_estimates')
