"""
Scopit - Packing Lead Cleanup

Opportunistic garbage collection for expired, unclaimed PackingLead rows.
Called from three places: top of submit(), top of status(), and once at
app startup (see main.py's lifespan). No dedicated cron/scheduler exists
in this codebase, so "opportunistic on request + once at boot" is the
simplest way to bound unclaimed lead storage without adding new infra.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.storage import get_storage
from app.domains.tools.modules.packing.lead_models import PackingLead, PackingLeadStatus

logger = logging.getLogger(__name__)

CLEANUP_BATCH_SIZE = 20


def cleanup_expired_leads(db: Session) -> int:
    """Delete up to CLEANUP_BATCH_SIZE expired, unclaimed leads (and their
    stored photos). Returns the number of rows deleted. Never raises --
    storage failures for individual photos are logged and skipped so one
    bad object never blocks the rest of the batch."""
    expired = (
        db.query(PackingLead)
        .filter(
            PackingLead.status != PackingLeadStatus.CLAIMED.value,
            PackingLead.expires_at < datetime.now(timezone.utc),
        )
        .limit(CLEANUP_BATCH_SIZE)
        .all()
    )
    if not expired:
        return 0

    storage = get_storage()
    deleted = 0
    for lead in expired:
        for room in (lead.rooms_input or []):
            for key in (room.get("photo_keys") or []):
                try:
                    storage.delete(key)
                except Exception:
                    logger.warning(
                        "packing lead cleanup: failed to delete storage key %s", key,
                    )
        db.delete(lead)
        deleted += 1

    db.commit()
    return deleted
