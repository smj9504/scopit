"""
Scopit - Tool Access Dependencies
"""
from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.domains.user.models import User
from app.domains.tools.service import ToolAccessService
from app.domains.tools.registry import get_tool
from app.common.exceptions import NotFoundException, ForbiddenException


def require_tool_access(tool_id: str):
    """
    Dependency factory that enforces tool access for a specific tool_id.

    Usage:
        _gate = require_tool_access("roof_analyzer")

        @router.post("/upload")
        async def upload(current_user: User = Depends(_gate)):
            ...
    """
    async def dependency(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        tool = get_tool(tool_id)
        if not tool:
            raise NotFoundException("Tool", tool_id)

        service = ToolAccessService(db)
        if not service.can_access_tool(tool_id, current_user):
            raise ForbiddenException(
                f"Your current plan does not include access to {tool.name}. "
                "Please upgrade to unlock this tool."
            )
        return current_user

    return dependency
