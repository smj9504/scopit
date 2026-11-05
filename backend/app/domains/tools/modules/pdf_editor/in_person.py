"""
Scopit - In-person signing: what a visit asks for

Signing in person skips sending a link. Someone at the company picks the
customer and one or more documents on their own phone or tablet, fills in
what the documents need, and hands the device to the signer. Nothing is saved
until the signer signs. Handing over signs the employee out on the device:
the signer's part runs on a kiosk token that fixes what the company filled in
(see in_person_service.py).

The documents' field mappings say what to ask:
- a field filled from the customer's record is asked with the record's value
  already in, so it can be checked or corrected on the spot;
- a field filled from the company's record is only asked when the record
  doesn't have it;
- "I fill in before sending" and "Signer fills in" fields are asked, except a
  signer's date, which is the day they sign;
- signature and initials lines are signed on the document, never asked.

The same fact on several documents is asked once: a record field by where it
comes from, anything else by its type and label.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Iterable, Optional

from app.domains.tools.modules.pdf_editor.field_registry import (
    AVAILABLE_FIELD_REGISTRY,
    is_valid_source,
)

SIGNATURE_TYPES = ("signature", "initials")

# Matches the signing page's todayFormatted() (en-US, 2-digit month/day)
DATE_FORMAT = "%m/%d/%Y"

# Height (page fraction) at which a text field takes several lines; keep in
# sync with TEXT_MULTILINE_HEIGHT in the frontend's pdf-editor/types.ts
TEXT_MULTILINE_HEIGHT = 0.05

# Questions run the way a visit does: who it's for, then the documents, then
# whatever the company's record is missing
_SOURCE_ORDER = {"customer": 0, "document": 1, "company": 2}

_CHECKED = ("true", "1", "yes", "on", "checked")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _binding(field: dict) -> dict:
    return field.get("data_binding") or {}


def is_signature(field: dict) -> bool:
    return field.get("type") in SIGNATURE_TYPES


def is_signing_date(field: dict) -> bool:
    """A signer's own date field: the day they sign, as on the signing page"""
    return field.get("type") == "date" and _binding(field).get("mode") == "signer_input"


def has_signature_line(fields: Iterable[dict]) -> bool:
    return any(is_signature(f) for f in fields or [])


def reading_order(fields: Iterable[dict]) -> list[dict]:
    """Fields as they're read: page by page, top to bottom, left to right"""
    return sorted(
        fields or [],
        key=lambda f: (f.get("page", 1), round(f.get("y", 0), 3), f.get("x", 0)),
    )


def _source(field: dict) -> Optional[tuple[str, str]]:
    binding = _binding(field)
    if binding.get("mode") != "prefilled":
        return None
    entity, source_field = binding.get("source_entity"), binding.get("source_field")
    return (entity, source_field) if is_valid_source(entity, source_field) else None


def question_key(field: dict) -> Optional[str]:
    """The key a field's value is asked under, or None if it isn't asked"""
    if is_signature(field) or is_signing_date(field):
        return None
    source = _source(field)
    if source:
        return f"{source[0]}.{source[1]}"
    if _binding(field).get("mode") == "prefilled":
        # Bound to something the registry doesn't know: nothing to fill it from
        return None
    label = " ".join(str(field.get("label") or field.get("key") or "").lower().split())
    field_type = field.get("type") or "text"
    if _binding(field).get("mode") == "signer_input":
        # Two signers' "Printed name" are two different answers
        return f"field.{field_type}.{field.get('signer_role') or ''}.{label}"
    return f"field.{field_type}.{label}"


def _registry_label(entity: str, source_field: str) -> Optional[str]:
    for entry in AVAILABLE_FIELD_REGISTRY.get(entity, []):
        if entry["source_field"] == source_field:
            return entry["label"]
    return None


def kind_of(field: dict) -> str:
    """How the answer is entered on a phone"""
    field_type = field.get("type") or "text"
    if field_type in ("checkbox", "date", "number"):
        return field_type
    source = _source(field)
    name = (source[1] if source else str(field.get("label") or "")).lower()
    if "email" in name:
        return "email"
    if "phone" in name:
        return "phone"
    if field_type == "text" and (field.get("height") or 0) >= TEXT_MULTILINE_HEIGHT:
        return "multiline"
    return "text"


def build_questions(
    documents: Iterable[tuple[str, Iterable[dict]]],
    known: dict[str, str],
) -> list[dict]:
    """One question per fact the documents need, with what's on record filled
    in. `documents` is (document name, field definitions) in signing order;
    `known` holds the customer's and company's values by question key."""
    questions: dict[str, dict] = {}
    for doc_name, fields in documents:
        for field in reading_order(fields):
            key = question_key(field)
            if not key:
                continue
            if key in questions:
                question = questions[key]
                question["required"] = question["required"] or bool(field.get("required"))
                if doc_name not in question["documents"]:
                    question["documents"].append(doc_name)
                continue
            source = _source(field)
            entity = source[0] if source else "document"
            value = (known.get(key) or "").strip() if source else ""
            # The company's own details come from its record; only a gap is asked
            if entity == "company" and value:
                continue
            label = field.get("label") or (source and _registry_label(*source)) or key
            signer_input = _binding(field).get("mode") == "signer_input"
            questions[key] = {
                "key": key,
                "label": label,
                "kind": kind_of(field),
                "required": bool(field.get("required")),
                "value": value,
                "source": entity,
                # Whose answer it is, for a signer's own field
                "role": field.get("signer_role") if signer_input else None,
                "documents": [doc_name],
            }
    # sorted() is stable, so the documents' order stands within each source
    return sorted(questions.values(), key=lambda q: _SOURCE_ORDER.get(q["source"], len(_SOURCE_ORDER)))


def clean_answers(answers: Optional[dict], questions: Iterable[dict]) -> dict[str, str]:
    """Only answers to questions that were asked count, so a request can't
    write a value the documents didn't ask for. A question left out keeps
    the value it was asked with."""
    given = answers or {}
    cleaned: dict[str, str] = {}
    for question in questions:
        key = question["key"]
        value = given.get(key, question.get("value"))
        cleaned[key] = str(value).strip() if value is not None else ""
    return cleaned


def handed_over_answers(
    questions: Iterable[dict], fixed: dict, given: Optional[dict]
) -> dict[str, str]:
    """The answers once the device is handed to the signer: what the company
    filled in stays exactly as it was handed over (`fixed`); only a signer's
    own fields ("Signer fills in") may come from the device (`given`)."""
    given = given or {}
    merged: dict[str, str] = {}
    for question in questions:
        key = question["key"]
        if question.get("role") and key in given:
            merged[key] = given[key]
        elif key in fixed:
            merged[key] = fixed[key]
    return merged


def is_checked(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() in _CHECKED


def missing_required(questions: Iterable[dict], answers: dict[str, str]) -> list[str]:
    """Labels of the required questions still without an answer"""
    missing = []
    for question in questions:
        if not question.get("required"):
            continue
        value = answers.get(question["key"], "")
        answered = is_checked(value) if question.get("kind") == "checkbox" else bool(value)
        if not answered:
            missing.append(question["label"])
    return missing


def document_values(
    fields: Iterable[dict],
    answers: dict[str, str],
    known: dict[str, str],
    today: str,
) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    """One document's values: (prefill_data by field key, each signer role's
    own values by field key), as a sent request stores them"""
    prefill: dict[str, str] = {}
    by_role: dict[str, dict[str, str]] = {}
    for field in fields or []:
        if is_signature(field):
            continue
        role = field.get("signer_role")
        if is_signing_date(field):
            if role:
                by_role.setdefault(role, {})[field["key"]] = today
            continue
        key = question_key(field)
        if not key:
            continue
        mode = _binding(field).get("mode")
        if key in answers:
            value = answers[key]
        else:
            # A company value on record was never asked
            value = (known.get(key) or "") if mode == "prefilled" else ""
        if field.get("type") == "checkbox":
            value = "true" if is_checked(value) else ""
        if not value:
            continue
        if mode == "signer_input":
            if role:
                by_role.setdefault(role, {})[field["key"]] = value
        else:
            prefill[field["key"]] = value
    return prefill, by_role


def signer_roles(documents: Iterable[Iterable[dict]]) -> list[dict]:
    """Each signer the documents need, with which marks they make. A signer
    is the same person on every document of the visit, so they sign once."""
    roles: dict[str, dict] = {}
    for fields in documents:
        for field in fields or []:
            role = field.get("signer_role")
            needs_role = is_signature(field) or _binding(field).get("mode") == "signer_input"
            if not role or not needs_role:
                continue
            entry = roles.setdefault(role, {"role": role, "signature": False, "initials": False})
            if field.get("type") == "signature":
                entry["signature"] = True
            elif field.get("type") == "initials":
                entry["initials"] = True
    return sorted(roles.values(), key=lambda r: (_role_number(r["role"]), r["role"]))


def _role_number(role: str) -> int:
    match = re.search(r"(\d+)$", role or "")
    return int(match.group(1)) if match else 10_000


def role_label(role: str) -> str:
    """signer_1 -> Signer 1"""
    return " ".join(part.capitalize() for part in (role or "signer").split("_"))


def signing_day(value: Optional[str]) -> str:
    """The device's date, so an evening signing isn't dated tomorrow (UTC)"""
    try:
        return datetime.strptime((value or "").strip(), DATE_FORMAT).strftime(DATE_FORMAT)
    except ValueError:
        return datetime.utcnow().strftime(DATE_FORMAT)


def clean_email(value: Optional[str]) -> str:
    value = (value or "").strip()
    return value if _EMAIL_RE.match(value) else ""


def strip_data_url(value: Optional[str]) -> str:
    """A mark as a raw base64 PNG, the way signatures are stored"""
    value = (value or "").strip()
    if value.startswith("data:") and "," in value:
        value = value.split(",", 1)[1]
    return value
