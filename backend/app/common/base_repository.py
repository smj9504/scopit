"""
Scopit - Base Repository
"""
from typing import Generic, List, Optional, Type, TypeVar
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.database import Base

ModelType = TypeVar("ModelType", bound=Base)


class BaseRepository(Generic[ModelType]):
    """Base repository with common CRUD operations"""
    
    def __init__(self, db: Session, model: Type[ModelType]):
        self.db = db
        self.model = model
    
    def get_by_id(self, id: UUID) -> Optional[ModelType]:
        """Get single record by ID"""
        return self.db.query(self.model).filter(self.model.id == id).first()
    
    def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
        **filters
    ) -> List[ModelType]:
        """Get filtered list of records"""
        query = self.db.query(self.model)
        
        for key, value in filters.items():
            if value is not None and hasattr(self.model, key):
                query = query.filter(getattr(self.model, key) == value)
        
        return query.offset(skip).limit(limit).all()
    
    def create(self, obj_in: dict) -> ModelType:
        """Create new record"""
        db_obj = self.model(**obj_in)
        self.db.add(db_obj)
        self.db.commit()
        self.db.refresh(db_obj)
        return db_obj
    
    def update(self, id: UUID, obj_in: dict) -> Optional[ModelType]:
        """Update existing record"""
        db_obj = self.get_by_id(id)
        if not db_obj:
            return None
        
        for key, value in obj_in.items():
            if hasattr(db_obj, key):
                setattr(db_obj, key, value)
        
        self.db.commit()
        self.db.refresh(db_obj)
        return db_obj
    
    def delete(self, id: UUID) -> bool:
        """Hard delete record"""
        db_obj = self.get_by_id(id)
        if not db_obj:
            return False
        
        self.db.delete(db_obj)
        self.db.commit()
        return True
    
    def soft_delete(self, id: UUID) -> bool:
        """Soft delete (set is_active = False)"""
        db_obj = self.get_by_id(id)
        if not db_obj or not hasattr(db_obj, 'is_active'):
            return False
        
        db_obj.is_active = False
        self.db.commit()
        return True
    
    def count(self, **filters) -> int:
        """Count records with filters"""
        query = self.db.query(self.model)
        
        for key, value in filters.items():
            if value is not None and hasattr(self.model, key):
                query = query.filter(getattr(self.model, key) == value)
        
        return query.count()
    
    def exists(self, **filters) -> bool:
        """Check if record exists"""
        return self.count(**filters) > 0
