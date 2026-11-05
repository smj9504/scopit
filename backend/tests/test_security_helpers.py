"""
Unit tests for the shared security helpers (no database needed).
"""
import io
from types import SimpleNamespace

import pytest
from PIL import Image

from app.core import client_ip as client_ip_mod
from app.core.images import ImageRejected, check_image_bytes, decode_data_url
from app.core.pdf_generator import _data_url_only_fetcher
from app.core.rate_limit import SlidingWindowLimiter
from app.core.safe_text import content_disposition, excel_cell, html_text, rl_text
from app.core.security import create_oauth_code, password_problem, redeem_oauth_code
from app.core.storage import InvalidStorageKey, LocalStorage, validate_storage_key


@pytest.mark.parametrize("key", [
    "../etc/passwd", "a/../../b", "/etc/passwd", "a\\..\\b", "a//b", "..", "", "a/./b", "x\x00y",
])
def test_storage_rejects_escaping_keys(key, tmp_path):
    with pytest.raises(InvalidStorageKey):
        validate_storage_key(key)
    with pytest.raises(InvalidStorageKey):
        LocalStorage(str(tmp_path))._path(key)


def test_storage_accepts_normal_keys(tmp_path):
    store = LocalStorage(str(tmp_path))
    store.write("c1/packing/photos/abc.jpg", b"x")
    assert store.read("c1/packing/photos/abc.jpg") == b"x"


def _png(w, h, mode="RGB"):
    buf = io.BytesIO()
    Image.new(mode, (w, h)).save(buf, "PNG")
    return buf.getvalue()


def test_image_checks():
    assert check_image_bytes(_png(10, 10), max_bytes=10_000).format == "PNG"
    with pytest.raises(ImageRejected):
        check_image_bytes(_png(9000, 9000, "1"), max_bytes=10_000_000)  # 81 MP from ~10 KB
    with pytest.raises(ImageRejected):
        check_image_bytes(b"<svg onload=alert(1)>", max_bytes=1000)
    with pytest.raises(ImageRejected):
        check_image_bytes(_png(10, 10), max_bytes=10_000, allowed_formats={"JPEG"})
    with pytest.raises(ImageRejected):
        decode_data_url("data:image/png;base64," + "A" * 10_000, max_bytes=1000)


def test_text_escaping():
    assert html_text('<a href="x">') == "&lt;a href=&quot;x&quot;&gt;"
    assert html_text(None) == ""
    assert rl_text('<img src="/etc/x"/>') == "&lt;img src=&quot;/etc/x&quot;/&gt;"
    assert excel_cell("=HYPERLINK(\"x\")").startswith("'")
    assert excel_cell("+1 555 0100") == "+1 555 0100"  # stored as text, never evaluated
    assert excel_cell("-12.5") == "-12.5"
    assert excel_cell(42) == 42


def test_content_disposition_handles_quotes_and_korean():
    header = content_disposition('견적서 "최종".pdf')
    header.encode("latin-1")  # must be a valid header value
    assert 'filename="' in header and "filename*=UTF-8''" in header
    assert '"최종"' not in header


def test_pdf_fetcher_only_allows_inline_data():
    for url in ["http://169.254.169.254/latest/", "https://example.com/x.png", "file:///etc/passwd"]:
        with pytest.raises(ValueError):
            _data_url_only_fetcher(url)


def test_sliding_window_limiter():
    lim = SlidingWindowLimiter()
    assert [lim.hit("k", 3, 60) == 0 for _ in range(4)] == [True, True, True, False]
    assert lim.hit("other", 3, 60) == 0


def test_password_rules():
    assert password_problem("short")
    assert password_problem("x" * 73)
    assert password_problem("long enough pass") is None


def test_oauth_code_is_bound_to_state_and_single_use():
    code = create_oauth_code("user-1", "a" * 32)
    assert redeem_oauth_code(code, "b" * 32) is None
    assert redeem_oauth_code(code, "a" * 32) == "user-1"
    assert redeem_oauth_code(code, "a" * 32) is None


def _request(headers, peer="10.0.0.1"):
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=peer))


def test_client_ip(monkeypatch):
    monkeypatch.setattr(client_ip_mod.settings, "CLIENT_IP_HEADER", "")
    monkeypatch.setattr(client_ip_mod.settings, "TRUSTED_PROXY_HOPS", 0)
    # Default: the socket peer; a client-sent X-Forwarded-For is ignored
    assert client_ip_mod.get_client_ip(_request({"X-Forwarded-For": "1.2.3.4"})) == "10.0.0.1"

    monkeypatch.setattr(client_ip_mod.settings, "TRUSTED_PROXY_HOPS", 1)
    # One trusted proxy: the entry it appended (rightmost), not the spoofed leftmost
    assert client_ip_mod.get_client_ip(_request({"X-Forwarded-For": "6.6.6.6, 5.5.5.5"})) == "5.5.5.5"

    monkeypatch.setattr(client_ip_mod.settings, "CLIENT_IP_HEADER", "True-Client-IP")
    assert client_ip_mod.get_client_ip(_request({"True-Client-IP": "7.7.7.7",
                                                  "X-Forwarded-For": "6.6.6.6, 5.5.5.5"})) == "7.7.7.7"
    # Garbage in the header falls back
    assert client_ip_mod.get_client_ip(_request({"True-Client-IP": "not-an-ip",
                                                  "X-Forwarded-For": "5.5.5.5"})) == "5.5.5.5"


def test_request_body_ceiling():
    from fastapi import FastAPI, Request
    from fastapi.testclient import TestClient

    from main import BodySizeLimitMiddleware

    tiny = FastAPI()

    @tiny.post("/echo")
    async def echo(request: Request):
        return {"n": len(await request.body())}

    tiny.add_middleware(BodySizeLimitMiddleware, max_bytes=100)
    c = TestClient(tiny)
    assert c.post("/echo", content=b"x" * 50).json() == {"n": 50}
    assert c.post("/echo", content=b"x" * 500).status_code == 413

    def chunks():  # no Content-Length: counted as it streams
        for _ in range(10):
            yield b"x" * 50

    assert c.post("/echo", content=chunks()).status_code == 413
