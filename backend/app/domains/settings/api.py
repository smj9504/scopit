"""
Scopit - Settings API Routes
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.domains.user.models import User
from app.domains.estimate.models import Estimate
from app.domains.invoice.models import Invoice
from app.domains.settings.models import (
    EstimateStatusConfig,
    InvoiceStatusConfig,
    LineItemCategory,
    LineItemUnit,
)
from app.domains.settings.schemas import (
    EstimateStatusConfigCreate,
    EstimateStatusConfigUpdate,
    EstimateStatusConfigResponse,
    EstimateStatusConfigListResponse,
    InvoiceStatusConfigCreate,
    InvoiceStatusConfigUpdate,
    InvoiceStatusConfigResponse,
    InvoiceStatusConfigListResponse,
    LineItemCategoryCreate,
    LineItemCategoryUpdate,
    LineItemCategoryResponse,
    LineItemCategoryListResponse,
    LineItemUnitCreate,
    LineItemUnitUpdate,
    LineItemUnitResponse,
    LineItemUnitListResponse,
    ReorderRequest,
    StatusUsageResponse,
    AffectedItemInfo,
    BulkStatusMigrationRequest,
    BulkStatusMigrationResponse,
)


router = APIRouter()


# ===================
# Helper Functions
# ===================

def serialize_estimate_status(
    status: EstimateStatusConfig,
    usage_count: int = 0
) -> dict:
    """Serialize estimate status config with UUID conversion"""
    return {
        "id": str(status.id),
        "company_id": str(status.company_id),
        "name": status.name,
        "label": status.label,
        "color": status.color,
        "bg_color": status.bg_color,
        "is_default": status.is_default,
        "is_system": status.is_system,
        "is_active": status.is_active,
        "order_index": status.order_index,
        "usage_count": usage_count,
        "created_at": status.created_at,
        "updated_at": status.updated_at,
    }


def serialize_invoice_status(
    status: InvoiceStatusConfig,
    usage_count: int = 0
) -> dict:
    """Serialize invoice status config with UUID conversion"""
    return {
        "id": str(status.id),
        "company_id": str(status.company_id),
        "name": status.name,
        "label": status.label,
        "color": status.color,
        "bg_color": status.bg_color,
        "is_default": status.is_default,
        "is_system": status.is_system,
        "is_active": status.is_active,
        "order_index": status.order_index,
        "usage_count": usage_count,
        "created_at": status.created_at,
        "updated_at": status.updated_at,
    }


def serialize_category(category: LineItemCategory) -> dict:
    """Serialize line item category with UUID conversion"""
    return {
        "id": str(category.id),
        "company_id": str(category.company_id),
        "name": category.name,
        "color": category.color,
        "is_default": category.is_default,
        "is_active": category.is_active,
        "order_index": category.order_index,
        "created_at": category.created_at,
        "updated_at": category.updated_at,
    }


def serialize_unit(unit: LineItemUnit) -> dict:
    """Serialize line item unit with UUID conversion"""
    return {
        "id": str(unit.id),
        "company_id": str(unit.company_id),
        "name": unit.name,
        "label": unit.label,
        "is_default": unit.is_default,
        "is_active": unit.is_active,
        "order_index": unit.order_index,
        "created_at": unit.created_at,
        "updated_at": unit.updated_at,
    }


def get_estimate_status_usage_counts(
    db: Session,
    company_id
) -> dict:
    """Get usage counts for all estimate statuses"""
    results = (
        db.query(
            Estimate.status_id,
            func.count(Estimate.id).label("count")
        )
        .filter(Estimate.company_id == company_id)
        .filter(Estimate.status_id.isnot(None))
        .group_by(Estimate.status_id)
        .all()
    )
    return {str(r.status_id): r.count for r in results}


def get_invoice_status_usage_counts(
    db: Session,
    company_id
) -> dict:
    """Get usage counts for all invoice statuses"""
    results = (
        db.query(
            Invoice.status_id,
            func.count(Invoice.id).label("count")
        )
        .filter(Invoice.company_id == company_id)
        .filter(Invoice.status_id.isnot(None))
        .group_by(Invoice.status_id)
        .all()
    )
    return {str(r.status_id): r.count for r in results}


# ===================
# Estimate Status Config Routes
# ===================

@router.get("/estimate-statuses", response_model=EstimateStatusConfigListResponse)
async def list_estimate_statuses(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List estimate status configs for company with usage counts"""
    statuses = (
        db.query(EstimateStatusConfig)
        .filter(
            EstimateStatusConfig.company_id == current_user.company_id,
            EstimateStatusConfig.is_active == True,
        )
        .order_by(EstimateStatusConfig.order_index)
        .all()
    )

    # Get usage counts
    usage_counts = get_estimate_status_usage_counts(db, current_user.company_id)

    return EstimateStatusConfigListResponse(
        items=[
            EstimateStatusConfigResponse(
                **serialize_estimate_status(s, usage_counts.get(str(s.id), 0))
            )
            for s in statuses
        ]
    )


@router.get(
    "/estimate-statuses/{status_id}/usage",
    response_model=StatusUsageResponse
)
async def get_estimate_status_usage(
    status_id: str,
    limit: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get usage info for an estimate status before deletion"""
    status_config = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.id == status_id,
        EstimateStatusConfig.company_id == current_user.company_id,
    ).first()

    if not status_config:
        raise HTTPException(status_code=404, detail="Status not found")

    # Get total count
    total_count = db.query(Estimate).filter(
        Estimate.status_id == status_id
    ).count()

    # Get sample of affected estimates
    estimates = (
        db.query(Estimate)
        .filter(Estimate.status_id == status_id)
        .limit(limit)
        .all()
    )

    # Count total active statuses to check if deletion is allowed
    active_count = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.company_id == current_user.company_id,
        EstimateStatusConfig.is_active == True,
    ).count()

    # Can delete if: not system, not the last one, not default (unless usage=0)
    can_delete = (
        not status_config.is_system and
        active_count > 1 and
        (not status_config.is_default or total_count == 0)
    )

    return StatusUsageResponse(
        status_id=status_id,
        usage_count=total_count,
        can_delete=can_delete,
        is_default=status_config.is_default,
        is_system=status_config.is_system,
        affected_items=[
            AffectedItemInfo(
                id=str(e.id),
                number=e.estimate_number,
                customer_name=e.customer_name
            )
            for e in estimates
        ]
    )


@router.post(
    "/estimate-statuses/migrate",
    response_model=BulkStatusMigrationResponse
)
async def migrate_estimate_status(
    data: BulkStatusMigrationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Bulk migrate estimates from one status to another"""
    # Verify from_status exists
    from_status = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.id == data.from_status_id,
        EstimateStatusConfig.company_id == current_user.company_id,
    ).first()

    if not from_status:
        raise HTTPException(status_code=404, detail="Source status not found")

    # Verify to_status exists and is active
    to_status = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.id == data.to_status_id,
        EstimateStatusConfig.company_id == current_user.company_id,
        EstimateStatusConfig.is_active == True,
    ).first()

    if not to_status:
        raise HTTPException(
            status_code=404,
            detail="Target status not found or inactive"
        )

    # Perform bulk update
    result = db.query(Estimate).filter(
        Estimate.status_id == data.from_status_id
    ).update({"status_id": data.to_status_id})

    db.commit()

    return BulkStatusMigrationResponse(
        migrated_count=result,
        from_status_id=data.from_status_id,
        to_status_id=data.to_status_id,
    )


@router.post(
    "/estimate-statuses",
    response_model=EstimateStatusConfigResponse,
    status_code=status.HTTP_201_CREATED
)
async def create_estimate_status(
    data: EstimateStatusConfigCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create new estimate status config"""
    # Check if name already exists
    existing = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.company_id == current_user.company_id,
        EstimateStatusConfig.name == data.name,
        EstimateStatusConfig.is_active == True,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Status with this name already exists"
        )

    # If setting as default, unset current default
    if data.is_default:
        db.query(EstimateStatusConfig).filter(
            EstimateStatusConfig.company_id == current_user.company_id,
            EstimateStatusConfig.is_default == True,
        ).update({"is_default": False})

    status_config = EstimateStatusConfig(
        company_id=current_user.company_id,
        name=data.name,
        label=data.label,
        color=data.color,
        bg_color=data.bg_color,
        is_default=data.is_default,
        order_index=data.order_index,
        is_system=False,
    )
    db.add(status_config)
    db.commit()
    db.refresh(status_config)

    return EstimateStatusConfigResponse(
        **serialize_estimate_status(status_config, 0)
    )


@router.put(
    "/estimate-statuses/{status_id}",
    response_model=EstimateStatusConfigResponse
)
async def update_estimate_status(
    status_id: str,
    data: EstimateStatusConfigUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update estimate status config"""
    status_config = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.id == status_id,
        EstimateStatusConfig.company_id == current_user.company_id,
    ).first()

    if not status_config:
        raise HTTPException(status_code=404, detail="Status config not found")

    # If setting as default, unset current default
    if data.is_default:
        db.query(EstimateStatusConfig).filter(
            EstimateStatusConfig.company_id == current_user.company_id,
            EstimateStatusConfig.is_default == True,
            EstimateStatusConfig.id != status_id,
        ).update({"is_default": False})

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(status_config, field, value)

    db.commit()
    db.refresh(status_config)

    # Get usage count
    usage_count = db.query(Estimate).filter(
        Estimate.status_id == status_id
    ).count()

    return EstimateStatusConfigResponse(
        **serialize_estimate_status(status_config, usage_count)
    )


@router.delete(
    "/estimate-statuses/{status_id}",
    status_code=status.HTTP_204_NO_CONTENT
)
async def delete_estimate_status(
    status_id: str,
    migrate_to: Optional[str] = Query(
        None,
        description="Status ID to migrate existing estimates to"
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete estimate status config (soft delete)"""
    status_config = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.id == status_id,
        EstimateStatusConfig.company_id == current_user.company_id,
    ).first()

    if not status_config:
        raise HTTPException(status_code=404, detail="Status not found")

    # Check if this is the "converted" system status
    if status_config.is_system:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete system status (required for Invoice conversion)"
        )

    # Count active statuses
    active_count = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.company_id == current_user.company_id,
        EstimateStatusConfig.is_active == True,
    ).count()

    if active_count <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the last status. At least one status is required."
        )

    # Check if this is default status
    if status_config.is_default:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete default status. Set another status as default first."
        )

    # Check usage
    usage_count = db.query(Estimate).filter(
        Estimate.status_id == status_id
    ).count()

    if usage_count > 0:
        if not migrate_to:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Status is in use by {usage_count} estimate(s). "
                       "Provide migrate_to parameter."
            )

        # Verify migration target
        target_status = db.query(EstimateStatusConfig).filter(
            EstimateStatusConfig.id == migrate_to,
            EstimateStatusConfig.company_id == current_user.company_id,
            EstimateStatusConfig.is_active == True,
        ).first()

        if not target_status:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Migration target status not found"
            )

        if target_status.id == status_config.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot migrate to the same status being deleted"
            )

        # Migrate items
        db.query(Estimate).filter(
            Estimate.status_id == status_id
        ).update({"status_id": migrate_to})

    # Soft delete
    status_config.is_active = False
    db.commit()


@router.put("/estimate-statuses/reorder")
async def reorder_estimate_statuses(
    data: ReorderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reorder estimate status configs"""
    for index, status_id in enumerate(data.item_ids):
        db.query(EstimateStatusConfig).filter(
            EstimateStatusConfig.id == status_id,
            EstimateStatusConfig.company_id == current_user.company_id,
        ).update({"order_index": index})

    db.commit()
    return {"message": "Statuses reordered"}


# ===================
# Invoice Status Config Routes
# ===================

@router.get("/invoice-statuses", response_model=InvoiceStatusConfigListResponse)
async def list_invoice_statuses(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List invoice status configs for company with usage counts"""
    statuses = (
        db.query(InvoiceStatusConfig)
        .filter(
            InvoiceStatusConfig.company_id == current_user.company_id,
            InvoiceStatusConfig.is_active == True,
        )
        .order_by(InvoiceStatusConfig.order_index)
        .all()
    )

    # Get usage counts
    usage_counts = get_invoice_status_usage_counts(db, current_user.company_id)

    return InvoiceStatusConfigListResponse(
        items=[
            InvoiceStatusConfigResponse(
                **serialize_invoice_status(s, usage_counts.get(str(s.id), 0))
            )
            for s in statuses
        ]
    )


@router.get(
    "/invoice-statuses/{status_id}/usage",
    response_model=StatusUsageResponse
)
async def get_invoice_status_usage(
    status_id: str,
    limit: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get usage info for an invoice status before deletion"""
    status_config = db.query(InvoiceStatusConfig).filter(
        InvoiceStatusConfig.id == status_id,
        InvoiceStatusConfig.company_id == current_user.company_id,
    ).first()

    if not status_config:
        raise HTTPException(status_code=404, detail="Status not found")

    # Get total count
    total_count = db.query(Invoice).filter(
        Invoice.status_id == status_id
    ).count()

    # Get sample of affected invoices
    invoices = (
        db.query(Invoice)
        .filter(Invoice.status_id == status_id)
        .limit(limit)
        .all()
    )

    # Count total active statuses
    active_count = db.query(InvoiceStatusConfig).filter(
        InvoiceStatusConfig.company_id == current_user.company_id,
        InvoiceStatusConfig.is_active == True,
    ).count()

    # Can delete if: not the last one, not default (unless usage=0)
    # Note: Invoice has no system status protection
    can_delete = (
        active_count > 1 and
        (not status_config.is_default or total_count == 0)
    )

    return StatusUsageResponse(
        status_id=status_id,
        usage_count=total_count,
        can_delete=can_delete,
        is_default=status_config.is_default,
        is_system=status_config.is_system,
        affected_items=[
            AffectedItemInfo(
                id=str(i.id),
                number=i.invoice_number,
                customer_name=i.customer_name
            )
            for i in invoices
        ]
    )


@router.post(
    "/invoice-statuses/migrate",
    response_model=BulkStatusMigrationResponse
)
async def migrate_invoice_status(
    data: BulkStatusMigrationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Bulk migrate invoices from one status to another"""
    # Verify from_status exists
    from_status = db.query(InvoiceStatusConfig).filter(
        InvoiceStatusConfig.id == data.from_status_id,
        InvoiceStatusConfig.company_id == current_user.company_id,
    ).first()

    if not from_status:
        raise HTTPException(status_code=404, detail="Source status not found")

    # Verify to_status exists and is active
    to_status = db.query(InvoiceStatusConfig).filter(
        InvoiceStatusConfig.id == data.to_status_id,
        InvoiceStatusConfig.company_id == current_user.company_id,
        InvoiceStatusConfig.is_active == True,
    ).first()

    if not to_status:
        raise HTTPException(
            status_code=404,
            detail="Target status not found or inactive"
        )

    # Perform bulk update
    result = db.query(Invoice).filter(
        Invoice.status_id == data.from_status_id
    ).update({"status_id": data.to_status_id})

    db.commit()

    return BulkStatusMigrationResponse(
        migrated_count=result,
        from_status_id=data.from_status_id,
        to_status_id=data.to_status_id,
    )


@router.post(
    "/invoice-statuses",
    response_model=InvoiceStatusConfigResponse,
    status_code=status.HTTP_201_CREATED
)
async def create_invoice_status(
    data: InvoiceStatusConfigCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create new invoice status config"""
    # Check if name already exists
    existing = db.query(InvoiceStatusConfig).filter(
        InvoiceStatusConfig.company_id == current_user.company_id,
        InvoiceStatusConfig.name == data.name,
        InvoiceStatusConfig.is_active == True,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Status with this name already exists"
        )

    # If setting as default, unset current default
    if data.is_default:
        db.query(InvoiceStatusConfig).filter(
            InvoiceStatusConfig.company_id == current_user.company_id,
            InvoiceStatusConfig.is_default == True,
        ).update({"is_default": False})

    status_config = InvoiceStatusConfig(
        company_id=current_user.company_id,
        name=data.name,
        label=data.label,
        color=data.color,
        bg_color=data.bg_color,
        is_default=data.is_default,
        order_index=data.order_index,
        is_system=False,
    )
    db.add(status_config)
    db.commit()
    db.refresh(status_config)

    return InvoiceStatusConfigResponse(
        **serialize_invoice_status(status_config, 0)
    )


@router.put(
    "/invoice-statuses/{status_id}",
    response_model=InvoiceStatusConfigResponse
)
async def update_invoice_status(
    status_id: str,
    data: InvoiceStatusConfigUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update invoice status config"""
    status_config = db.query(InvoiceStatusConfig).filter(
        InvoiceStatusConfig.id == status_id,
        InvoiceStatusConfig.company_id == current_user.company_id,
    ).first()

    if not status_config:
        raise HTTPException(status_code=404, detail="Status config not found")

    # If setting as default, unset current default
    if data.is_default:
        db.query(InvoiceStatusConfig).filter(
            InvoiceStatusConfig.company_id == current_user.company_id,
            InvoiceStatusConfig.is_default == True,
            InvoiceStatusConfig.id != status_id,
        ).update({"is_default": False})

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(status_config, field, value)

    db.commit()
    db.refresh(status_config)

    # Get usage count
    usage_count = db.query(Invoice).filter(
        Invoice.status_id == status_id
    ).count()

    return InvoiceStatusConfigResponse(
        **serialize_invoice_status(status_config, usage_count)
    )


@router.delete(
    "/invoice-statuses/{status_id}",
    status_code=status.HTTP_204_NO_CONTENT
)
async def delete_invoice_status(
    status_id: str,
    migrate_to: Optional[str] = Query(
        None,
        description="Status ID to migrate existing invoices to"
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete invoice status config (soft delete)"""
    status_config = db.query(InvoiceStatusConfig).filter(
        InvoiceStatusConfig.id == status_id,
        InvoiceStatusConfig.company_id == current_user.company_id,
    ).first()

    if not status_config:
        raise HTTPException(status_code=404, detail="Status not found")

    # Count active statuses
    active_count = db.query(InvoiceStatusConfig).filter(
        InvoiceStatusConfig.company_id == current_user.company_id,
        InvoiceStatusConfig.is_active == True,
    ).count()

    if active_count <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the last status. At least one status is required."
        )

    # Check if this is default status
    if status_config.is_default:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete default status. Set another status as default first."
        )

    # Check usage
    usage_count = db.query(Invoice).filter(
        Invoice.status_id == status_id
    ).count()

    if usage_count > 0:
        if not migrate_to:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Status is in use by {usage_count} invoice(s). "
                       "Provide migrate_to parameter."
            )

        # Verify migration target
        target_status = db.query(InvoiceStatusConfig).filter(
            InvoiceStatusConfig.id == migrate_to,
            InvoiceStatusConfig.company_id == current_user.company_id,
            InvoiceStatusConfig.is_active == True,
        ).first()

        if not target_status:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Migration target status not found"
            )

        if target_status.id == status_config.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot migrate to the same status being deleted"
            )

        # Migrate items
        db.query(Invoice).filter(
            Invoice.status_id == status_id
        ).update({"status_id": migrate_to})

    # Soft delete
    status_config.is_active = False
    db.commit()


@router.put("/invoice-statuses/reorder")
async def reorder_invoice_statuses(
    data: ReorderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reorder invoice status configs"""
    for index, status_id in enumerate(data.item_ids):
        db.query(InvoiceStatusConfig).filter(
            InvoiceStatusConfig.id == status_id,
            InvoiceStatusConfig.company_id == current_user.company_id,
        ).update({"order_index": index})

    db.commit()
    return {"message": "Statuses reordered"}


# ===================
# Line Item Category Routes
# ===================

@router.get("/categories", response_model=LineItemCategoryListResponse)
async def list_categories(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List line item categories for company"""
    categories = (
        db.query(LineItemCategory)
        .filter(
            LineItemCategory.company_id == current_user.company_id,
            LineItemCategory.is_active == True,
        )
        .order_by(LineItemCategory.order_index)
        .all()
    )

    return LineItemCategoryListResponse(
        items=[LineItemCategoryResponse(**serialize_category(c)) for c in categories]
    )


@router.post(
    "/categories",
    response_model=LineItemCategoryResponse,
    status_code=status.HTTP_201_CREATED
)
async def create_category(
    data: LineItemCategoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create new line item category"""
    # Check if name already exists
    existing = db.query(LineItemCategory).filter(
        LineItemCategory.company_id == current_user.company_id,
        LineItemCategory.name == data.name,
        LineItemCategory.is_active == True,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category with this name already exists"
        )

    # If setting as default, unset current default
    if data.is_default:
        db.query(LineItemCategory).filter(
            LineItemCategory.company_id == current_user.company_id,
            LineItemCategory.is_default == True,
        ).update({"is_default": False})

    category = LineItemCategory(
        company_id=current_user.company_id,
        name=data.name,
        color=data.color,
        is_default=data.is_default,
        order_index=data.order_index,
    )
    db.add(category)
    db.commit()
    db.refresh(category)

    return LineItemCategoryResponse(**serialize_category(category))


@router.put("/categories/{category_id}", response_model=LineItemCategoryResponse)
async def update_category(
    category_id: str,
    data: LineItemCategoryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update line item category"""
    category = db.query(LineItemCategory).filter(
        LineItemCategory.id == category_id,
        LineItemCategory.company_id == current_user.company_id,
    ).first()

    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    # If setting as default, unset current default
    if data.is_default:
        db.query(LineItemCategory).filter(
            LineItemCategory.company_id == current_user.company_id,
            LineItemCategory.is_default == True,
            LineItemCategory.id != category_id,
        ).update({"is_default": False})

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(category, field, value)

    db.commit()
    db.refresh(category)

    return LineItemCategoryResponse(**serialize_category(category))


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete line item category (soft delete)"""
    category = db.query(LineItemCategory).filter(
        LineItemCategory.id == category_id,
        LineItemCategory.company_id == current_user.company_id,
    ).first()

    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    # Soft delete
    category.is_active = False
    db.commit()


@router.put("/categories/reorder")
async def reorder_categories(
    data: ReorderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reorder line item categories"""
    for index, category_id in enumerate(data.item_ids):
        db.query(LineItemCategory).filter(
            LineItemCategory.id == category_id,
            LineItemCategory.company_id == current_user.company_id,
        ).update({"order_index": index})

    db.commit()
    return {"message": "Categories reordered"}


# ===================
# Line Item Unit Routes
# ===================

@router.get("/units", response_model=LineItemUnitListResponse)
async def list_units(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List line item units for company"""
    units = (
        db.query(LineItemUnit)
        .filter(
            LineItemUnit.company_id == current_user.company_id,
            LineItemUnit.is_active == True,
        )
        .order_by(LineItemUnit.order_index)
        .all()
    )

    return LineItemUnitListResponse(
        items=[LineItemUnitResponse(**serialize_unit(u)) for u in units]
    )


@router.post(
    "/units",
    response_model=LineItemUnitResponse,
    status_code=status.HTTP_201_CREATED
)
async def create_unit(
    data: LineItemUnitCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create new line item unit"""
    # Check if name already exists
    existing = db.query(LineItemUnit).filter(
        LineItemUnit.company_id == current_user.company_id,
        LineItemUnit.name == data.name,
        LineItemUnit.is_active == True,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unit with this name already exists"
        )

    # If setting as default, unset current default
    if data.is_default:
        db.query(LineItemUnit).filter(
            LineItemUnit.company_id == current_user.company_id,
            LineItemUnit.is_default == True,
        ).update({"is_default": False})

    unit = LineItemUnit(
        company_id=current_user.company_id,
        name=data.name,
        label=data.label,
        is_default=data.is_default,
        order_index=data.order_index,
    )
    db.add(unit)
    db.commit()
    db.refresh(unit)

    return LineItemUnitResponse(**serialize_unit(unit))


@router.put("/units/{unit_id}", response_model=LineItemUnitResponse)
async def update_unit(
    unit_id: str,
    data: LineItemUnitUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update line item unit"""
    unit = db.query(LineItemUnit).filter(
        LineItemUnit.id == unit_id,
        LineItemUnit.company_id == current_user.company_id,
    ).first()

    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    # If setting as default, unset current default
    if data.is_default:
        db.query(LineItemUnit).filter(
            LineItemUnit.company_id == current_user.company_id,
            LineItemUnit.is_default == True,
            LineItemUnit.id != unit_id,
        ).update({"is_default": False})

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(unit, field, value)

    db.commit()
    db.refresh(unit)

    return LineItemUnitResponse(**serialize_unit(unit))


@router.delete("/units/{unit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_unit(
    unit_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete line item unit (soft delete)"""
    unit = db.query(LineItemUnit).filter(
        LineItemUnit.id == unit_id,
        LineItemUnit.company_id == current_user.company_id,
    ).first()

    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    # Soft delete
    unit.is_active = False
    db.commit()


@router.put("/units/reorder")
async def reorder_units(
    data: ReorderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reorder line item units"""
    for index, unit_id in enumerate(data.item_ids):
        db.query(LineItemUnit).filter(
            LineItemUnit.id == unit_id,
            LineItemUnit.company_id == current_user.company_id,
        ).update({"order_index": index})

    db.commit()
    return {"message": "Units reordered"}
