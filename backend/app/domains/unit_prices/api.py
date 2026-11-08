"""
Scopit - Company prices for the Bathroom and Cabinet Estimators

A company's prices over the defaults: anyone who can use a domain's tool
sees them, an admin or manager changes them (as with the company's other
settings). Always the signed-in user's company; Scopit has no company
picker, unlike MJ Estimate's screen this is ported from.
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.domains.tools.registry import get_tool
from app.domains.tools.service import ToolAccessService
from app.domains.user.models import User

from . import catalog
from .service import UnitPriceError, UnitPriceService

router = APIRouter()

# Each price catalog and the tool that prices with it
DOMAIN_TOOLS = {"bathroom": "bathroom_estimate", "cabinet": "cabinet_estimate"}

# Who may change the company's prices (core.dependencies.require_manager)
EDITOR_ROLES = ("admin", "manager")


class PriceChange(BaseModel):
    """Leave a side out to keep it; send null to put it back to the default."""
    model_config = ConfigDict(extra="forbid")

    material: Optional[float] = None
    labor: Optional[float] = None


class PriceChanges(BaseModel):
    prices: Dict[str, PriceChange]


def _can_edit(user: User) -> bool:
    return user.role in EDITOR_ROLES


def _domain(domain: str, db: Session, user: User) -> str:
    """The domain, if it exists and the user may use its tool."""
    tool_id = DOMAIN_TOOLS.get(domain)
    if tool_id is None:
        raise HTTPException(status_code=404, detail="No such price list")
    if not ToolAccessService(db).can_access_tool(tool_id, user):
        tool = get_tool(tool_id)
        raise HTTPException(
            status_code=403,
            detail=f"Your current plan does not include access to {tool.name if tool else tool_id}.",
        )
    return domain


def _company(user: User):
    if not user.company_id:
        raise HTTPException(status_code=403, detail="Join a company to set its prices")
    return user.company_id


def _fail(e: UnitPriceError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=str(e))


@router.get("/domains")
def list_domains(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    """The price lists this person's tools price with."""
    access = ToolAccessService(db)
    return [
        {"key": d.key, "label": d.label, "count": len(d.items())}
        for d in catalog.domains()
        if d.key in DOMAIN_TOOLS and access.can_access_tool(DOMAIN_TOOLS[d.key], current_user)
    ]


@router.get("/{domain}")
def get_prices(
    domain: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    domain = _domain(domain, db, current_user)
    result = UnitPriceService(db).price_list(domain, _company(current_user))
    result["can_edit"] = _can_edit(current_user)
    return result


@router.put("/{domain}")
def save_prices(
    domain: str,
    body: PriceChanges,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    domain = _domain(domain, db, current_user)
    if not _can_edit(current_user):
        raise HTTPException(status_code=403, detail="Only an admin or manager can change the company's prices")
    company_id = _company(current_user)
    changes = {key: change.model_dump(exclude_unset=True) for key, change in body.prices.items()}
    try:
        result = UnitPriceService(db).save(domain, company_id, changes, user_id=current_user.id)
    except UnitPriceError as e:
        db.rollback()
        raise _fail(e)
    db.commit()
    result["can_edit"] = True
    return result


@router.get("/{domain}/history")
def get_history(
    domain: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    domain = _domain(domain, db, current_user)
    return UnitPriceService(db).history(domain, _company(current_user))
