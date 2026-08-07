"""
Scopit - Standard API Response Schemas

Provides consistent response formats across all API endpoints.
"""
from typing import Generic, List, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar('T')


class MessageResponse(BaseModel):
    """Standard response for operations that return a message"""
    message: str
    success: bool = True


class ErrorResponse(BaseModel):
    """Standard error response"""
    detail: str
    code: Optional[str] = None


class BulkOperationResponse(BaseModel):
    """Standard response for bulk operations"""
    message: str
    affected_count: int
    success: bool = True


class DeleteResponse(BaseModel):
    """Standard response for delete operations"""
    message: str = "Successfully deleted"
    success: bool = True


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard paginated response wrapper"""
    items: List[T]
    total: int
    page: int
    limit: int
    has_more: bool

    @classmethod
    def create(
        cls,
        items: List[T],
        total: int,
        skip: int,
        limit: int
    ) -> "PaginatedResponse[T]":
        """Factory method to create paginated response"""
        page = (skip // limit) + 1 if limit > 0 else 1
        has_more = skip + len(items) < total
        return cls(
            items=items,
            total=total,
            page=page,
            limit=limit,
            has_more=has_more
        )
