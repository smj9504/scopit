"""add_token_version_and_ai_usage

users.token_version lets a password change sign the user out of every other
device: tokens carry the version they were issued under and stop working
once it moves on. Existing tokens carry no version and count as 0, which is
the column default, so nobody is signed out by this migration.

ai_usage_events records each batch of rooms sent to the vision model so a
company's daily AI usage can be capped (previously unlimited for any signed-
up account while beta mode grants every tool).

Idempotent: the container runs `alembic upgrade head` on every start.

Revision ID: b7d1e9f3a2c4
Revises: a1c2e3f4b5d6
Create Date: 2026-11-05

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'b7d1e9f3a2c4'
down_revision = 'a1c2e3f4b5d6'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(bind)

    user_columns = {c['name'] for c in inspector.get_columns('users')}
    if 'token_version' not in user_columns:
        op.add_column(
            'users',
            sa.Column('token_version', sa.Integer(), nullable=False, server_default='0'),
        )

    if 'ai_usage_events' not in inspector.get_table_names():
        op.create_table(
            'ai_usage_events',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column(
                'company_id',
                UUID(as_uuid=True),
                sa.ForeignKey('companies.id', ondelete='CASCADE'),
                nullable=False,
            ),
            sa.Column(
                'user_id',
                UUID(as_uuid=True),
                sa.ForeignKey('users.id', ondelete='SET NULL'),
                nullable=True,
            ),
            sa.Column('tool_id', sa.String(50), nullable=False),
            sa.Column('units', sa.Integer(), nullable=False),
            sa.Column(
                'created_at',
                TIMESTAMP(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
        )
        op.create_index(
            'ix_ai_usage_events_company_created',
            'ai_usage_events',
            ['company_id', 'created_at'],
        )


def downgrade():
    op.drop_index('ix_ai_usage_events_company_created', table_name='ai_usage_events')
    op.drop_table('ai_usage_events')
    op.drop_column('users', 'token_version')
