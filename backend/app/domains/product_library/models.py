"""
Scopit - Product library

Products from retailers (a cabinet line, a faucet, a tile...) kept once for
the whole company, so a Cabinet or Bathroom Estimator upgrade option can be built from
things the customer can buy and see.

An estimate never points at a product live: it copies what it uses (see
schemas.ProductSnapshot), so a later change to the library doesn't move an
estimate already sent. Ported from MJ Estimate's product_library.
"""
from sqlalchemy import JSON, Boolean, Column, Float, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.sql import func

from app.common.utils import generate_uuid
from app.core.database import Base


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        Index("ix_products_company_category", "company_id", "category"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    company_id = Column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False,
    )
    created_by_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )

    # catalog.CATEGORIES key
    category = Column(String(40), nullable=False)
    title = Column(String(300), nullable=False)
    brand = Column(String(120), nullable=True)
    model_number = Column(String(120), nullable=True)
    # The retailer's own item number (Home Depot "Internet #", Lowe's "Item #", …)
    sku = Column(String(120), nullable=True)
    # Colour / finish as sold: "Brushed Nickel", "White Shaker", "Calacatta Gold"
    finish = Column(String(160), nullable=True)
    description = Column(Text, nullable=True)

    # catalog.RETAILERS key, and the page the product was read from
    retailer = Column(String(40), nullable=False, default="other")
    source_url = Column(Text, nullable=True)

    # Price as sold, in a catalog.PRICE_UNITS unit; a box of tile also says
    # how many square feet it covers.
    price = Column(Numeric(10, 2), nullable=True)
    price_unit = Column(String(10), nullable=False, default="each")
    box_sf = Column(Float, nullable=True)

    # Real size, inches: width (left to right), depth (front to back), height.
    width_in = Column(Float, nullable=True)
    depth_in = Column(Float, nullable=True)
    height_in = Column(Float, nullable=True)
    # A tile's (or plank's) own size, inches, e.g. 3 × 12 for subway.
    tile_width_in = Column(Float, nullable=True)
    tile_length_in = Column(Float, nullable=True)

    # Stored copies of its pictures (file ids, see service.py); the first is the main one.
    image_file_ids = Column(JSON, nullable=False, default=list)
    # A flat, square-on picture of its surface (tile, stone, wood) the 3D view lays as a texture.
    swatch_file_id = Column(String(200), nullable=True)

    # How it looks, for the drawings: {"color": "#2c3a50", "material": "quartz",
    # "door_style": "shaker", "hardware_style": "bar", "sink_type": "farmhouse", "bowls": 1, …}
    look = Column(JSON, nullable=False, default=dict)
    # Anything else read off the listing worth keeping (weight, collection, warranty…)
    specs = Column(JSON, nullable=False, default=dict)

    is_archived = Column(Boolean, nullable=False, default=False)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())
