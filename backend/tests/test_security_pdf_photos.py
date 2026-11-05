"""Large phone photos still convert to PDF; oversized non-JPEG images are refused."""
import io

import pytest
from fastapi import HTTPException
from PIL import Image

from app.domains.tools.modules.pdf_editor import service as svc


def _jpeg(w, h):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 50, 50)).save(buf, "JPEG", quality=30)
    return buf.getvalue()


def _png(w, h):
    buf = io.BytesIO()
    Image.new("1", (w, h)).save(buf, "PNG")
    return buf.getvalue()


def test_48mp_jpeg_is_accepted_and_decoded_small():
    data = _jpeg(8064, 6048)  # 48.8 MP, a full-resolution phone photo
    svc._check_photo_for_page(data, svc.MAX_IMAGE_FILE_SIZE, "photo.jpg")
    img = svc._load_page_image(io.BytesIO(data))
    assert max(img.size) <= svc.PAGE_IMAGE_MAX_PX
    assert img.mode == "RGB"


def test_huge_png_is_refused_before_decoding():
    with pytest.raises(HTTPException) as exc:
        svc._check_photo_for_page(_png(9000, 9000), svc.MAX_IMAGE_FILE_SIZE, "big.png")
    assert exc.value.status_code == 400


def test_non_image_is_refused():
    with pytest.raises(HTTPException):
        svc._check_photo_for_page(b"%!PS-Adobe-3.0 EPSF", svc.MAX_IMAGE_FILE_SIZE, "x.eps")
