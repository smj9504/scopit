"""
Scopit - Product library service

Keeping a company's products, their pictures, and reading new ones off
retailer listings. Every query is limited to one company.

Pictures are fetched from the retailer once and kept as our own files, so
the library doesn't break when a retailer moves an image, and the 3D view
can load them from our own server. A picture's file id is
"<product id>/<random>.<ext>"; it is stored at
"<company id>/products/<file id>", so an id can only ever reach the
company's own pictures.
"""
import asyncio
import logging
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.images import ImageRejected, check_image_bytes
from app.core.storage import get_storage

from . import extract
from .catalog import CATEGORIES, retailer_of
from .fetch import MAX_IMAGE_BYTES, MAX_PAGE_BYTES, FetchError, fetch, page_fields, parse_page
from .models import Product
from .schemas import ProductCreate, ProductDraft, ProductSnapshot, ProductUpdate

logger = logging.getLogger(__name__)

# Pillow format -> (media type, file extension)
IMAGE_FORMATS = {
    "JPEG": ("image/jpeg", ".jpg"),
    "MPO": ("image/jpeg", ".jpg"),
    "PNG": ("image/png", ".png"),
    "WEBP": ("image/webp", ".webp"),
    "GIF": ("image/gif", ".gif"),
}
MEDIA_TYPE_BY_EXT = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}
# A product picture: no phone-camera originals here, so 25 MP is plenty.
MAX_IMAGE_PIXELS = 25_000_000

FILE_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\.(jpg|png|webp|gif)$")


class ProductError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def image_key(company_id, file_id: str) -> Optional[str]:
    """The storage key of one of the company's product pictures; None for an id that isn't one."""
    if not isinstance(file_id, str) or not FILE_ID_RE.match(file_id):
        return None
    return f"{company_id}/products/{file_id}"


def media_type_for(file_id: str) -> str:
    return MEDIA_TYPE_BY_EXT.get(file_id.rsplit(".", 1)[-1].lower(), "application/octet-stream")


class ProductService:
    def __init__(self, db: Session, company_id):
        self.db = db
        self.company_id = company_id

    # ── Reading ──

    def list(
        self,
        q: Optional[str] = None,
        category: Optional[str] = None,
        trade: Optional[str] = None,
        include_archived: bool = False,
        limit: int = 60,
        offset: int = 0,
    ) -> Tuple[List[Product], int]:
        query = self.db.query(Product).filter(Product.company_id == self.company_id)
        if not include_archived:
            query = query.filter(Product.is_archived.is_(False))
        if category:
            query = query.filter(Product.category == category)
        elif trade:
            keys = [k for k, v in CATEGORIES.items() if v["trade"] in (trade, "both")]
            query = query.filter(Product.category.in_(keys))
        if q:
            like = f"%{q.strip()}%"
            query = query.filter(
                or_(
                    Product.title.ilike(like),
                    Product.brand.ilike(like),
                    Product.model_number.ilike(like),
                    Product.sku.ilike(like),
                    Product.finish.ilike(like),
                )
            )
        total = query.count()
        items = (
            query.order_by(Product.updated_at.desc().nullslast(), Product.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return items, total

    def get(self, product_id: UUID) -> Product:
        product = (
            self.db.query(Product)
            .filter(Product.id == product_id, Product.company_id == self.company_id)
            .first()
        )
        if not product:
            raise ProductError("Product not found", status=404)
        return product

    # ── Writing ──

    def _own_image_ids(self, product_id: UUID, ids: List[str]) -> List[str]:
        """Only ids of this product's own stored pictures may be kept on it."""
        prefix = f"{product_id}/"
        return [i for i in ids if image_key(self.company_id, i) and i.startswith(prefix)]

    async def create(self, data: ProductCreate, user_id: Optional[UUID]) -> Product:
        fields = data.model_dump(exclude={"image_urls", "image_file_ids", "swatch_file_id"})
        fields["retailer"] = fields.get("retailer") or retailer_of(fields.get("source_url"))
        product = Product(**fields, company_id=self.company_id, created_by_id=user_id, image_file_ids=[])
        self.db.add(product)
        # An id to file its pictures under.
        self.db.flush()
        product.image_file_ids = await self._keep_images(product.id, data.image_urls)
        self.db.flush()
        return product

    async def update(self, product_id: UUID, data: ProductUpdate) -> Product:
        product = self.get(product_id)
        sent = data.model_dump(exclude_unset=True, exclude={"image_urls", "image_file_ids", "swatch_file_id"})
        for key, value in sent.items():
            setattr(product, key, value)
        if "source_url" in sent and "retailer" not in sent:
            product.retailer = retailer_of(product.source_url)
        if "swatch_file_id" in data.model_fields_set:
            swatch = data.swatch_file_id
            product.swatch_file_id = swatch if (swatch and self._own_image_ids(product.id, [swatch])) else None
        if data.image_file_ids is not None:
            images = self._own_image_ids(product.id, list(data.image_file_ids))
        else:
            images = list(product.image_file_ids or [])
        images += await self._keep_images(product.id, data.image_urls)
        product.image_file_ids = images
        self.db.flush()
        return product

    def archive(self, product_id: UUID) -> None:
        self.get(product_id).is_archived = True
        self.db.flush()

    async def keep_upload(self, product_id: UUID, data: bytes, filename: str, as_swatch: bool) -> Product:
        """A picture uploaded by hand: added to the product's pictures, or made its texture swatch."""
        product = self.get(product_id)
        try:
            file_id = await asyncio.to_thread(self._store, product.id, data)
        except ImageRejected as e:
            raise ProductError(str(e))
        if as_swatch:
            product.swatch_file_id = file_id
        else:
            product.image_file_ids = list(product.image_file_ids or []) + [file_id]
        self.db.flush()
        return product

    async def _keep_images(self, product_id: UUID, urls: List[str]) -> List[str]:
        """Fetch each picture and keep a copy; one that can't be had is skipped, not fatal."""
        kept: List[str] = []
        for url in urls:
            try:
                final_url, content_type, body = await asyncio.to_thread(fetch, url, MAX_IMAGE_BYTES)
            except FetchError as e:
                logger.warning("Product picture %s not kept: %s", url, e)
                continue
            content_type = content_type.split(";")[0].strip().lower()
            if not content_type.startswith("image/"):
                guessed = mimetypes.guess_type(urlparse(final_url).path)[0] or ""
                if not guessed.startswith("image/"):
                    logger.warning("Product picture %s not kept: %s is not an image", url, content_type)
                    continue
            try:
                kept.append(await asyncio.to_thread(self._store, product_id, body))
            except ImageRejected as e:
                logger.warning("Product picture %s not kept: %s", url, e)
        return kept

    def _store(self, product_id: UUID, data: bytes) -> str:
        """Check a picture from its header and keep it; its file id. Raises ImageRejected."""
        info = check_image_bytes(
            data,
            max_bytes=MAX_IMAGE_BYTES,
            max_pixels=MAX_IMAGE_PIXELS,
            allowed_formats=IMAGE_FORMATS.keys(),
        )
        media_type, ext = IMAGE_FORMATS[info.format]
        file_id = f"{product_id}/{uuid.uuid4().hex}{ext}"
        get_storage().write(image_key(self.company_id, file_id), data, media_type)
        return file_id

    # ── Reading listings ──

    def draft_from_url(self, url: str) -> ProductDraft:
        """Read a product off its page, fetched by the server: most big retailers turn that away (see draft_from_html)."""
        try:
            final_url, content_type, body = fetch(url, MAX_PAGE_BYTES)
        except FetchError as e:
            return ProductDraft(fields={"source_url": url, "retailer": retailer_of(url)}, blocked=e.blocked, note=str(e))
        if "html" not in content_type.lower():
            return ProductDraft(fields={"source_url": url, "retailer": retailer_of(url)}, note="That link isn't a web page")
        return self.draft_from_html(body.decode("utf-8", errors="replace"), url, final_url)

    def draft_from_html(self, html: str, url: str, final_url: Optional[str] = None) -> ProductDraft:
        """
        Read a product off a page's HTML: what the page states as data, and
        Claude's read of its text. The HTML comes from the server's own fetch,
        or from the person's browser (the library's bookmarklet), which the
        retailers don't turn away.
        """
        page = parse_page(html, final_url or url)
        base = {"source_url": url, "retailer": retailer_of(final_url or url)}
        if page.blocked:
            return ProductDraft(fields=base, blocked=True, note="The site showed a bot check instead of the product")
        stated, images = page_fields(page)
        try:
            read = extract.read_page(page, stated)
        except Exception as e:
            # What the page states is still worth having.
            logger.warning("Product page read failed for %s: %s", url, e)
            return ProductDraft(
                fields={**base, **extract.merge_fields(stated, {})},
                image_urls=images,
                note="Read only the page's own data; the AI read didn't work this time.",
            )
        return ProductDraft(fields={**base, **extract.merge_fields(stated, read)}, image_urls=images)

    def draft_from_screenshot(self, image: bytes, media_type: str, url: Optional[str]) -> ProductDraft:
        if media_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
            raise ProductError("A screenshot must be a JPEG, PNG, WebP or GIF")
        try:
            check_image_bytes(image, max_bytes=MAX_IMAGE_BYTES, allowed_formats=IMAGE_FORMATS.keys())
        except ImageRejected as e:
            raise ProductError(str(e))
        try:
            read = extract.read_screenshot(image, media_type, url)
        except Exception as e:
            logger.warning("Product screenshot read failed: %s", e)
            raise ProductError("Couldn't read the screenshot. Try again, or enter the details by hand.", status=502)
        fields = extract.merge_fields({}, read)
        if url:
            fields.update({"source_url": url, "retailer": retailer_of(url)})
        return ProductDraft(fields=fields)


def snapshot(product: Product) -> ProductSnapshot:
    """What an estimate keeps of a product it uses: a copy, taken now."""
    return ProductSnapshot(
        product_id=product.id,
        category=product.category,
        title=product.title,
        brand=product.brand,
        model_number=product.model_number,
        sku=product.sku,
        finish=product.finish,
        retailer=product.retailer,
        source_url=product.source_url,
        price=product.price,
        price_unit=product.price_unit,
        box_sf=product.box_sf,
        width_in=product.width_in,
        depth_in=product.depth_in,
        height_in=product.height_in,
        tile_width_in=product.tile_width_in,
        tile_length_in=product.tile_length_in,
        image_file_ids=list(product.image_file_ids or []),
        swatch_file_id=product.swatch_file_id,
        look=dict(product.look or {}),
        taken_at=datetime.now(timezone.utc),
    )


def image_bytes(db: Session, company_id, file_id: Optional[str]) -> Optional[bytes]:
    """A stored product picture's bytes, for a PDF.

    None when it's gone or can't be read: a picture is never worth failing
    the document over.
    """
    key = image_key(company_id, file_id) if file_id else None
    if not key:
        return None
    try:
        return get_storage().read(key)
    except Exception as e:
        logger.warning("Product picture %s not read: %s", file_id, e)
        return None
