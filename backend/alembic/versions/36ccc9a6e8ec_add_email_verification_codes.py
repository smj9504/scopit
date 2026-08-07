"""add email verification codes

Revision ID: 36ccc9a6e8ec
Revises: 4a7ad1670760
Create Date: 2026-08-04 16:50:31.067632

"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = '36ccc9a6e8ec'
down_revision = '4a7ad1670760'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('email_verification_codes',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('code_hash', sa.String(length=64), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('expires_at', postgresql.TIMESTAMP(timezone=True), nullable=False),
    sa.Column('consumed_at', postgresql.TIMESTAMP(timezone=True), nullable=True),
    sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_email_verification_codes_user_created', 'email_verification_codes', ['user_id', 'created_at'], unique=False)


def downgrade():
    op.drop_index('ix_email_verification_codes_user_created', table_name='email_verification_codes')
    op.drop_table('email_verification_codes')
