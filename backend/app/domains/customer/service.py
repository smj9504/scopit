"""
Scopit - Customer Service
"""
from sqlalchemy.orm import Session
from uuid import UUID

from app.domains.customer.models import Customer


def seed_sample_customers(db: Session, company_id: UUID, created_by: UUID):
    """
    Seed sample customers for a new company.
    These are example customers that users can modify or delete.

    Args:
        db: Database session
        company_id: Company UUID
        created_by: User UUID who created these customers
    """

    sample_customers = [
        {
            "name": "Johnson Residence",
            "contact_name": "Michael Johnson",
            "email": "michael.johnson@email.com",
            "phone": "(555) 123-4567",
            "address_line1": "1234 Oak Street",
            "address_line2": None,
            "city": "Springfield",
            "state": "IL",
            "zipcode": "62701",
            "notes": "Sample customer - Water damage restoration project. Feel free to edit or delete this example.",
            "tags": ["residential", "water damage"],
        },
        {
            "name": "Sunrise Insurance Agency",
            "contact_name": "Sarah Williams",
            "email": "sarah.williams@sunriseins.com",
            "phone": "(555) 234-5678",
            "address_line1": "500 Commerce Drive",
            "address_line2": "Suite 200",
            "city": "Chicago",
            "state": "IL",
            "zipcode": "60601",
            "notes": "Sample customer - Insurance agency contact. Feel free to edit or delete this example.",
            "tags": ["commercial", "insurance"],
        },
        {
            "name": "Martinez Family Home",
            "contact_name": "Carlos Martinez",
            "email": "carlos.martinez@email.com",
            "phone": "(555) 345-6789",
            "address_line1": "789 Maple Avenue",
            "address_line2": None,
            "city": "Aurora",
            "state": "IL",
            "zipcode": "60505",
            "notes": "Sample customer - Fire damage restoration. Feel free to edit or delete this example.",
            "tags": ["residential", "fire damage"],
        },
    ]

    for customer_data in sample_customers:
        customer = Customer(
            company_id=company_id,
            created_by=created_by,
            **customer_data
        )
        db.add(customer)

    # Note: Don't commit here - let the caller handle the transaction
    db.flush()
