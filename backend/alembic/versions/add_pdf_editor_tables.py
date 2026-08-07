"""add_pdf_editor_tables

Revision ID: b2c3d4e5f6a7
Revises: add_performance_indexes
Create Date: 2026-03-28

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TIMESTAMP, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'b2c3d4e5f6a7'
down_revision = 'd4e5f6g7h8i9'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(bind)
    existing_tables = inspector.get_table_names()

    # ---------------------------------------------------------------
    # pdf_documents
    # ---------------------------------------------------------------
    if 'pdf_documents' not in existing_tables:
        op.create_table(
            'pdf_documents',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('file_path', sa.String(500), nullable=False),
            sa.Column('file_size', sa.Integer, nullable=False),
            sa.Column('page_count', sa.Integer, nullable=False, server_default='1'),
            sa.Column('mime_type', sa.String(100), server_default='application/pdf'),
            sa.Column('source_type', sa.String(50), nullable=False, server_default='upload'),
            sa.Column('source_id', UUID(as_uuid=True), nullable=True),
            sa.Column('annotations', JSONB, server_default='[]'),
            sa.Column('thumbnail_path', sa.String(500), nullable=True),
            sa.Column('is_active', sa.Boolean, server_default='true'),
            sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )

    # ---------------------------------------------------------------
    # sign_requests
    # ---------------------------------------------------------------
    if 'sign_requests' not in existing_tables:
        op.create_table(
            'sign_requests',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('document_id', UUID(as_uuid=True), sa.ForeignKey('pdf_documents.id', ondelete='CASCADE'), nullable=False),
            sa.Column('sent_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('sender_email', sa.String(255), nullable=False),
            sa.Column('sender_name', sa.String(255), nullable=False),
            sa.Column('customer_id', UUID(as_uuid=True), sa.ForeignKey('customers.id', ondelete='SET NULL'), nullable=True),
            sa.Column('recipient_email', sa.String(255), nullable=False),
            sa.Column('recipient_name', sa.String(255), nullable=False),
            sa.Column('sign_fields', JSONB, server_default='[]'),
            sa.Column('email_subject', sa.String(500), nullable=True),
            sa.Column('email_message', sa.Text, nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='draft', index=True),
            sa.Column('access_token', sa.String(255), nullable=False, unique=True, index=True),
            sa.Column('expires_at', TIMESTAMP(timezone=True), nullable=False),
            sa.Column('sent_at', TIMESTAMP(timezone=True), nullable=True),
            sa.Column('viewed_at', TIMESTAMP(timezone=True), nullable=True),
            sa.Column('signed_at', TIMESTAMP(timezone=True), nullable=True),
            sa.Column('declined_at', TIMESTAMP(timezone=True), nullable=True),
            sa.Column('signed_file_path', sa.String(500), nullable=True),
            sa.Column('signature_data', sa.Text, nullable=True),
            sa.Column('signature_type', sa.String(20), nullable=True),
            sa.Column('signature_font', sa.String(100), nullable=True),
            sa.Column('signer_ip', sa.String(45), nullable=True),
            sa.Column('signer_user_agent', sa.String(500), nullable=True),
            sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )

    # ---------------------------------------------------------------
    # sign_audit_events
    # ---------------------------------------------------------------
    if 'sign_audit_events' not in existing_tables:
        op.create_table(
            'sign_audit_events',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('sign_request_id', UUID(as_uuid=True), sa.ForeignKey('sign_requests.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('event_type', sa.String(50), nullable=False),
            sa.Column('actor_email', sa.String(255), nullable=True),
            sa.Column('actor_ip', sa.String(45), nullable=True),
            sa.Column('actor_user_agent', sa.String(500), nullable=True),
            sa.Column('metadata', JSONB, server_default='{}'),
            sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    # ---------------------------------------------------------------
    # company_documents
    # ---------------------------------------------------------------
    if 'company_documents' not in existing_tables:
        op.create_table(
            'company_documents',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('uploaded_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('description', sa.Text, nullable=True),
            sa.Column('file_path', sa.String(500), nullable=False),
            sa.Column('file_size', sa.Integer, nullable=False),
            sa.Column('mime_type', sa.String(100), nullable=False),
            sa.Column('page_count', sa.Integer, server_default='1'),
            sa.Column('thumbnail_path', sa.String(500), nullable=True),
            sa.Column('category', sa.String(100), nullable=True),
            sa.Column('tags', ARRAY(sa.String(100)), server_default='{}'),
            sa.Column('use_count', sa.Integer, server_default='0'),
            sa.Column('last_used_at', TIMESTAMP(timezone=True), nullable=True),
            sa.Column('is_active', sa.Boolean, server_default='true'),
            sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        )


def downgrade():
    op.drop_table('sign_audit_events')
    op.drop_table('sign_requests')
    op.drop_table('pdf_documents')
    op.drop_table('company_documents')
