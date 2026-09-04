"""
Parses every raw-SQL statement in the alembic migrations as Postgres.

Migrations run once, at deploy, against Postgres. A statement that is
syntactically fine on another engine but invalid there takes the service down
in a restart loop, because the container's start command is
`alembic upgrade head && uvicorn`. That is exactly what
`MIN(li.created_by)` did: Postgres has no MIN() aggregate for uuid, and a
sqlite-based test of the same logic passed because sqlite typed the column as
TEXT.

These checks are static — they need no database — so they run anywhere.
"""
import re
from pathlib import Path

import pytest

from app.domains.line_item.models import LineItem

sqlglot = pytest.importorskip(
    "sqlglot", reason="sqlglot is needed to parse migration SQL as Postgres"
)
from sqlglot import exp  # noqa: E402  (imported after the skip guard)

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
SQL_TEXT_RE = re.compile(r'sa\.text\("""(.*?)"""\)', re.S)

# Postgres has no aggregate over uuid for these; the value must be cast first.
UUID_UNSAFE_AGGREGATES = (exp.Min, exp.Max, exp.Sum, exp.Avg)

UUID_COLUMNS = {
    c.name for c in LineItem.__table__.columns if "UUID" in str(c.type).upper()
}


def _statements():
    """(migration filename, sql) for every raw SQL statement in the versions dir."""
    for path in sorted(VERSIONS_DIR.glob("*.py")):
        for match in SQL_TEXT_RE.finditer(path.read_text(encoding="utf-8")):
            yield path.name, match.group(1)


def _parse(sql: str):
    """Parse with :name binds replaced, leaving the :: cast operator intact."""
    return sqlglot.parse_one(
        re.sub(r"(?<!:):(?!:)([a-zA-Z_]\w*)", "'X'", sql), dialect="postgres"
    )


def test_migration_sql_parses_as_postgres():
    failures = []
    for filename, sql in _statements():
        try:
            _parse(sql)
        except Exception as exc:  # noqa: BLE001 - report every failure together
            failures.append(f"{filename}: {exc}")
    assert not failures, "invalid Postgres SQL in migrations:\n" + "\n".join(failures)


def test_no_uncast_uuid_aggregate():
    """MIN/MAX/SUM/AVG over a uuid column must cast (e.g. MIN(col::text))."""
    failures = []
    for filename, sql in _statements():
        try:
            tree = _parse(sql)
        except Exception:
            continue  # covered by the parse test above
        for agg in tree.find_all(*UUID_UNSAFE_AGGREGATES):
            if agg.find(exp.Cast):
                continue
            for col in agg.find_all(exp.Column):
                if col.name in UUID_COLUMNS:
                    failures.append(
                        f"{filename}: {agg.key.upper()}({col.sql()}) — Postgres has "
                        f"no {agg.key.upper()}() for uuid; cast to text first"
                    )
    assert not failures, "\n".join(failures)


def test_insert_column_and_value_counts_match():
    failures = []
    for filename, sql in _statements():
        try:
            tree = _parse(sql)
        except Exception:
            continue
        if not isinstance(tree, exp.Insert):
            continue
        columns = tree.this.expressions if tree.this else []
        source = tree.expression
        if isinstance(source, exp.Select) and len(columns) != len(source.expressions):
            failures.append(
                f"{filename}: INSERT lists {len(columns)} columns but selects "
                f"{len(source.expressions)} values"
            )
    assert not failures, "\n".join(failures)
