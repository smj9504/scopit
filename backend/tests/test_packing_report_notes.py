"""
Tests that the packing report PDF honours the note toggles the export modal
sends, so a report exported with notes switched off never carries them.

Two independent switches feed generate_report_pdf():
  - include_field_notes: the "Include Field Notes" switch -> per-room
    auto-generated handling notes.
  - sections_config["labor_log"]: the "Labor Log" section checkbox -> the
    per-room Labor table, whose second column is the labor note.

Regression: the export modal used to pin include_field_notes to its
mount-time value, so a report exported right after switching the toggle off
still asked for -- and got -- the field notes.

Pure rendering: generate_report_pdf() takes plain dicts and never touches
the database.
"""
import io
import re

import pytest
from pypdf import PdfReader

from app.domains.tools.modules.packing.export import generate_report_pdf

FIELD_NOTE = "ZZUNIQUEFIELDNOTEZZ"
LABOR_NOTE = "QQUNIQUELABORNOTEQQ"
ITEM_NAME = "ZZUNIQUEITEMZZ"

SESSION_DATA = {
    "result": {"grand_total": 100.0, "subtotal": 100.0, "total_rooms": 1},
}

BASE_SECTIONS = {
    "inventory_list": True,
    "damage_photos": False,
    "labor_log": False,
    "room_photos": True,
    "estimate_summary": True,
}


def _rooms():
    return [{
        "room_name": "Living Room",
        "items": [{"name": ITEM_NAME, "category": "Furniture", "quantity": 1}],
        "photos": [],
        "field_notes": [FIELD_NOTE],
        "labor_hours": 3.0,
        "labor_notes": LABOR_NOTE,
    }]


def _pdf_text(pdf_bytes: bytes) -> str:
    """Extract the PDF's visible text, flattened to alphanumerics.

    ReportLab splits a run of text across several show-text operators, so the
    extracted text carries stray spacing and line breaks; stripping everything
    but alphanumerics makes a marker either present or absent, with no
    dependence on where the line wrapped.
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = "".join(page.extract_text() or "" for page in reader.pages)
    return re.sub(r"[^A-Za-z0-9]", "", text)


def _render(*, include_field_notes: bool, labor_log: bool) -> str:
    pdf_bytes = generate_report_pdf(
        session_data=SESSION_DATA,
        rooms_data=_rooms(),
        sections_config=dict(BASE_SECTIONS, labor_log=labor_log),
        include_field_notes=include_field_notes,
    )
    return _pdf_text(pdf_bytes)


def test_text_extraction_sees_rendered_content():
    """Guard the other tests: absence must mean "not rendered", not "not read"."""
    assert ITEM_NAME in _render(include_field_notes=True, labor_log=True)


@pytest.mark.parametrize("labor_log", [False, True])
def test_field_notes_omitted_when_toggled_off(labor_log):
    assert FIELD_NOTE not in _render(include_field_notes=False, labor_log=labor_log)


@pytest.mark.parametrize("labor_log", [False, True])
def test_field_notes_included_when_toggled_on(labor_log):
    assert FIELD_NOTE in _render(include_field_notes=True, labor_log=labor_log)


@pytest.mark.parametrize("include_field_notes", [False, True])
def test_labor_notes_omitted_when_labor_log_off(include_field_notes):
    assert LABOR_NOTE not in _render(
        include_field_notes=include_field_notes, labor_log=False,
    )


@pytest.mark.parametrize("include_field_notes", [False, True])
def test_labor_notes_included_when_labor_log_on(include_field_notes):
    assert LABOR_NOTE in _render(
        include_field_notes=include_field_notes, labor_log=True,
    )
