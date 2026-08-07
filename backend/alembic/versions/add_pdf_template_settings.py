"""add_pdf_template_settings

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-02-26

"""
import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = 'b2c3d4e5f6g7'
down_revision = 'add_performance_indexes'
branch_labels = None
depends_on = None


def upgrade():
    # Add secondary_color to companies table
    op.add_column('companies',
        sa.Column('secondary_color', sa.String(7), nullable=True)
    )

    # Add default_pdf_template to users table
    # Values: 'classic', 'modern', 'professional'
    op.add_column('users',
        sa.Column('default_pdf_template', sa.String(50), nullable=True, server_default='classic')
    )


def downgrade():
    op.drop_column('users', 'default_pdf_template')
    op.drop_column('companies', 'secondary_color')
