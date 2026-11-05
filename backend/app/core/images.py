"""
Scopit - Safe handling of uploaded images

Decoding an image costs width x height x 4 bytes no matter how small the
file is: a 1 MB PNG can declare 30000 x 30000 pixels and need gigabytes to
open. The API runs in a 512 MB container, so every user-supplied image is
size-checked from its header (cheap, no pixel data read) before anything
decodes it.

Importing this module also sets Pillow's global decompression-bomb ceiling,
as a backstop for any code path that opens an image without calling
check_image_bytes() first.
"""
import base64
import binascii
import io
import warnings
from dataclasses import dataclass
from typing import Iterable, Optional

from PIL import Image

# Uploaded photos: 40 MP covers phone cameras (12-48 MP) at full size.
MAX_UPLOAD_PIXELS = 40_000_000

# Global backstop. Pillow warns above MAX_IMAGE_PIXELS and raises above twice
# that; turning the warning into an error makes this a hard ceiling. 100 MP
# still fits a large-format PDF page rendered for thumbnails or flattening.
Image.MAX_IMAGE_PIXELS = 100_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)


class ImageRejected(ValueError):
    """The bytes are not an acceptable image. The message is safe to show users."""


@dataclass
class ImageInfo:
    format: str  # Pillow format name, e.g. "PNG", "JPEG"
    width: int
    height: int


def check_image_bytes(
    data: bytes,
    *,
    max_bytes: int,
    max_pixels: int = MAX_UPLOAD_PIXELS,
    allowed_formats: Optional[Iterable[str]] = None,
) -> ImageInfo:
    """Validate an image from its header without decoding pixels."""
    if not data:
        raise ImageRejected("The image is empty.")
    if len(data) > max_bytes:
        raise ImageRejected(
            f"The image is too large (max {max_bytes // (1024 * 1024) or 1} MB)."
        )
    try:
        with Image.open(io.BytesIO(data)) as im:
            fmt = (im.format or "").upper()
            width, height = im.size
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ImageRejected("The image has too many pixels.")
    except Exception:
        raise ImageRejected("The file is not a readable image.")

    if allowed_formats is not None:
        allowed = {f.upper() for f in allowed_formats}
        if fmt not in allowed:
            raise ImageRejected("This image type isn't supported.")
    if width <= 0 or height <= 0:
        raise ImageRejected("The file is not a readable image.")
    if width * height > max_pixels:
        raise ImageRejected(
            f"The image is too large ({width}x{height} pixels; "
            f"max {max_pixels // 1_000_000} megapixels)."
        )
    return ImageInfo(format=fmt, width=width, height=height)


def decode_data_url(value: str, *, max_bytes: int) -> bytes:
    """Decode a base64 image payload, given bare or as a data: URL.

    The length is checked before decoding so an oversized string is refused
    without allocating its decoded copy.
    """
    if not isinstance(value, str) or not value:
        raise ImageRejected("The image is empty.")
    payload = value.split(",", 1)[1] if value.startswith("data:") else value
    # base64 is 4 chars per 3 bytes.
    if len(payload) > (max_bytes * 4) // 3 + 4:
        raise ImageRejected(
            f"The image is too large (max {max_bytes // (1024 * 1024) or 1} MB)."
        )
    try:
        return base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError):
        raise ImageRejected("The image data is not valid base64.")
