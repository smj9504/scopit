"""
Cabinet sketch "AI photo": the 3D view's realistic render, redrawn by a
Gemini image model as a photo of the finished kitchen.

The render fixes the layout (every cabinet, door, drawer and appliance at
its real size and place) and the finish in words says what it is made of;
the model only supplies the photographic look. It can still drift — a door
split differently, an appliance nudged — so the picture is a concept image
for the customer, never the record of what is priced or built.

Gemini over REST with httpx, as water_mitigation/ai_classification_service.py
does (no SDK). Synchronous, so FastAPI runs it on a worker thread.
"""

import base64
import binascii
import io
import logging
from typing import Optional, Tuple

import httpx
from PIL import Image

from app.core.config import settings

logger = logging.getLogger(__name__)

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"
# An image model takes a while; most answers come in 10-30 s.
TIMEOUT_S = 120.0

# The output proportions the image models offer, as width / height; the
# render's nearest is asked for so the picture frames the same view.
ASPECT_RATIOS = {
    "21:9": 21 / 9,
    "16:9": 16 / 9,
    "3:2": 3 / 2,
    "4:3": 4 / 3,
    "5:4": 5 / 4,
    "1:1": 1.0,
    "4:5": 4 / 5,
    "3:4": 3 / 4,
    "2:3": 2 / 3,
    "9:16": 9 / 16,
}

PROMPT = """This is a 3D render of a kitchen design. Turn it into a photorealistic photograph of the same kitchen, as a professional interior photographer would shoot it with a full-frame camera.

Keep, exactly as in the render:
- the camera position, angle and framing;
- every cabinet, door, drawer, appliance, countertop and wall: the same number of each, in the same places, at the same sizes and proportions. Do not add, remove, merge, split or move any of them;
- each cabinet's doors and drawers, divided as shown, with a pull where the render shows one.

Make it real:
- finishes: {finish};
- appliances in stainless steel, as shown;
- the wall between the countertop and the upper cabinets finished as the render and the finishes show;
- soft natural daylight with warm ceiling light, soft shadows and subtle reflections on the countertop and appliances;
- where the render shows plain background beyond the walls, continue the room plausibly (ceiling, painted walls) without covering any cabinet.

No people, no text, no logos, no watermark.{notes}"""


class AiPhotoError(Exception):
    """The photo could not be made. `status` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _decode_image(image: str) -> Tuple[bytes, str]:
    """The render's bytes and type, from base64 with or without a data: URL prefix."""
    mime = "image/jpeg"
    if image.startswith("data:"):
        header, _, image = image.partition(",")
        mime = header[5:].split(";")[0] or mime
    if mime not in ("image/jpeg", "image/png", "image/webp"):
        raise AiPhotoError(f"Unsupported image type {mime}", status=400)
    try:
        return base64.b64decode(image, validate=True), mime
    except (binascii.Error, ValueError):
        raise AiPhotoError("The render is not valid base64", status=400)


def _aspect_ratio(data: bytes) -> str:
    """The supported output proportion nearest the render's."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            width, height = img.size
    except Exception:
        raise AiPhotoError("The render is not a readable image", status=400)
    ratio = width / max(height, 1)
    return min(ASPECT_RATIOS, key=lambda k: abs(ASPECT_RATIOS[k] - ratio))


def build_prompt(finish: str, notes: Optional[str]) -> str:
    finish = finish.strip() or "the colours and materials shown in the render"
    notes = (notes or "").strip()
    return PROMPT.format(
        finish=finish,
        notes=f"\n\nAlso, as asked by the designer: {notes}" if notes else "",
    )


def make_photo(image: str, finish: str, notes: Optional[str] = None) -> Tuple[str, str]:
    """
    The photo for a render (base64, data URL or bare): a data URL of the
    picture and the model that drew it.
    """
    if not settings.GEMINI_API_KEY:
        raise AiPhotoError("AI photo is not set up: GEMINI_API_KEY is missing", status=503)
    data, mime = _decode_image(image)
    model = settings.CABINET_AI_PHOTO_MODEL
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": build_prompt(finish, notes)},
                    {"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode("ascii")}},
                ]
            }
        ],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": _aspect_ratio(data)},
        },
    }

    # Key goes in a header, not the URL - httpx puts the URL in its error
    # messages, which are returned to the client.
    try:
        with httpx.Client(timeout=TIMEOUT_S) as client:
            resp = client.post(
                f"{GEMINI_API_URL}/{model}:generateContent",
                json=payload,
                headers={"x-goog-api-key": settings.GEMINI_API_KEY},
            )
    except httpx.TimeoutException:
        raise AiPhotoError("The image model took too long; try again", status=504)
    except httpx.HTTPError as e:
        raise AiPhotoError(f"Could not reach the image model: {e}")

    if resp.status_code != 200:
        try:
            detail = resp.json().get("error", {}).get("message") or resp.text
        except ValueError:
            detail = resp.text
        logger.warning("Cabinet AI photo: %s answered %s: %s", model, resp.status_code, detail[:500])
        raise AiPhotoError(f"The image model refused the request ({resp.status_code}): {detail[:300]}")

    body = resp.json()
    candidates = body.get("candidates") or []
    parts = (candidates[0].get("content") or {}).get("parts", []) if candidates else []
    for part in parts:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            out_mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
            return f"data:{out_mime};base64,{inline['data']}", model

    # No picture: blocked, or the model only answered in words.
    reason = (candidates[0].get("finishReason") if candidates else None) or (
        body.get("promptFeedback", {}).get("blockReason")
    )
    said = " ".join(p.get("text", "") for p in parts).strip()
    logger.warning("Cabinet AI photo: %s returned no image (%s) %s", model, reason, said[:300])
    raise AiPhotoError(f"The image model returned no picture ({reason or 'no reason given'}). {said[:300]}".strip())
