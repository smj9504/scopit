"""The cabinet sketch AI photo: what goes to the image model and what comes back."""

import base64
import io

import httpx
import pytest
from PIL import Image

from app.core.config import settings
from app.domains.tools.modules.cabinet_estimate import sketch_ai_photo
from app.domains.tools.modules.cabinet_estimate.sketch_ai_photo import AiPhotoError, build_prompt, make_photo


def _render(width=1600, height=746):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(buf, "JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


class _Answer:
    """Stands in for httpx.Client, answering every post with `response` and keeping what was sent."""

    def __init__(self, response):
        self.response = response
        self.sent = None

    def __call__(self, timeout=None):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, url, json=None, headers=None):
        self.sent = {"url": url, "json": json, "headers": headers}
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


@pytest.fixture
def gemini(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "CABINET_AI_PHOTO_MODEL", "test-image-model")

    def answer(response):
        client = _Answer(response)
        monkeypatch.setattr(sketch_ai_photo.httpx, "Client", client)
        return client

    return answer


def _picture(mime="image/png", data="cGljdHVyZQ=="):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": mime, "data": data}}]}}]})


def test_sends_the_render_with_the_finish_and_nearest_proportions(gemini):
    client = gemini(_picture())
    image, model = make_photo(_render(), "navy painted shaker cabinets", "subway tile backsplash")

    assert image == "data:image/png;base64,cGljdHVyZQ=="
    assert model == "test-image-model"
    assert client.sent["url"].endswith("/test-image-model:generateContent")
    # The key travels in a header, never in the URL.
    assert client.sent["headers"] == {"x-goog-api-key": "test-key"}
    assert "test-key" not in client.sent["url"]
    text, picture = client.sent["json"]["contents"][0]["parts"]
    assert "navy painted shaker cabinets" in text["text"]
    assert "subway tile backsplash" in text["text"]
    assert picture["inlineData"]["mimeType"] == "image/jpeg"
    config = client.sent["json"]["generationConfig"]
    assert config["responseModalities"] == ["IMAGE"]
    # 1600 × 746 is 2.14 wide: nearest offered is 21:9 (2.33) over 16:9 (1.78).
    assert config["imageConfig"]["aspectRatio"] == "21:9"


def test_a_bare_base64_render_is_taken_as_jpeg(gemini):
    client = gemini(_picture())
    make_photo(_render(1200, 900).split(",", 1)[1], "")
    assert client.sent["json"]["contents"][0]["parts"][1]["inlineData"]["mimeType"] == "image/jpeg"
    assert client.sent["json"]["generationConfig"]["imageConfig"]["aspectRatio"] == "4:3"


def test_without_a_finish_the_prompt_keeps_the_render_colours():
    assert "the colours and materials shown in the render" in build_prompt("  ", None)
    assert "Also, as asked" not in build_prompt("white", "")


def test_no_key_is_a_setup_error(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    with pytest.raises(AiPhotoError) as e:
        make_photo(_render(), "white")
    assert e.value.status == 503


def test_a_render_that_is_not_an_image_is_refused_before_calling(gemini):
    client = gemini(_picture())
    with pytest.raises(AiPhotoError) as e:
        make_photo("data:image/jpeg;base64," + base64.b64encode(b"not an image").decode(), "white")
    assert e.value.status == 400
    assert client.sent is None
    with pytest.raises(AiPhotoError) as e:
        make_photo("data:text/html;base64,PGI+", "white")
    assert e.value.status == 400


def test_the_models_refusal_is_passed_on(gemini):
    gemini(httpx.Response(402, json={"error": {"message": "Your prepayment credits are depleted."}}))
    with pytest.raises(AiPhotoError) as e:
        make_photo(_render(), "white")
    assert e.value.status == 502
    assert "402" in str(e.value) and "credits are depleted" in str(e.value)


def test_an_answer_without_a_picture_says_why(gemini):
    gemini(httpx.Response(200, json={"candidates": [{"finishReason": "IMAGE_SAFETY", "content": {"parts": [{"text": "I can't."}]}}]}))
    with pytest.raises(AiPhotoError) as e:
        make_photo(_render(), "white")
    assert "IMAGE_SAFETY" in str(e.value) and "I can't." in str(e.value)


def test_a_slow_model_is_a_timeout(gemini):
    gemini(httpx.ReadTimeout("slow"))
    with pytest.raises(AiPhotoError) as e:
        make_photo(_render(), "white")
    assert e.value.status == 504
