"""add_admin_features

Revision ID: add_admin_features
Revises: add_line_item_units
Create Date: 2026-01-28

Adds:
- User profile fields (occupation, business_type, etc.)
- User tracking fields (signup location, login stats)
- LoginLog table for login history
- UserActivity table for activity tracking
"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'add_admin_features'
down_revision = 'add_line_item_units'
branch_labels = None
depends_on = None


def upgrade():
    # ===================
    # Add columns to users table
    # ===================

    # Profile - Occupation
    op.add_column('users', sa.Column(
        'occupation', sa.String(50), nullable=True
    ))
    op.add_column('users', sa.Column(
        'occupation_other', sa.String(100), nullable=True
    ))
    op.add_column('users', sa.Column(
        'business_type', sa.String(50), nullable=True
    ))
    op.add_column('users', sa.Column(
        'years_in_business', sa.Integer(), nullable=True
    ))

    # Marketing - UTM tracking
    op.add_column('users', sa.Column(
        'utm_source', sa.String(100), nullable=True
    ))
    op.add_column('users', sa.Column(
        'utm_medium', sa.String(100), nullable=True
    ))
    op.add_column('users', sa.Column(
        'utm_campaign', sa.String(100), nullable=True
    ))
    op.add_column('users', sa.Column(
        'referral_code', sa.String(50), nullable=True
    ))

    # Signup location
    op.add_column('users', sa.Column(
        'signup_ip', sa.String(45), nullable=True
    ))
    op.add_column('users', sa.Column(
        'signup_city', sa.String(100), nullable=True
    ))
    op.add_column('users', sa.Column(
        'signup_state', sa.String(50), nullable=True
    ))
    op.add_column('users', sa.Column(
        'signup_country', sa.String(50), nullable=True, server_default='US'
    ))

    # Login statistics
    op.add_column('users', sa.Column(
        'login_count', sa.Integer(), nullable=True, server_default='0'
    ))
    op.add_column('users', sa.Column(
        'last_login_ip', sa.String(45), nullable=True
    ))
    op.add_column('users', sa.Column(
        'last_login_city', sa.String(100), nullable=True
    ))
    op.add_column('users', sa.Column(
        'last_login_state', sa.String(50), nullable=True
    ))

    # ===================
    # Create login_logs table
    # ===================
    op.create_table(
        'login_logs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), nullable=False),
        sa.Column(
            'login_at',
            TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False
        ),
        sa.Column('login_method', sa.String(20), nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('city', sa.String(100), nullable=True),
        sa.Column('state', sa.String(50), nullable=True),
        sa.Column('country', sa.String(50), nullable=True),
        sa.Column('user_agent', sa.String(500), nullable=True),
        sa.Column('device_type', sa.String(20), nullable=True),
        sa.Column('browser', sa.String(50), nullable=True),
        sa.Column('os', sa.String(50), nullable=True),
    )

    # Foreign key
    op.create_foreign_key(
        'fk_login_logs_user_id',
        'login_logs',
        'users',
        ['user_id'],
        ['id'],
        ondelete='CASCADE'
    )

    # Index for faster queries
    op.create_index('ix_login_logs_user_id', 'login_logs', ['user_id'])
    op.create_index('ix_login_logs_login_at', 'login_logs', ['login_at'])

    # ===================
    # Create user_activities table
    # ===================
    op.create_table(
        'user_activities',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', UUID(as_uuid=True), nullable=True),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('resource_type', sa.String(50), nullable=True),
        sa.Column('resource_id', UUID(as_uuid=True), nullable=True),
        sa.Column('extra_data', JSONB, nullable=True),
        sa.Column(
            'created_at',
            TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False
        ),
    )

    # Foreign keys
    op.create_foreign_key(
        'fk_user_activities_user_id',
        'user_activities',
        'users',
        ['user_id'],
        ['id'],
        ondelete='CASCADE'
    )
    op.create_foreign_key(
        'fk_user_activities_company_id',
        'user_activities',
        'companies',
        ['company_id'],
        ['id'],
        ondelete='CASCADE'
    )

    # Indexes
    op.create_index('ix_user_activities_user_id', 'user_activities', ['user_id'])
    op.create_index('ix_user_activities_action', 'user_activities', ['action'])
    op.create_index('ix_user_activities_created_at', 'user_activities', ['created_at'])


def downgrade():
    # Drop user_activities table
    op.drop_index('ix_user_activities_created_at', 'user_activities')
    op.drop_index('ix_user_activities_action', 'user_activities')
    op.drop_index('ix_user_activities_user_id', 'user_activities')
    op.drop_constraint('fk_user_activities_company_id', 'user_activities', type_='foreignkey')
    op.drop_constraint('fk_user_activities_user_id', 'user_activities', type_='foreignkey')
    op.drop_table('user_activities')

    # Drop login_logs table
    op.drop_index('ix_login_logs_login_at', 'login_logs')
    op.drop_index('ix_login_logs_user_id', 'login_logs')
    op.drop_constraint('fk_login_logs_user_id', 'login_logs', type_='foreignkey')
    op.drop_table('login_logs')

    # Drop columns from users table
    op.drop_column('users', 'last_login_state')
    op.drop_column('users', 'last_login_city')
    op.drop_column('users', 'last_login_ip')
    op.drop_column('users', 'login_count')
    op.drop_column('users', 'signup_country')
    op.drop_column('users', 'signup_state')
    op.drop_column('users', 'signup_city')
    op.drop_column('users', 'signup_ip')
    op.drop_column('users', 'referral_code')
    op.drop_column('users', 'utm_campaign')
    op.drop_column('users', 'utm_medium')
    op.drop_column('users', 'utm_source')
    op.drop_column('users', 'years_in_business')
    op.drop_column('users', 'business_type')
    op.drop_column('users', 'occupation_other')
    op.drop_column('users', 'occupation')
