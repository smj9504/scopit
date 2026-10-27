"""add_pdf_document_customer_copies

One PDF often has to be filled in or signed once per customer, each result
kept on its own. A customer copy is an ordinary pdf_documents row that
records which customer it belongs to and which document it was copied from,
so a customer's page can list its documents and a document can list the
copies made from it.

Revision ID: a1c2e3f4b5d6
Revises: f6a7b8c9d0e1
Create Date: 2026-10-27

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'a1c2e3f4b5d6'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(bind)
    columns = {c['name'] for c in inspector.get_columns('pdf_documents')}

    if 'customer_id' not in columns:
        op.add_column(
            'pdf_documents',
            sa.Column(
                'customer_id',
                UUID(as_uuid=True),
                sa.ForeignKey('customers.id', ondelete='SET NULL'),
                nullable=True,
            ),
        )
        op.create_index('ix_pdf_documents_customer_id', 'pdf_documents', ['customer_id'])

    if 'template_id' not in columns:
        op.add_column(
            'pdf_documents',
            sa.Column(
                'template_id',
                UUID(as_uuid=True),
                sa.ForeignKey('pdf_documents.id', ondelete='SET NULL'),
                nullable=True,
            ),
        )
        op.create_index('ix_pdf_documents_template_id', 'pdf_documents', ['template_id'])


def downgrade():
    op.drop_index('ix_pdf_documents_template_id', table_name='pdf_documents')
    op.drop_column('pdf_documents', 'template_id')
    op.drop_index('ix_pdf_documents_customer_id', table_name='pdf_documents')
    op.drop_column('pdf_documents', 'customer_id')
