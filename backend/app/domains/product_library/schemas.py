"""
Product library schemas.

Images travel as file ids ("<product id>/<name>.<ext>", stored under the
company's products folder); the frontend loads one from
GET /api/products/images/{file_id}. ProductSnapshot is what an estimate keeps of
a product it uses — a copy, so the estimate stays as it was sent.
"""

from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .catalog import CATEGORIES, PRICE_UNITS, RETAILERS


class ProductFields(BaseModel):
    # model_number is a product's, not pydantic's.
    model_config = ConfigDict(protected_namespaces=())

    category: str = "other"
    title: str = Field(..., min_length=1, max_length=300)
    brand: Optional[str] = Field(None, max_length=120)
    model_number: Optional[str] = Field(None, max_length=120)
    sku: Optional[str] = Field(None, max_length=120)
    finish: Optional[str] = Field(None, max_length=160)
    description: Optional[str] = None
    retailer: Optional[str] = None
    source_url: Optional[str] = None
    price: Optional[Decimal] = Field(None, ge=0)
    price_unit: str = "each"
    box_sf: Optional[float] = Field(None, gt=0)
    width_in: Optional[float] = Field(None, gt=0)
    depth_in: Optional[float] = Field(None, gt=0)
    height_in: Optional[float] = Field(None, gt=0)
    tile_width_in: Optional[float] = Field(None, gt=0)
    tile_length_in: Optional[float] = Field(None, gt=0)
    look: Dict[str, Any] = Field(default_factory=dict)
    specs: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("category")
    @classmethod
    def _known_category(cls, v: str) -> str:
        if v not in CATEGORIES:
            raise ValueError(f"Unknown category {v!r}")
        return v

    @field_validator("price_unit")
    @classmethod
    def _known_unit(cls, v: str) -> str:
        if v not in PRICE_UNITS:
            raise ValueError(f"Unknown price unit {v!r}")
        return v

    @field_validator("retailer")
    @classmethod
    def _known_retailer(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in RETAILERS:
            raise ValueError(f"Unknown retailer {v!r}")
        return v


class ProductCreate(ProductFields):
    # Pictures to fetch from the retailer and keep copies of, main one first.
    image_urls: List[str] = Field(default_factory=list, max_length=12)
    # Already-uploaded pictures (file ids), kept after those fetched.
    image_file_ids: List[str] = Field(default_factory=list)
    swatch_file_id: Optional[str] = None


class ProductUpdate(BaseModel):
    """Only the fields sent change. image_file_ids, when sent, is the whole new list (reordered or trimmed)."""

    model_config = ConfigDict(protected_namespaces=())

    category: Optional[str] = None
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    brand: Optional[str] = None
    model_number: Optional[str] = None
    sku: Optional[str] = None
    finish: Optional[str] = None
    description: Optional[str] = None
    retailer: Optional[str] = None
    source_url: Optional[str] = None
    price: Optional[Decimal] = Field(None, ge=0)
    price_unit: Optional[str] = None
    box_sf: Optional[float] = None
    width_in: Optional[float] = None
    depth_in: Optional[float] = None
    height_in: Optional[float] = None
    tile_width_in: Optional[float] = None
    tile_length_in: Optional[float] = None
    look: Optional[Dict[str, Any]] = None
    specs: Optional[Dict[str, Any]] = None
    image_urls: List[str] = Field(default_factory=list, max_length=12)
    image_file_ids: Optional[List[str]] = None
    swatch_file_id: Optional[str] = None

    @field_validator("category")
    @classmethod
    def _known_category(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in CATEGORIES:
            raise ValueError(f"Unknown category {v!r}")
        return v

    @field_validator("price_unit")
    @classmethod
    def _known_unit(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in PRICE_UNITS:
            raise ValueError(f"Unknown price unit {v!r}")
        return v


class ProductResponse(ProductFields):
    id: UUID
    retailer: str
    company_id: Optional[UUID] = None
    image_file_ids: List[str] = Field(default_factory=list)
    swatch_file_id: Optional[str] = None
    is_archived: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())


class ProductListResponse(BaseModel):
    items: List[ProductResponse]
    total: int


class ProductDraft(BaseModel):
    """What was read off a listing (a page or a screenshot), for the person to check and save. Nothing is stored yet."""

    fields: Dict[str, Any] = Field(default_factory=dict)
    # Pictures found on the page, main one first, to choose from.
    image_urls: List[str] = Field(default_factory=list)
    # The retailer turned the server away (bot check): a screenshot is the way in.
    blocked: bool = False
    # What happened, in a sentence, when it isn't the whole picture.
    note: Optional[str] = None


class ExtractUrlRequest(BaseModel):
    url: str = Field(..., min_length=8, max_length=2000)


class ExtractHtmlRequest(BaseModel):
    """A product page as the person's browser has it, sent by the library's bookmarklet."""

    url: str = Field(..., min_length=8, max_length=2000)
    html: str = Field(..., min_length=1, max_length=6_000_000)


class ProductSnapshot(BaseModel):
    """What an estimate keeps of a product it uses: a copy, not a link, so the estimate stays as it was sent."""

    model_config = ConfigDict(protected_namespaces=())

    product_id: UUID
    category: str
    title: str
    brand: Optional[str] = None
    model_number: Optional[str] = None
    sku: Optional[str] = None
    finish: Optional[str] = None
    retailer: str = "other"
    source_url: Optional[str] = None
    price: Optional[Decimal] = None
    price_unit: str = "each"
    box_sf: Optional[float] = None
    width_in: Optional[float] = None
    depth_in: Optional[float] = None
    height_in: Optional[float] = None
    tile_width_in: Optional[float] = None
    tile_length_in: Optional[float] = None
    image_file_ids: List[str] = Field(default_factory=list)
    swatch_file_id: Optional[str] = None
    look: Dict[str, Any] = Field(default_factory=dict)
    taken_at: datetime
