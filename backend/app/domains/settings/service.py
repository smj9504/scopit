"""
Scopit - Settings Service
"""
from sqlalchemy.orm import Session
from uuid import UUID

from app.domains.settings.models import (
    EstimateStatusConfig,
    InvoiceStatusConfig,
    LineItemCategory,
    LineItemUnit,
)


def seed_default_settings(db: Session, company_id: UUID):
    """
    Seed default settings for a new company
    
    Args:
        db: Database session
        company_id: Company UUID
    """
    
    # Default Estimate Statuses
    # Note: is_system=True only for "converted" (required for Invoice conversion)
    # All other statuses can be deleted by users
    estimate_statuses = [
        {
            "name": "draft",
            "label": "Draft",
            "color": "#6b7280",
            "bg_color": "#f3f4f6",
            "is_default": True,
            "is_system": False,
            "order_index": 0,
        },
        {
            "name": "sent",
            "label": "Sent",
            "color": "#3b82f6",
            "bg_color": "#dbeafe",
            "is_default": False,
            "is_system": False,
            "order_index": 1,
        },
        {
            "name": "viewed",
            "label": "Viewed",
            "color": "#8b5cf6",
            "bg_color": "#ede9fe",
            "is_default": False,
            "is_system": False,
            "order_index": 2,
        },
        {
            "name": "approved",
            "label": "Approved",
            "color": "#10b981",
            "bg_color": "#d1fae5",
            "is_default": False,
            "is_system": False,
            "order_index": 3,
        },
        {
            "name": "declined",
            "label": "Declined",
            "color": "#ef4444",
            "bg_color": "#fee2e2",
            "is_default": False,
            "is_system": False,
            "order_index": 4,
        },
        {
            "name": "expired",
            "label": "Expired",
            "color": "#f59e0b",
            "bg_color": "#fef3c7",
            "is_default": False,
            "is_system": False,
            "order_index": 5,
        },
        {
            "name": "converted",
            "label": "Converted",
            "color": "#059669",
            "bg_color": "#d1fae5",
            "is_default": False,
            "is_system": True,  # Protected: required for Invoice conversion
            "order_index": 6,
        },
    ]
    
    for status_data in estimate_statuses:
        status = EstimateStatusConfig(
            company_id=company_id,
            **status_data
        )
        db.add(status)
    
    # Default Invoice Statuses
    # Note: All invoice statuses can be deleted by users (no is_system=True)
    invoice_statuses = [
        {
            "name": "draft",
            "label": "Draft",
            "color": "#6b7280",
            "bg_color": "#f3f4f6",
            "is_default": True,
            "is_system": False,
            "order_index": 0,
        },
        {
            "name": "sent",
            "label": "Sent",
            "color": "#3b82f6",
            "bg_color": "#dbeafe",
            "is_default": False,
            "is_system": False,
            "order_index": 1,
        },
        {
            "name": "viewed",
            "label": "Viewed",
            "color": "#8b5cf6",
            "bg_color": "#ede9fe",
            "is_default": False,
            "is_system": False,
            "order_index": 2,
        },
        {
            "name": "partial",
            "label": "Partial",
            "color": "#f59e0b",
            "bg_color": "#fef3c7",
            "is_default": False,
            "is_system": False,
            "order_index": 3,
        },
        {
            "name": "paid",
            "label": "Paid",
            "color": "#10b981",
            "bg_color": "#d1fae5",
            "is_default": False,
            "is_system": False,
            "order_index": 4,
        },
        {
            "name": "overdue",
            "label": "Overdue",
            "color": "#ef4444",
            "bg_color": "#fee2e2",
            "is_default": False,
            "is_system": False,
            "order_index": 5,
        },
        {
            "name": "canceled",
            "label": "Canceled",
            "color": "#6b7280",
            "bg_color": "#f3f4f6",
            "is_default": False,
            "is_system": False,
            "order_index": 6,
        },
        {
            "name": "refunded",
            "label": "Refunded",
            "color": "#7c3aed",
            "bg_color": "#ede9fe",
            "is_default": False,
            "is_system": False,
            "order_index": 7,
        },
    ]
    
    for status_data in invoice_statuses:
        status = InvoiceStatusConfig(
            company_id=company_id,
            **status_data
        )
        db.add(status)
    
    # Default Line Item Categories
    categories = [
        {
            "name": "Labor",
            "color": "#3b82f6",
            "is_default": True,
            "order_index": 0,
        },
        {
            "name": "Materials",
            "color": "#10b981",
            "is_default": False,
            "order_index": 1,
        },
        {
            "name": "Equipment",
            "color": "#f59e0b",
            "is_default": False,
            "order_index": 2,
        },
        {
            "name": "Subcontractor",
            "color": "#8b5cf6",
            "is_default": False,
            "order_index": 3,
        },
        {
            "name": "Other",
            "color": "#6b7280",
            "is_default": False,
            "order_index": 4,
        },
    ]
    
    for category_data in categories:
        category = LineItemCategory(
            company_id=company_id,
            **category_data
        )
        db.add(category)
    
    # Default Line Item Units
    units = [
        {
            "name": "EA",
            "label": "EA (Each)",
            "is_default": True,
            "order_index": 0,
        },
        {
            "name": "SF",
            "label": "SF (Sq Ft)",
            "is_default": False,
            "order_index": 1,
        },
        {
            "name": "LF",
            "label": "LF (Lin Ft)",
            "is_default": False,
            "order_index": 2,
        },
        {
            "name": "HR",
            "label": "HR (Hour)",
            "is_default": False,
            "order_index": 3,
        },
        {
            "name": "DAY",
            "label": "DAY",
            "is_default": False,
            "order_index": 4,
        },
    ]
    
    for unit_data in units:
        unit = LineItemUnit(
            company_id=company_id,
            **unit_data
        )
        db.add(unit)
    
    # Commit all at once
    db.commit()
