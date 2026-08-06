"""
ScopeIt - Tools Service
"""
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List, Optional
from dataclasses import asdict

from app.core.config import settings
from app.domains.user.models import User
from app.domains.tools.models import ToolSession, ToolFile
from app.domains.tools.registry import get_tool, get_all_tools, ToolDefinition
from app.common.exceptions import NotFoundException, ForbiddenException


class ToolAccessService:
    """Determines whether a user/company can access a given tool."""

    def __init__(self, db: Session):
        self.db = db

    def can_access_tool(self, tool_id: str, user: User) -> bool:
        tool = get_tool(tool_id)
        if not tool or not tool.is_active:
            return False

        if settings.BETA_MODE:
            return True

        company_plan = self._get_company_plan(user.company_id)
        return self._plan_allows_tool(company_plan, tool.required_plan)

    def _get_company_plan(self, company_id: UUID) -> str:
        # TODO: Replace with real subscription lookup when Phase 2 is complete
        return "free"

    def _plan_allows_tool(self, company_plan: str, required_plan: str) -> bool:
        plan_hierarchy = {"free": 0, "pro": 1, "enterprise": 2}
        return plan_hierarchy.get(company_plan, 0) >= plan_hierarchy.get(required_plan, 0)

    def get_all_tools_with_access(self, user: User) -> List[dict]:
        """Return all tools with has_access flag for frontend display."""
        all_tools = get_all_tools(active_only=True)
        return [
            {
                **asdict(t),
                "has_access": self.can_access_tool(t.id, user),
            }
            for t in all_tools
        ]


class ToolSessionService:
    """Manages tool session CRUD."""

    def __init__(self, db: Session):
        self.db = db

    def get_sessions(
        self,
        company_id: UUID,
        tool_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 20,
    ) -> List[ToolSession]:
        query = (
            self.db.query(ToolSession)
            .filter(
                ToolSession.company_id == company_id,
                ToolSession.is_active == True,
            )
        )
        if tool_id:
            query = query.filter(ToolSession.tool_id == tool_id)
        return query.order_by(ToolSession.created_at.desc()).offset(skip).limit(limit).all()

    def count_sessions(self, company_id: UUID, tool_id: Optional[str] = None) -> int:
        query = (
            self.db.query(ToolSession)
            .filter(
                ToolSession.company_id == company_id,
                ToolSession.is_active == True,
            )
        )
        if tool_id:
            query = query.filter(ToolSession.tool_id == tool_id)
        return query.count()

    def strip_heavy_data(self, sessions: List[ToolSession]) -> List[ToolSession]:
        """Strip heavy data from session data for list views.

        Keeps only the fields needed to render the session list (name, status,
        client_info, mode, room count). Drops: result, photo data, rooms detail,
        corrections, and other large nested structures.
        """
        KEEP_KEYS = {
            "mode", "status", "client_info", "company_override",
            "manually_completed",
            "linked_estimate_id", "linked_estimate_number",
            "linked_invoice_id", "linked_invoice_number",
        }

        for session in sessions:
            data = session.data
            if not data or not isinstance(data, dict):
                continue

            # Compute summary counts before stripping
            photo_rooms = data.get("photo_rooms")
            rooms = data.get("rooms")
            room_count = 0
            if photo_rooms and isinstance(photo_rooms, list):
                room_count = len(photo_rooms)
            elif rooms and isinstance(rooms, list):
                room_count = len(rooms)

            # Keep the grand total even though the full result object is dropped
            result = data.get("result")
            grand_total = result.get("grand_total") if isinstance(result, dict) else None

            # Replace data with lightweight summary
            summary = {k: data[k] for k in KEEP_KEYS if k in data}
            summary["room_count"] = room_count
            if grand_total is not None:
                summary["grand_total"] = grand_total
            session.data = summary

        return sessions

    def get_session(self, session_id: UUID, company_id: UUID) -> ToolSession:
        session = (
            self.db.query(ToolSession)
            .filter(
                ToolSession.id == session_id,
                ToolSession.company_id == company_id,
                ToolSession.is_active == True,
            )
            .first()
        )
        if not session:
            raise NotFoundException("Tool session", str(session_id))
        return session

    def create_session(
        self,
        company_id: UUID,
        user_id: UUID,
        tool_id: str,
        name: Optional[str] = None,
        data: Optional[dict] = None,
    ) -> ToolSession:
        session = ToolSession(
            company_id=company_id,
            created_by=user_id,
            tool_id=tool_id,
            name=name,
            data=data or {},
        )
        self.db.add(session)
        self.db.commit()
        self.db.refresh(session)
        return session

    def update_session_data(
        self, session_id: UUID, company_id: UUID, name: Optional[str] = None,
        data: Optional[dict] = None, merge: bool = False,
    ) -> ToolSession:
        session = self.get_session(session_id, company_id)
        if name is not None:
            session.name = name
        if data is not None:
            if merge:
                session.data = {**(session.data or {}), **data}
            else:
                session.data = data
        self.db.commit()
        self.db.refresh(session)
        return session

    def delete_session(self, session_id: UUID, company_id: UUID) -> bool:
        session = self.get_session(session_id, company_id)
        session.is_active = False
        self.db.commit()
        return True
