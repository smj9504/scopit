"""add_unit_prices

Company prices for the Bathroom and Cabinet Estimators, and price books.
Ported from MJ Estimate (its up20261108pb01).

- unit_price_overrides: a company's own figure for one price, material and
  labor apart (NULL on a side follows the default in pricing.py).
- unit_price_changes: every change to those, with who made it.
- price_books: a whole set of prices, frozen. An estimate is pinned to one
  the first time it is calculated (bathroom_estimates / cabinet_estimates
  .price_book_id), so a later default update or company edit doesn't move it.

Every estimate already priced is pinned here to today's default prices, the
ones it was priced with, so the first company edit or default update after
this doesn't reprice it. Estimates never priced stay unpinned and take their
company's prices when first calculated.

Idempotent: the container runs `alembic upgrade head` on every start.

Revision ID: f4c9a2e8b6d3
Revises: e3b7d1f5a9c2
Create Date: 2026-11-08

"""
import hashlib
import json
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = 'f4c9a2e8b6d3'
down_revision = 'e3b7d1f5a9c2'
branch_labels = None
depends_on = None

# estimate table, its line items table, price catalog
_ESTIMATES = (
    ('bathroom_estimates', 'bathroom_estimate_line_items', 'bathroom'),
    ('cabinet_estimates', 'cabinet_estimate_line_items', 'cabinet'),
)


def _default_values(domain: str) -> dict:
    """Today's default prices, as the code that runs this migration has them."""
    from app.domains.unit_prices import catalog

    return {key: [m, lab] for key, (m, lab) in catalog.get_domain(domain).default_values().items()}


def _values_hash(values: dict) -> str:
    # Same as unit_prices.service.values_hash, so the app reuses these books
    canonical = json.dumps(
        {key: [round(float(m), 6), round(float(lab), 6)] for key, (m, lab) in sorted(values.items())},
        separators=(',', ':'), sort_keys=True,
    )
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'price_books' not in tables:
        op.create_table(
            'price_books',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('domain', sa.String(20), nullable=False),
            sa.Column('prices', sa.JSON(), nullable=False),
            sa.Column('values_hash', sa.String(64), nullable=False),
            sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index('ix_price_books_domain_hash', 'price_books', ['domain', 'values_hash'])

    if 'unit_price_overrides' not in tables:
        op.create_table(
            'unit_price_overrides',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
            sa.Column('domain', sa.String(20), nullable=False),
            sa.Column('price_key', sa.String(200), nullable=False),
            sa.Column('material', sa.Float(), nullable=True),
            sa.Column('labor', sa.Float(), nullable=True),
            sa.Column('updated_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.UniqueConstraint('company_id', 'domain', 'price_key', name='uq_unit_price_overrides_key'),
        )
        op.create_index(
            'ix_unit_price_overrides_company_domain', 'unit_price_overrides', ['company_id', 'domain'],
        )

    if 'unit_price_changes' not in tables:
        op.create_table(
            'unit_price_changes',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False),
            sa.Column('domain', sa.String(20), nullable=False),
            sa.Column('price_key', sa.String(200), nullable=False),
            sa.Column('old_material', sa.Float(), nullable=True),
            sa.Column('old_labor', sa.Float(), nullable=True),
            sa.Column('new_material', sa.Float(), nullable=True),
            sa.Column('new_labor', sa.Float(), nullable=True),
            sa.Column('changed_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index(
            'ix_unit_price_changes_company_domain', 'unit_price_changes',
            ['company_id', 'domain', 'created_at'],
        )

    books = sa.table(
        'price_books',
        sa.column('id', UUID(as_uuid=True)),
        sa.column('domain', sa.String()),
        sa.column('prices', sa.JSON()),
        sa.column('values_hash', sa.String()),
    )
    for table, line_items, domain in _ESTIMATES:
        if table not in tables:
            continue
        columns = {c['name'] for c in inspector.get_columns(table)}
        if 'price_book_id' not in columns:
            op.add_column(table, sa.Column(
                'price_book_id', UUID(as_uuid=True),
                sa.ForeignKey('price_books.id', name=f'fk_{table}_price_book_id', ondelete='SET NULL'),
                nullable=True,
            ))

        # Pin what was already priced to the defaults it was priced with
        priced = conn.execute(sa.text(
            f'SELECT COUNT(*) FROM {table} e WHERE e.price_book_id IS NULL '
            f'AND EXISTS (SELECT 1 FROM {line_items} li WHERE li.estimate_id = e.id)'
        )).scalar()
        if not priced:
            continue
        values = _default_values(domain)
        digest = _values_hash(values)
        book_id = conn.execute(
            sa.select(books.c.id).where(books.c.domain == domain, books.c.values_hash == digest)
        ).scalar()
        if book_id is None:
            book_id = uuid.uuid4()
            op.bulk_insert(books, [{'id': book_id, 'domain': domain, 'prices': values, 'values_hash': digest}])
        conn.execute(
            sa.text(
                f'UPDATE {table} SET price_book_id = :book WHERE price_book_id IS NULL '
                f'AND EXISTS (SELECT 1 FROM {line_items} li WHERE li.estimate_id = {table}.id)'
            ).bindparams(sa.bindparam('book', type_=UUID(as_uuid=True))),
            {'book': book_id},
        )


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())
    for table, _line_items, _domain in _ESTIMATES:
        if table in tables and 'price_book_id' in {c['name'] for c in inspector.get_columns(table)}:
            op.drop_constraint(f'fk_{table}_price_book_id', table, type_='foreignkey')
            op.drop_column(table, 'price_book_id')
    for table in ('unit_price_changes', 'unit_price_overrides', 'price_books'):
        if table in tables:
            op.drop_table(table)
