"""add_sign_request_cc_bcc

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-08-05

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision = 'b4c5d6e7f8a9'
down_revision = 'a3b4c5d6e7f8'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(bind)
    sign_request_columns = {c['name'] for c in inspector.get_columns('sign_requests')}

    if 'cc_emails' not in sign_request_columns:
        op.add_column(
            'sign_requests',
            sa.Column('cc_emails', JSONB, nullable=False, server_default='[]'),
        )
    if 'bcc_emails' not in sign_request_columns:
        op.add_column(
            'sign_requests',
            sa.Column('bcc_emails', JSONB, nullable=False, server_default='[]'),
        )


def downgrade():
    op.drop_column('sign_requests', 'bcc_emails')
    op.drop_column('sign_requests', 'cc_emails')
