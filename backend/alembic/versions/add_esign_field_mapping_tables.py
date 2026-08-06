"""add_esign_field_mapping_tables

Revision ID: f7a8b9c0d1e2
Revises: 36ccc9a6e8ec
Create Date: 2026-08-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, JSONB


# revision identifiers, used by Alembic.
revision = 'f7a8b9c0d1e2'
down_revision = '36ccc9a6e8ec'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(bind)
    existing_tables = inspector.get_table_names()

    # ---------------------------------------------------------------
    # pdf_documents: reusable field-mapping template
    # ---------------------------------------------------------------
    pdf_doc_columns = {c['name'] for c in inspector.get_columns('pdf_documents')}
    if 'field_definitions' not in pdf_doc_columns:
        op.add_column(
            'pdf_documents',
            sa.Column('field_definitions', JSONB, server_default='[]'),
        )

    # ---------------------------------------------------------------
    # sign_requests: envelope-level delivery method + prefill snapshot.
    # Legacy singular recipient columns become nullable now that
    # recipients live on sign_recipients.
    # ---------------------------------------------------------------
    sign_request_columns = {c['name']: c for c in inspector.get_columns('sign_requests')}
    if 'delivery_method' not in sign_request_columns:
        op.add_column(
            'sign_requests',
            sa.Column('delivery_method', sa.String(20), nullable=False, server_default='email_request'),
        )
    if 'prefill_data' not in sign_request_columns:
        op.add_column(
            'sign_requests',
            sa.Column('prefill_data', JSONB, server_default='{}'),
        )
    if sign_request_columns.get('recipient_email') and not sign_request_columns['recipient_email'].get('nullable', True):
        op.alter_column('sign_requests', 'recipient_email', nullable=True)
    if sign_request_columns.get('recipient_name') and not sign_request_columns['recipient_name'].get('nullable', True):
        op.alter_column('sign_requests', 'recipient_name', nullable=True)

    # ---------------------------------------------------------------
    # sign_recipients: one row per signer/role on an envelope
    # ---------------------------------------------------------------
    if 'sign_recipients' not in existing_tables:
        op.create_table(
            'sign_recipients',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('sign_request_id', UUID(as_uuid=True), sa.ForeignKey('sign_requests.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('role', sa.String(50), nullable=False),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('email', sa.String(255), nullable=False),
            sa.Column('phone', sa.String(50), nullable=True),
            sa.Column('sequence', sa.Integer, nullable=False, server_default='0'),
            sa.Column('status', sa.String(20), nullable=False, server_default='pending', index=True),
            sa.Column('access_token', sa.String(255), nullable=False, unique=True, index=True),
            sa.Column('viewed_at', TIMESTAMP(timezone=True), nullable=True),
            sa.Column('signed_at', TIMESTAMP(timezone=True), nullable=True),
            sa.Column('declined_at', TIMESTAMP(timezone=True), nullable=True),
            sa.Column('signature_data', sa.Text, nullable=True),
            sa.Column('signature_type', sa.String(20), nullable=True),
            sa.Column('signature_font', sa.String(100), nullable=True),
            sa.Column('signer_ip', sa.String(45), nullable=True),
            sa.Column('signer_user_agent', sa.String(500), nullable=True),
            sa.Column('consent_agreed', sa.Boolean, nullable=False, server_default='false'),
            sa.Column('document_hash', sa.String(64), nullable=True),
            sa.Column('signed_field_values', JSONB, server_default='{}'),
            sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )

    # ---------------------------------------------------------------
    # sign_audit_events: tag events with the acting recipient, if any
    # ---------------------------------------------------------------
    audit_columns = {c['name'] for c in inspector.get_columns('sign_audit_events')}
    if 'recipient_id' not in audit_columns:
        op.add_column(
            'sign_audit_events',
            sa.Column('recipient_id', UUID(as_uuid=True), sa.ForeignKey('sign_recipients.id', ondelete='CASCADE'), nullable=True),
        )
        op.create_index('ix_sign_audit_events_recipient_id', 'sign_audit_events', ['recipient_id'])


def downgrade():
    op.drop_index('ix_sign_audit_events_recipient_id', table_name='sign_audit_events')
    op.drop_column('sign_audit_events', 'recipient_id')
    op.drop_table('sign_recipients')
    op.alter_column('sign_requests', 'recipient_email', nullable=False)
    op.alter_column('sign_requests', 'recipient_name', nullable=False)
    op.drop_column('sign_requests', 'prefill_data')
    op.drop_column('sign_requests', 'delivery_method')
    op.drop_column('pdf_documents', 'field_definitions')
