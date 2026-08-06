"""
Scopit - Line Item Schemas
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


# ===================
# Line Item Note Schemas
# ===================

class LineItemNoteBase(BaseModel):
    content: str
    order_index: int = 0


class LineItemNoteCreate(LineItemNoteBase):
    pass


class LineItemNoteUpdate(BaseModel):
    content: Optional[str] = None
    order_index: Optional[int] = None


class LineItemNoteResponse(LineItemNoteBase):
    id: str
    created_at: datetime

    class Config:
        from_attributes = True


# ===================
# Line Item Schemas
# ===================

class LineItemBase(BaseModel):
    code: Optional[str] = None
    name: str
    includes: Optional[str] = None
    unit: Optional[str] = None
    unit_price: float = Field(default=0, alias="unitPrice")
    cat: Optional[str] = None
    is_taxable: bool = Field(default=True, alias="isTaxable")
    visibility: str = "private"  # "company" or "private"

    model_config = {"populate_by_name": True}


class LineItemCreate(LineItemBase):
    notes: Optional[List[LineItemNoteCreate]] = None


class LineItemUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    includes: Optional[str] = None
    unit: Optional[str] = None
    unit_price: Optional[float] = Field(default=None, alias="unitPrice")
    cat: Optional[str] = None
    is_taxable: Optional[bool] = Field(default=None, alias="isTaxable")
    visibility: Optional[str] = None
    is_active: Optional[bool] = Field(default=None, alias="isActive")

    model_config = {"populate_by_name": True}


class LineItemResponse(LineItemBase):
    id: str
    company_id: str
    created_by: str
    tool_id: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    notes: List[LineItemNoteResponse] = []

    class Config:
        from_attributes = True


class LineItemListResponse(BaseModel):
    items: List[LineItemResponse]
    total: int
    page: int
    page_size: int
