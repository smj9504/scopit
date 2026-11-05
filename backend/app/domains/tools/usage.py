"""
Scopit - AI usage quota

Every signed-in account can reach the vision model (beta mode grants all
tools), and each room analysed is a paid API call. This caps how many rooms
one company can send per rolling 24 hours. Usage is recorded in the database
before the call, so restarts don't reset it and a call that crashes midway
still counts.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domains.tools.models import AIUsageEvent
from app.domains.user.models import User

WINDOW = timedelta(hours=24)


def ai_units_used(db: Session, company_id, tool_id: Optional[str] = None) -> int:
    since = datetime.now(timezone.utc) - WINDOW
    query = db.query(func.coalesce(func.sum(AIUsageEvent.units), 0)).filter(
        AIUsageEvent.company_id == company_id,
        AIUsageEvent.created_at >= since,
    )
    if tool_id:
        query = query.filter(AIUsageEvent.tool_id == tool_id)
    return int(query.scalar() or 0)


def reserve_ai_units(db: Session, user: User, tool_id: str, units: int) -> None:
    """Count `units` against the user's company, or raise 429 if over the daily cap.

    Commits the usage row so it survives a failure in the AI call that follows;
    call it before making other changes in the same session.
    """
    if units <= 0:
        return
    if not user.is_superuser:
        limit = settings.AI_VISION_ROOMS_PER_COMPANY_PER_DAY
        # Serialise concurrent reservations for one company so two requests
        # can't both pass the check with the last remaining units.
        db.execute(
            select(func.pg_advisory_xact_lock(func.hashtext(f"ai_usage:{user.company_id}")))
        )
        used = ai_units_used(db, user.company_id)
        if used + units > limit:
            db.rollback()
            remaining = max(limit - used, 0)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Daily photo-analysis limit reached ({limit} rooms per 24 hours; "
                    f"{remaining} left). Please try again later or contact support."
                ),
            )
    db.add(AIUsageEvent(
        company_id=user.company_id,
        user_id=user.id,
        tool_id=tool_id,
        units=units,
    ))
    db.commit()
