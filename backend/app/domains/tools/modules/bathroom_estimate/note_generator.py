"""
The overview note on a bathroom estimate's PDF: written by Claude from the
estimate's scope when ANTHROPIC_API_KEY is set (settings.BATHROOM_NOTE_MODEL),
from a template otherwise or when the call fails.
"""

import logging

logger = logging.getLogger(__name__)


def generate_overview_note(estimate) -> str:
    """Generate an overview note for the estimate.
    Tries AI generation first, falls back to template.
    """
    try:
        return _generate_ai_note(estimate)
    except Exception as e:
        logger.warning(f"AI note generation failed, using template: {e}")
        return _generate_template_note(estimate)


def ai_available() -> bool:
    """Whether the note is written by Claude (and so counts against the AI allowance)."""
    from app.core.config import settings

    return bool(settings.ANTHROPIC_API_KEY)


def _generate_ai_note(estimate) -> str:
    """Use Claude API to generate a professional overview note."""
    from app.core.config import settings

    if not settings.ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY not set")

    import anthropic  # 30MB+ once loaded, and only this note needs it here
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=60.0, max_retries=1)

    # Build context from estimate
    context = _build_context(estimate)

    extra = {}
    if settings.BATHROOM_NOTE_EFFORT:
        extra["output_config"] = {"effort": settings.BATHROOM_NOTE_EFFORT}
    message = client.messages.create(
        model=settings.BATHROOM_NOTE_MODEL,
        # A note is ~200 words; the rest is room for adaptive thinking
        max_tokens=4096,
        **extra,
        messages=[{
            "role": "user",
            "content": f"""Write a professional bathroom remodel estimate overview note (2-3 paragraphs, max 200 words) for a client-facing document. Be concise and professional.

Project details:
{context}

Requirements:
- Start with "This estimate covers..." or "This proposal outlines..."
- Mention the specific scope of work (what's being replaced/remodeled)
- Note any special considerations (water damage, lead paint, cast iron tub, mold, etc.)
- Mention the finish quality level if applicable
- If subfloor repair is NOT included and floor demo or water damage is involved, add a note that subfloor repair may be required upon demolition at additional cost via change order
- End with a brief note about exclusions (structural changes, HVAC, etc.)
- Use professional contractor language
- Do NOT include pricing or dollar amounts
- Do NOT use bullet points - use flowing prose paragraphs"""
        }]
    )

    if message.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"No usable note (stop_reason={message.stop_reason})")
    # Thinking blocks come first; the note is the text block
    text = next((b.text for b in message.content if b.type == "text"), "").strip()
    if not text:
        raise RuntimeError("Empty note")
    return text


def _generate_template_note(estimate) -> str:
    """Template-based overview note generation (no AI needed)."""
    parts = []

    # Opening
    designation = (estimate.designation or "").replace("_", " ")
    bath_fn = (estimate.bath_function or "full").replace("_", " ")
    address = estimate.property_address or "the subject property"

    scope_items = []
    if estimate.replace_tub:
        tub_spec = estimate.bathtub_spec or {}
        tub_type = (tub_spec.get("type", "alcove")).replace("_", " ")
        tub_mat = (tub_spec.get("material", "acrylic")).replace("_", " ")
        tub_desc = f"{tub_type} bathtub ({tub_mat})"
        if tub_spec.get("surround_tile"):
            tub_desc += " with tiled surround"
        scope_items.append(tub_desc)
    elif getattr(estimate, 'detach_reset_tub', False):
        tub_spec = estimate.bathtub_spec or {}
        tub_type = (tub_spec.get("type", "alcove")).replace("_", " ")
        tub_mat = (tub_spec.get("material", "acrylic")).replace("_", " ")
        tub_desc = f"bathtub D&R ({tub_type}, {tub_mat})"
        if tub_spec.get("surround_tile"):
            tub_desc += " — surround tile replaced"
        scope_items.append(tub_desc)
    if estimate.replace_shower:
        shower_spec = estimate.shower_spec or {}
        s_type = (shower_spec.get("type", "")).replace("_", " ")
        if s_type:
            scope_items.append(f"{s_type} shower")
    if estimate.replace_vanity:
        van = estimate.vanity_spec or {}
        v_width = van.get("width", "")
        scope_items.append(f'{v_width}" vanity' if v_width else "vanity")
    if estimate.replace_toilet:
        scope_items.append("toilet")
    floor_spec = estimate.floor_spec or {}
    if floor_spec.get("material"):
        f_mat = floor_spec["material"].replace("_", " ")
        scope_items.append(f"{f_mat} flooring")

    demo_areas = []
    if estimate.demo_floor:
        demo_areas.append("floor")
    if estimate.demo_walls:
        demo_areas.append("walls")
    if estimate.demo_ceiling:
        demo_areas.append("ceiling")

    room = " ".join(filter(None, [designation, bath_fn]))
    parts.append(
        f"This estimate covers a like-for-like {room} bathroom "
        f"remodel at {address}."
    )

    if scope_items:
        scope_str = ", ".join(scope_items[:-1])
        if len(scope_items) > 1:
            scope_str += f", and {scope_items[-1]}"
        else:
            scope_str = scope_items[0]
        demo_desc = f", with {', '.join(demo_areas)} demolition" if demo_areas else ""
        parts.append(
            f"The scope of work includes replacement of {scope_str}{demo_desc}."
        )

    # Substrate & waterproofing
    sub = estimate.substrate_spec or {}
    wp_type = sub.get("waterproof_type", "none")
    # Backward compat: map old brand names to generic types
    _wp_migrate = {"redgard": "paint_on", "hydroban": "paint_on", "kerdi": "sheet"}
    wp_type = _wp_migrate.get(wp_type, wp_type)
    if wp_type != "none":
        wp_names = {"paint_on": "paint-on", "sheet": "sheet"}
        parts.append(
            f"Wet area substrate will be cement board with {wp_names.get(wp_type, wp_type)} "
            f"waterproofing membrane applied per manufacturer specifications. "
            f"Waterproofing is required per IRC Section R702.4 (water-resistant barriers "
            f"in shower/tub wet areas) and TCNA Handbook standards. "
            f"Failure to install waterproofing membrane voids tile and substrate "
            f"manufacturer warranties and risks moisture intrusion and structural damage."
        )

    # Special considerations
    specials = []
    if estimate.water_damage:
        if getattr(estimate, 'demo_already_done', False):
            specials.append(
                "water-damage tear-out completed by mitigation team; "
                "tile removal remains in the rebuild scope"
            )
        else:
            specials.append(
                "restoration scope (conditions to be verified upon demo)"
            )
    repair_areas = []
    if getattr(estimate, 'repair_drywall_walls', False):
        repair_areas.append("wall drywall")
    if getattr(estimate, 'repair_drywall_ceiling', False):
        repair_areas.append("ceiling drywall")
    if getattr(estimate, 'repair_subfloor', False):
        repair_areas.append("subfloor")
    if getattr(estimate, 'install_insulation_walls', False):
        repair_areas.append("wall insulation")
    if getattr(estimate, 'install_insulation_ceiling', False):
        repair_areas.append("ceiling insulation")
    if repair_areas:
        specials.append(
            f"repair/replacement of {', '.join(repair_areas)}"
        )
    if getattr(estimate, 'demo_cement_board', False):
        cb_sf = getattr(estimate, 'demo_cement_board_sf', 0) or 0
        specials.append(
            f"cement board ({cb_sf:.0f}SF) — partial removal and replacement"
            if cb_sf else
            "cement board requiring partial demo and replacement"
        )
    if estimate.mold_suspected:
        specials.append("moisture conditions identified (separate remediation if required)")
    year = estimate.year_built or 2000
    if year < 1978:
        specials.append(f"lead paint compliance (built {year}, EPA RRP rule applies)")
    if (estimate.bathtub_spec or {}).get("material") == "cast_iron":
        specials.append("cast iron tub removal requiring specialized labor")

    if specials:
        parts.append(
            f"Special considerations include: {'; '.join(specials)}."
        )

    # Accessories
    acc = estimate.accessories_spec or {}
    acc_finish = (acc.get("finish", "")).replace("_", " ")
    acc_grade = acc.get("grade", "")
    if acc_finish:
        parts.append(
            f"All bathroom accessories will be {acc_grade} grade in {acc_finish} finish."
        )

    # Subfloor repair advisory (when not included in estimate)
    has_subfloor_repair = getattr(estimate, 'repair_subfloor', False)
    sub_spec = estimate.substrate_spec or {}
    has_subfloor_in_substrate = sub_spec.get("subfloor_repair", False)
    if not has_subfloor_repair and not has_subfloor_in_substrate and (estimate.demo_floor or estimate.water_damage):
        parts.append(
            "Note: Subfloor repair is not included in this estimate. "
            "Upon demolition, if the subfloor is found to be damaged, "
            "deteriorated, or otherwise compromised, subfloor repair or "
            "replacement may be required at additional cost. A change "
            "order will be issued upon discovery for homeowner/adjuster approval."
        )

    # Exclusions
    parts.append(
        "This estimate excludes structural changes, wall relocation, "
        "HVAC modifications, window or door replacement, and mold "
        "remediation. Any unforeseen conditions discovered during "
        "demolition will be addressed via change order."
    )

    return " ".join(parts)


def _build_context(estimate) -> str:
    """Build context string from estimate for AI prompt."""
    lines = []

    address = estimate.property_address or "N/A"
    lines.append(f"Address: {address}")
    lines.append(f"Building type: {estimate.building_type or 'N/A'}")
    lines.append(f"Year built: {estimate.year_built or 'N/A'}")
    lines.append(f"Bathroom: {estimate.designation or 'N/A'} ({estimate.bath_function or 'full'})")

    if estimate.length_ft and estimate.width_ft:
        lines.append(f"Dimensions: {estimate.length_ft}'x{estimate.width_ft}' (H: {estimate.height_ft or 8}')")

    # Demo scope
    demo_parts = []
    if estimate.demo_floor:
        demo_parts.append("floor")
    if estimate.demo_walls:
        demo_parts.append("walls")
    if estimate.demo_ceiling:
        demo_parts.append("ceiling")
    lines.append(f"Demo areas: {', '.join(demo_parts) or 'none'}")

    # What's being replaced
    replacements = []
    if estimate.replace_tub:
        replacements.append("bathtub")
    elif getattr(estimate, 'detach_reset_tub', False):
        replacements.append("bathtub (D&R)")
    if estimate.replace_shower:
        replacements.append("shower")
    if estimate.replace_vanity:
        replacements.append("vanity")
    if estimate.replace_toilet:
        replacements.append("toilet")
    if (estimate.floor_spec or {}).get("material"):
        replacements.append("flooring")
    lines.append(f"Replacing: {', '.join(replacements) or 'N/A'}")

    # Specs summary
    shower = estimate.shower_spec or {}
    if shower:
        lines.append(f"Shower: type={shower.get('type')}, enclosure={shower.get('enclosure')}, "
                      f"head={shower.get('showerhead_type')}")

    tub = estimate.bathtub_spec or {}
    if tub:
        tub_info = f"Bathtub: type={tub.get('type')}, material={tub.get('material')}"
        if tub.get("surround_tile"):
            tub_info += f", surround_tile={tub.get('surround_tile_sf')}SF {tub.get('surround_tile_material', 'porcelain')}"
        lines.append(tub_info)

    van = estimate.vanity_spec or {}
    if van:
        lines.append(f"Vanity: {van.get('width')}\" {van.get('source')}, top={van.get('top_material')}")

    floor = estimate.floor_spec or {}
    if floor:
        lines.append(f"Floor: {floor.get('material')}, pattern={floor.get('pattern')}")

    # Special conditions
    if estimate.water_damage:
        if getattr(estimate, 'demo_already_done', False):
            lines.append("SCOPE: Restoration — water-damage tear-out done by mitigation team; "
                         "tile removal still in scope")
        else:
            lines.append("SCOPE: Restoration — conditions to be verified upon demo")
    repair_items = []
    if getattr(estimate, 'repair_drywall_walls', False):
        sf = getattr(estimate, 'repair_drywall_walls_sf', 0) or 0
        repair_items.append(f"wall drywall{f' {sf}SF' if sf else ''}")
    if getattr(estimate, 'repair_drywall_ceiling', False):
        sf = getattr(estimate, 'repair_drywall_ceiling_sf', 0) or 0
        repair_items.append(f"ceiling drywall{f' {sf}SF' if sf else ''}")
    if getattr(estimate, 'repair_subfloor', False):
        sf = getattr(estimate, 'repair_subfloor_sf', 0) or 0
        repair_items.append(f"subfloor{f' {sf}SF' if sf else ''}")
    if getattr(estimate, 'install_insulation_walls', False):
        sf = getattr(estimate, 'install_insulation_walls_sf', 0) or 0
        repair_items.append(f"wall insulation{f' {sf}SF' if sf else ''}")
    if getattr(estimate, 'install_insulation_ceiling', False):
        sf = getattr(estimate, 'install_insulation_ceiling_sf', 0) or 0
        repair_items.append(f"ceiling insulation{f' {sf}SF' if sf else ''}")
    if repair_items:
        lines.append(f"REPAIR: {', '.join(repair_items)}")
    if getattr(estimate, 'demo_cement_board', False):
        cb_sf = getattr(estimate, 'demo_cement_board_sf', 0) or 0
        lines.append(f"REPAIR: Cement board — partial removal and replacement {cb_sf}SF")
    # Flag subfloor repair not included
    _has_subfloor = (
        getattr(estimate, 'repair_subfloor', False)
        or (estimate.substrate_spec or {}).get("subfloor_repair", False)
    )
    if not _has_subfloor and (estimate.demo_floor or estimate.water_damage):
        lines.append("IMPORTANT: Subfloor repair is NOT included in this estimate — may be needed upon demo")
    if estimate.mold_suspected:
        lines.append("SCOPE: Moisture conditions identified")
    if (estimate.year_built or 2000) < 1978:
        lines.append("CONDITION: Pre-1978 (lead paint risk)")
    if (estimate.bathtub_spec or {}).get("material") == "cast_iron":
        lines.append("CONDITION: Cast iron tub")

    acc = estimate.accessories_spec or {}
    if acc.get("finish"):
        lines.append(f"Accessories: {acc.get('grade', 'mid')} grade, {acc.get('finish')} finish")

    return "\n".join(lines)
