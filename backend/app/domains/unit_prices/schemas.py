"""
What an estimate says about the prices it is priced with.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PriceBookSummary(BaseModel):
    id: str
    # When this set of prices first appeared
    priced_at: Optional[datetime] = None
    # Today's prices for the estimate's company are the same
    is_current: bool = True
