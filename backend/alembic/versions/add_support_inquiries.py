"""add_support_inquiries

support_inquiries holds the messages users send to the Scopit team from the
in-app Help form. Each one is also emailed to SUPPORT_NOTIFY_EMAIL; the table
keeps them when that email fails and lets the admin console track which are
still open.

Idempotent: the container runs `alembic upgrade head` on every start.

Revision ID: c4f2a8e6d1b3
Revises: b7d1e9f3a2c4
Create Date: 2026-11-05

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'c4f2a8e6d1b3'
down_revision = 'b7d1e9f3a2c4'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(bind)

    if 'support_inquiries' in inspector.get_table_names():
        return

    op.create_table(
        'support_inquiries',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'user_id',
            UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'company_id',
            UUID(as_uuid=True),
            sa.ForeignKey('companies.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('name', sa.String(255), nullable=True),
        sa.Column('category', sa.String(20), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('page_url', sa.String(500), nullable=True),
        sa.Column('user_agent', sa.String(500), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='open'),
        sa.Column(
            'created_at',
            TIMESTAMP(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column('resolved_at', TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index('ix_support_inquiries_user_id', 'support_inquiries', ['user_id'])
    op.create_index('ix_support_inquiries_status', 'support_inquiries', ['status'])
    op.create_index('ix_support_inquiries_created_at', 'support_inquiries', ['created_at'])


def downgrade():
    op.drop_index('ix_support_inquiries_created_at', table_name='support_inquiries')
    op.drop_index('ix_support_inquiries_status', table_name='support_inquiries')
    op.drop_index('ix_support_inquiries_user_id', table_name='support_inquiries')
    op.drop_table('support_inquiries')
