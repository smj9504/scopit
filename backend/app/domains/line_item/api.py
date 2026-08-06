"""
Scopit - Line Item API Routes
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import Optional, List
from uuid import UUID

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.domains.user.models import User
from app.domains.line_item.models import LineItem, LineItemNote, LineItemVisibility
from app.domains.line_item.schemas import (
    LineItemCreate,
    LineItemUpdate,
    LineItemResponse,
    LineItemListResponse,
    LineItemNoteCreate,
    LineItemNoteUpdate,
    LineItemNoteResponse,
)


router = APIRouter()


# ===================
# Helper Functions
# ===================

def get_line_item_or_404(
    line_item_id: str,
    current_user: User,
    db: Session,
    require_write_access: bool = False,
) -> LineItem:
    """Get line item with access check"""
    line_item = db.query(LineItem).filter(LineItem.id == line_item_id).first()

    if not line_item:
        raise HTTPException(status_code=404, detail="Line item not found")

    # Check access - company items visible to all in company, private only to creator
    if line_item.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if line_item.visibility == LineItemVisibility.PRIVATE:
        if line_item.created_by != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied to private item")

    if require_write_access:
        # Only creator can edit/delete
        if line_item.created_by != current_user.id:
            raise HTTPException(status_code=403, detail="Only creator can modify this item")

    return line_item


def serialize_line_item(line_item: LineItem) -> dict:
    """Serialize line item with UUID conversion"""
    return {
        "id": str(line_item.id),
        "code": line_item.code,
        "name": line_item.name,
        "includes": line_item.includes,
        "unit": line_item.unit,
        "unit_price": float(line_item.unit_price) if line_item.unit_price else 0,
        "cat": line_item.cat,
        "is_taxable": line_item.is_taxable,
        "visibility": line_item.visibility.value if hasattr(line_item.visibility, 'value') else line_item.visibility,
        "company_id": str(line_item.company_id),
        "created_by": str(line_item.created_by),
        "tool_id": line_item.tool_id,
        "is_active": line_item.is_active,
        "created_at": line_item.created_at,
        "updated_at": line_item.updated_at,
        "notes": [
            {
                "id": str(note.id),
                "content": note.content,
                "order_index": note.order_index,
                "created_at": note.created_at,
            }
            for note in line_item.notes
        ],
    }


# ===================
# Line Item CRUD
# ===================

@router.get("", response_model=LineItemListResponse)
async def list_line_items(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    search: Optional[str] = None,
    category: Optional[str] = None,
    visibility: Optional[str] = None,
    is_active: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List line items accessible to user"""
    # Base query - company items + user's private items
    # Exclude tool-managed items (e.g. packing) from the general list
    query = db.query(LineItem).filter(
        LineItem.company_id == current_user.company_id,
        LineItem.is_active == is_active,
        LineItem.tool_id.is_(None),
        or_(
            LineItem.visibility == LineItemVisibility.COMPANY,
            and_(
                LineItem.visibility == LineItemVisibility.PRIVATE,
                LineItem.created_by == current_user.id,
            )
        )
    )

    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            or_(
                LineItem.name.ilike(search_pattern),
                LineItem.code.ilike(search_pattern),
                LineItem.includes.ilike(search_pattern),
            )
        )

    if category:
        query = query.filter(LineItem.cat == category)

    if visibility:
        query = query.filter(LineItem.visibility == visibility)

    total = query.count()
    line_items = query.order_by(LineItem.name).offset(skip).limit(limit).all()

    return LineItemListResponse(
        items=[LineItemResponse(**serialize_line_item(item)) for item in line_items],
        total=total,
        page=skip // limit + 1,
        page_size=limit,
    )


@router.post("", response_model=LineItemResponse, status_code=status.HTTP_201_CREATED)
async def create_line_item(
    data: LineItemCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create new line item"""
    # Create line item
    line_item = LineItem(
        company_id=current_user.company_id,
        created_by=current_user.id,
        code=data.code,
        name=data.name,
        includes=data.includes,
        unit=data.unit,
        unit_price=data.unit_price,
        cat=data.cat,
        is_taxable=data.is_taxable,
        visibility=LineItemVisibility(data.visibility),
    )
    db.add(line_item)
    db.flush()

    # Create notes if provided
    if data.notes:
        for note_data in data.notes:
            note = LineItemNote(
                line_item_id=line_item.id,
                content=note_data.content,
                order_index=note_data.order_index,
            )
            db.add(note)

    db.commit()
    db.refresh(line_item)

    return LineItemResponse(**serialize_line_item(line_item))


@router.get("/{line_item_id}", response_model=LineItemResponse)
async def get_line_item(
    line_item_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get single line item"""
    line_item = get_line_item_or_404(line_item_id, current_user, db)
    return LineItemResponse(**serialize_line_item(line_item))


@router.put("/{line_item_id}", response_model=LineItemResponse)
async def update_line_item(
    line_item_id: str,
    data: LineItemUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update line item"""
    line_item = get_line_item_or_404(line_item_id, current_user, db, require_write_access=True)

    update_data = data.model_dump(exclude_unset=True)

    # Protect code field for tool-managed items (code is the mapping key)
    if line_item.tool_id and "code" in update_data:
        del update_data["code"]

    for field, value in update_data.items():
        if field == "visibility" and value:
            value = LineItemVisibility(value)
        setattr(line_item, field, value)

    db.commit()
    db.refresh(line_item)

    return LineItemResponse(**serialize_line_item(line_item))


@router.delete("/{line_item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_line_item(
    line_item_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete line item (soft delete)"""
    line_item = get_line_item_or_404(line_item_id, current_user, db, require_write_access=True)

    # Soft delete
    line_item.is_active = False
    db.commit()


@router.post("/{line_item_id}/duplicate", response_model=LineItemResponse)
async def duplicate_line_item(
    line_item_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Duplicate line item"""
    original = get_line_item_or_404(line_item_id, current_user, db)

    # Create copy
    new_item = LineItem(
        company_id=current_user.company_id,
        created_by=current_user.id,
        code=f"{original.code}-copy" if original.code else None,
        name=f"{original.name} (Copy)",
        includes=original.includes,
        unit=original.unit,
        unit_price=original.unit_price,
        cat=original.cat,
        is_taxable=original.is_taxable,
        visibility=LineItemVisibility.PRIVATE,  # Always private for copies
    )
    db.add(new_item)
    db.flush()

    # Copy notes
    for note in original.notes:
        new_note = LineItemNote(
            line_item_id=new_item.id,
            content=note.content,
            order_index=note.order_index,
        )
        db.add(new_note)

    db.commit()
    db.refresh(new_item)

    return LineItemResponse(**serialize_line_item(new_item))


# ===================
# Line Item Notes CRUD
# ===================

@router.get("/{line_item_id}/notes", response_model=List[LineItemNoteResponse])
async def list_notes(
    line_item_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List notes for a line item"""
    line_item = get_line_item_or_404(line_item_id, current_user, db)

    return [
        LineItemNoteResponse(
            id=str(note.id),
            content=note.content,
            order_index=note.order_index,
            created_at=note.created_at,
        )
        for note in line_item.notes
    ]


@router.post("/{line_item_id}/notes", response_model=LineItemNoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(
    line_item_id: str,
    data: LineItemNoteCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add note to line item"""
    line_item = get_line_item_or_404(line_item_id, current_user, db, require_write_access=True)

    note = LineItemNote(
        line_item_id=line_item.id,
        content=data.content,
        order_index=data.order_index,
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    return LineItemNoteResponse(
        id=str(note.id),
        content=note.content,
        order_index=note.order_index,
        created_at=note.created_at,
    )


@router.put("/{line_item_id}/notes/{note_id}", response_model=LineItemNoteResponse)
async def update_note(
    line_item_id: str,
    note_id: str,
    data: LineItemNoteUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update note"""
    line_item = get_line_item_or_404(line_item_id, current_user, db, require_write_access=True)

    note = db.query(LineItemNote).filter(
        LineItemNote.id == note_id,
        LineItemNote.line_item_id == line_item.id,
    ).first()

    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(note, field, value)

    db.commit()
    db.refresh(note)

    return LineItemNoteResponse(
        id=str(note.id),
        content=note.content,
        order_index=note.order_index,
        created_at=note.created_at,
    )


@router.delete("/{line_item_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    line_item_id: str,
    note_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete note"""
    line_item = get_line_item_or_404(line_item_id, current_user, db, require_write_access=True)

    note = db.query(LineItemNote).filter(
        LineItemNote.id == note_id,
        LineItemNote.line_item_id == line_item.id,
    ).first()

    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    db.delete(note)
    db.commit()


@router.put("/{line_item_id}/notes/reorder")
async def reorder_notes(
    line_item_id: str,
    note_ids: List[str],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reorder notes"""
    line_item = get_line_item_or_404(line_item_id, current_user, db, require_write_access=True)

    for index, note_id in enumerate(note_ids):
        db.query(LineItemNote).filter(
            LineItemNote.id == note_id,
            LineItemNote.line_item_id == line_item.id,
        ).update({"order_index": index})

    db.commit()

    return {"message": "Notes reordered"}


# ===================
# Bulk Notes Operations
# ===================

@router.put("/{line_item_id}/notes/bulk", response_model=List[LineItemNoteResponse])
async def bulk_update_notes(
    line_item_id: str,
    notes: List[LineItemNoteCreate],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace all notes with new set"""
    line_item = get_line_item_or_404(line_item_id, current_user, db, require_write_access=True)

    # Delete existing notes
    db.query(LineItemNote).filter(LineItemNote.line_item_id == line_item.id).delete()

    # Create new notes
    new_notes = []
    for note_data in notes:
        note = LineItemNote(
            line_item_id=line_item.id,
            content=note_data.content,
            order_index=note_data.order_index,
        )
        db.add(note)
        new_notes.append(note)

    db.commit()

    # Refresh to get IDs
    for note in new_notes:
        db.refresh(note)

    return [
        LineItemNoteResponse(
            id=str(note.id),
            content=note.content,
            order_index=note.order_index,
            created_at=note.created_at,
        )
        for note in new_notes
    ]
