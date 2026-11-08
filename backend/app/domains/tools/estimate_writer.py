"""
Scopit - Writing a tool's result into a Scopit estimate

A tool's converter turns its result into an EstimateCreate-shaped payload
(see converter.py); this creates the estimate from it, or replaces the
contents of one the tool wrote before. Shared by the tool-session bridge
(tools/api.py) and tools that keep their own records (Cabinet Estimator).
"""
from datetime import date
from decimal import Decimal
from typing import Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.common.exceptions import BadRequestException
from app.domains.user.models import User


def write_estimate(
    db: Session,
    user: User,
    payload: dict,
    *,
    customer_id=None,
    customer_name: Optional[str] = None,
    title: Optional[str] = None,
    existing_estimate_id=None,
) -> Tuple["Estimate", bool]:  # noqa: F821
    """Create (or, with existing_estimate_id, refill) an estimate from `payload`.

    Commits. Returns the estimate, with totals recalculated, and whether an
    existing one was updated.
    """
    from app.domains.company.models import Company
    from app.domains.customer.models import Customer
    from app.domains.estimate.models import Estimate, EstimateItem, EstimateSection, EstimateStatus
    from app.domains.settings.models import EstimateStatusConfig

    company = db.query(Company).filter(Company.id == user.company_id).first()

    customer_name = payload.get("customer_name") or customer_name
    customer_email = payload.get("customer_email")
    customer_address_line1 = payload.get("customer_address_line1")
    customer_address_line2 = payload.get("customer_address_line2")
    customer_city = payload.get("customer_city")
    customer_state = payload.get("customer_state")
    customer_zipcode = payload.get("customer_zipcode")

    if customer_id:
        customer = db.query(Customer).filter(
            Customer.id == customer_id,
            Customer.company_id == user.company_id,
        ).first()
        if not customer:
            raise HTTPException(status_code=400, detail="Customer not found")
        customer_name = customer.name
        customer_email = customer.email
        customer_address_line1 = customer.address_line1
        customer_address_line2 = customer.address_line2
        customer_city = customer.city
        customer_state = customer.state
        customer_zipcode = customer.zipcode

    existing_estimate = None
    if existing_estimate_id:
        existing_estimate = (
            db.query(Estimate)
            .filter(
                Estimate.id == existing_estimate_id,
                Estimate.company_id == user.company_id,
            )
            .first()
        )
        if not existing_estimate:
            raise BadRequestException(
                "The previously linked estimate no longer exists. Create a new estimate instead."
            )

    updated = existing_estimate is not None

    if existing_estimate:
        estimate = existing_estimate
        estimate.customer_id = customer_id
        estimate.customer_name = customer_name
        estimate.customer_email = customer_email
        estimate.customer_address_line1 = customer_address_line1
        estimate.customer_address_line2 = customer_address_line2
        estimate.customer_city = customer_city
        estimate.customer_state = customer_state
        estimate.customer_zipcode = customer_zipcode
        estimate.title = payload.get("title") or title
        estimate.description = payload.get("description")
        if payload.get("tax_rate") is not None:
            estimate.tax_rate = payload["tax_rate"]

        # Replace sections/items with the freshly converted content.
        db.query(EstimateItem).filter(EstimateItem.estimate_id == estimate.id).delete()
        db.query(EstimateSection).filter(EstimateSection.estimate_id == estimate.id).delete()
        db.flush()
    else:
        estimate_number = f"{company.estimate_prefix}-{company.next_estimate_number}"
        company.next_estimate_number += 1

        default_status = (
            db.query(EstimateStatusConfig)
            .filter(
                EstimateStatusConfig.company_id == user.company_id,
                EstimateStatusConfig.is_default == True,  # noqa: E712
                EstimateStatusConfig.is_active == True,  # noqa: E712
            )
            .first()
        )

        estimate = Estimate(
            company_id=user.company_id,
            estimate_number=estimate_number,
            status=EstimateStatus.DRAFT,
            status_id=default_status.id if default_status else None,
            estimate_date=date.today(),
            customer_id=customer_id,
            customer_name=customer_name,
            customer_email=customer_email,
            customer_address_line1=customer_address_line1,
            customer_address_line2=customer_address_line2,
            customer_city=customer_city,
            customer_state=customer_state,
            customer_zipcode=customer_zipcode,
            title=payload.get("title") or title,
            description=payload.get("description"),
            tax_rate=payload.get("tax_rate") or company.default_tax_rate,
            tax_label=company.default_tax_label,
            notes=company.default_notes,
            terms=company.default_terms,
            created_by=user.id,
        )
        db.add(estimate)
        db.flush()

    for idx, section_data in enumerate(payload.get("sections", [])):
        section = EstimateSection(
            estimate_id=estimate.id,
            name=section_data.get("name", "General"),
            order_index=section_data.get("order_index", idx),
        )
        db.add(section)
        db.flush()

        for item_idx, item_data in enumerate(section_data.get("items", [])):
            quantity = Decimal(str(item_data.get("quantity", 1)))
            unit_price = Decimal(str(item_data.get("unit_price", 0)))
            db.add(EstimateItem(
                estimate_id=estimate.id,
                section_id=section.id,
                name=item_data.get("name", ""),
                description=item_data.get("description"),
                unit=item_data.get("unit"),
                quantity=quantity,
                unit_price=unit_price,
                total=quantity * unit_price,
                is_taxable=item_data.get("is_taxable", True),
                order_index=item_data.get("order_index", item_idx),
                notes=item_data.get("notes", []),
            ))

    db.commit()
    db.refresh(estimate)

    from app.domains.estimate.api import recalculate_estimate
    recalculate_estimate(estimate, db)
    return estimate, updated
