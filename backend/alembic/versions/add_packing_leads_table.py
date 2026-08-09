"""add packing leads table

Revision ID: c7d8e9f0a1b2
Revises: b4c5d6e7f8a9
Create Date: 2026-08-08

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'c7d8e9f0a1b2'
down_revision = 'b4c5d6e7f8a9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'packing_leads',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('token', sa.String(64), nullable=False, unique=True),
        sa.Column('idempotency_key', sa.String(255), nullable=True, unique=True),
        sa.Column('contact_email', sa.String(255), nullable=False),
        sa.Column('contact_phone', sa.String(50), nullable=True),
        sa.Column('company_name', sa.String(255), nullable=True),
        sa.Column('company_phone', sa.String(50), nullable=True),
        sa.Column('company_address', sa.Text, nullable=True),
        sa.Column('property_address', sa.Text, nullable=True),
        sa.Column('rooms_input', JSONB, nullable=False, server_default='[]'),
        sa.Column('ai_result', JSONB, nullable=True),
        sa.Column('status', sa.String(30), nullable=False, server_default='pending_verification'),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.Column('verification_code_hash', sa.String(64), nullable=True),
        sa.Column('verification_attempts', sa.Integer, nullable=False, server_default='0'),
        sa.Column('verification_expires_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('verified_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('analysis_started_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('retry_count', sa.Integer, nullable=False, server_default='0'),
        sa.Column('claimed_by_user_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('claimed_tool_session_id', UUID(as_uuid=True), sa.ForeignKey('tool_sessions.id'), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('expires_at', TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index('ix_packing_leads_token', 'packing_leads', ['token'], unique=True)
    op.create_index('ix_packing_leads_contact_email', 'packing_leads', ['contact_email'])
    op.create_index('ix_packing_leads_status', 'packing_leads', ['status'])


def downgrade():
    op.drop_index('ix_packing_leads_status', table_name='packing_leads')
    op.drop_index('ix_packing_leads_contact_email', table_name='packing_leads')
    op.drop_index('ix_packing_leads_token', table_name='packing_leads')
    op.drop_table('packing_leads')
