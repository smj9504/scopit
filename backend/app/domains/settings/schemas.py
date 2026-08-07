"""
Scopit - Settings Schemas
"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel

# ===================
# EstimateStatusConfig Schemas
# ===================

class EstimateStatusConfigBase(BaseModel):
    name: str
    label: str
    color: str
    bg_color: str
    is_default: bool = False
    order_index: int = 0


class EstimateStatusConfigCreate(EstimateStatusConfigBase):
    pass


class EstimateStatusConfigUpdate(BaseModel):
    label: Optional[str] = None
    color: Optional[str] = None
    bg_color: Optional[str] = None
    is_default: Optional[bool] = None
    order_index: Optional[int] = None
    is_active: Optional[bool] = None


class EstimateStatusConfigResponse(EstimateStatusConfigBase):
    id: str
    company_id: str
    is_system: bool
    is_active: bool
    usage_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class EstimateStatusConfigListResponse(BaseModel):
    items: List[EstimateStatusConfigResponse]


# ===================
# InvoiceStatusConfig Schemas
# ===================

class InvoiceStatusConfigBase(BaseModel):
    name: str
    label: str
    color: str
    bg_color: str
    is_default: bool = False
    order_index: int = 0


class InvoiceStatusConfigCreate(InvoiceStatusConfigBase):
    pass


class InvoiceStatusConfigUpdate(BaseModel):
    label: Optional[str] = None
    color: Optional[str] = None
    bg_color: Optional[str] = None
    is_default: Optional[bool] = None
    order_index: Optional[int] = None
    is_active: Optional[bool] = None


class InvoiceStatusConfigResponse(InvoiceStatusConfigBase):
    id: str
    company_id: str
    is_system: bool
    is_active: bool
    usage_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class InvoiceStatusConfigListResponse(BaseModel):
    items: List[InvoiceStatusConfigResponse]


# ===================
# LineItemCategory Schemas
# ===================

class LineItemCategoryBase(BaseModel):
    name: str
    color: Optional[str] = None
    is_default: bool = False
    order_index: int = 0


class LineItemCategoryCreate(LineItemCategoryBase):
    pass


class LineItemCategoryUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    is_default: Optional[bool] = None
    order_index: Optional[int] = None
    is_active: Optional[bool] = None


class LineItemCategoryResponse(LineItemCategoryBase):
    id: str
    company_id: str
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class LineItemCategoryListResponse(BaseModel):
    items: List[LineItemCategoryResponse]


# ===================
# Reorder Schemas
# ===================

class ReorderRequest(BaseModel):
    item_ids: List[str]


# ===================
# Status Usage & Migration Schemas
# ===================

class AffectedItemInfo(BaseModel):
    id: str
    number: str
    customer_name: Optional[str] = None


class StatusUsageResponse(BaseModel):
    status_id: str
    usage_count: int
    can_delete: bool
    is_default: bool
    is_system: bool
    affected_items: List[AffectedItemInfo] = []


class BulkStatusMigrationRequest(BaseModel):
    from_status_id: str
    to_status_id: str


class BulkStatusMigrationResponse(BaseModel):
    migrated_count: int
    from_status_id: str
    to_status_id: str


# ===================
# LineItemUnit Schemas
# ===================

class LineItemUnitBase(BaseModel):
    name: str
    label: Optional[str] = None
    is_default: bool = False
    order_index: int = 0


class LineItemUnitCreate(LineItemUnitBase):
    pass


class LineItemUnitUpdate(BaseModel):
    name: Optional[str] = None
    label: Optional[str] = None
    is_default: Optional[bool] = None
    order_index: Optional[int] = None
    is_active: Optional[bool] = None


class LineItemUnitResponse(LineItemUnitBase):
    id: str
    company_id: str
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class LineItemUnitListResponse(BaseModel):
    items: List[LineItemUnitResponse]
