"""
Scopit - Packing photo validation

Every photo a caller hands the packing tool (signed-in uploads and analysis,
the public lead form, the public demo report) is checked here before any
code decodes it. The check reads only the image header (see
app/core/images.py), so a small file that declares a huge pixel count is
refused before it can exhaust memory, and only the photo formats the tool
actually handles are accepted.
"""
from typing import Tuple

from app.core.images import (
    ImageInfo,
    ImageRejected,
    check_image_bytes,
    decode_data_url,
)

# Pillow format name -> (media type, storage file extension)
PHOTO_FORMATS = {
    "JPEG": ("image/jpeg", ".jpg"),
    # Many phone cameras write multi-picture JPEGs, which Pillow reports as MPO.
    "MPO": ("image/jpeg", ".jpg"),
    "PNG": ("image/png", ".png"),
    "WEBP": ("image/webp", ".webp"),
    "GIF": ("image/gif", ".gif"),
    "HEIF": ("image/heic", ".heic"),
}

# Storage extension -> media type, for serving/reading stored photos.
MEDIA_TYPE_BY_EXT = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
    "heic": "image/heic",
}

_heif_registered = False


def _ensure_heif_opener() -> None:
    """Let Pillow read HEIC/HEIF (iPhone photos) when pillow-heif is installed."""
    global _heif_registered
    if _heif_registered:
        return
    try:
        import pillow_heif

        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    _heif_registered = True


def check_photo(data: bytes, *, max_bytes: int, max_pixels: int = None) -> ImageInfo:
    """Validate photo bytes from the header. Raises ImageRejected."""
    _ensure_heif_opener()
    kwargs = {"max_bytes": max_bytes, "allowed_formats": PHOTO_FORMATS.keys()}
    if max_pixels is not None:
        kwargs["max_pixels"] = max_pixels
    return check_image_bytes(data, **kwargs)


def decode_photo(value: str, *, max_bytes: int) -> Tuple[bytes, ImageInfo]:
    """Decode a base64 / data: URL photo and validate it. Raises ImageRejected."""
    data = decode_data_url(value, max_bytes=max_bytes)
    return data, check_photo(data, max_bytes=max_bytes)


def media_type_for(info: ImageInfo) -> str:
    return PHOTO_FORMATS.get(info.format, ("image/jpeg", ".jpg"))[0]


def extension_for(info: ImageInfo) -> str:
    return PHOTO_FORMATS.get(info.format, ("image/jpeg", ".jpg"))[1]


def media_type_for_key(key: str) -> str:
    ext = key.rsplit(".", 1)[-1].lower() if "." in key else "jpg"
    return MEDIA_TYPE_BY_EXT.get(ext, "image/jpeg")


__all__ = [
    "ImageRejected",
    "PHOTO_FORMATS",
    "check_photo",
    "decode_photo",
    "extension_for",
    "media_type_for",
    "media_type_for_key",
]
