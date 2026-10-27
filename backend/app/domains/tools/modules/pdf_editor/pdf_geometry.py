"""
Scopit - PDF Editor page geometry

The editor, the field-placement canvas and the public signing page all lay
things out on a pdf.js viewport at scale 1: a top-down "screen" space whose
size and orientation already include the page's /Rotate and crop box.
Burning onto the PDF has to map that space back to PDF user space, otherwise
anything on a rotated (or cropped) page lands in the wrong place.

These helpers mirror pdf.js's PageViewport math exactly.
"""

from __future__ import annotations

import math
from typing import NamedTuple


class PageView(NamedTuple):
    width: float           # viewport width at scale 1 (rotation applied)
    height: float          # viewport height at scale 1 (rotation applied)
    rotation: int          # normalized /Rotate: 0, 90, 180 or 270
    to_user: tuple         # affine (a, b, c, d, e, f): screen -> PDF user space


def _box(rect) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = (float(v) for v in rect)
    return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)


def page_view_box(page) -> tuple[float, float, float, float]:
    """pdf.js's page.view: the crop box clipped to the media box (falls back
    to the media box when the crop box is missing or doesn't intersect)."""
    media = _box(page.mediabox)
    try:
        crop = _box(page.cropbox)
    except Exception:
        return media
    x0, y0 = max(media[0], crop[0]), max(media[1], crop[1])
    x1, y1 = min(media[2], crop[2]), min(media[3], crop[3])
    if x1 <= x0 or y1 <= y0:
        return media
    return x0, y0, x1, y1


def page_rotation(page) -> int:
    try:
        rot = int(page.get("/Rotate", 0) or 0)
    except Exception:
        rot = 0
    rot %= 360
    return rot if rot in (0, 90, 180, 270) else 0


def page_view(page) -> PageView:
    """Viewport geometry for a pypdf page, matching pdf.js getViewport({scale: 1})."""
    x0, y0, x1, y1 = page_view_box(page)
    rot = page_rotation(page)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    a, b, c, d = {
        0: (1, 0, 0, -1),
        90: (0, 1, 1, 0),
        180: (-1, 0, 0, 1),
        270: (0, -1, -1, 0),
    }[rot]

    if a == 0:
        off_x, off_y = abs(cy - y0), abs(cx - x0)
        width, height = y1 - y0, x1 - x0
    else:
        off_x, off_y = abs(cx - x0), abs(cy - y0)
        width, height = x1 - x0, y1 - y0

    # user -> screen
    e = off_x - a * cx - c * cy
    f = off_y - b * cx - d * cy

    # invert to screen -> user
    det = a * d - b * c
    inv = (
        d / det,
        -b / det,
        -c / det,
        a / det,
        (c * f - d * e) / det,
        (b * e - a * f) / det,
    )
    return PageView(width=width, height=height, rotation=rot, to_user=inv)


def page_view_size(page) -> tuple[float, float]:
    view = page_view(page)
    return view.width, view.height


def enter_screen_space(canvas, view: PageView) -> None:
    """Make subsequent reportlab drawing use top-down viewport coordinates.

    Text and images drawn directly in this space would come out mirrored, so
    draw them inside `local_frame` (which flips back to a y-up frame)."""
    canvas.transform(*view.to_user)


def multiply(m: tuple, n: tuple) -> tuple:
    """m then n, as PDF composes matrices (a point maps as p * m * n)."""
    a, b, c, d, e, f = m
    a2, b2, c2, d2, e2, f2 = n
    return (
        a * a2 + b * c2, a * b2 + b * d2,
        c * a2 + d * c2, c * b2 + d * d2,
        e * a2 + f * c2 + e2, e * b2 + f * d2 + f2,
    )


def invert(m: tuple) -> tuple:
    a, b, c, d, e, f = m
    det = a * d - b * c
    return (
        d / det, -b / det, -c / det, a / det,
        (c * f - d * e) / det, (b * e - a * f) / det,
    )


def local_frame_matrix(view: PageView, x: float, y: float, angle: float = 0.0) -> tuple:
    """What enter_screen_space + local_frame set up, as one matrix (local
    y-up frame -> PDF user space), for content written without reportlab."""
    a = math.radians(angle)
    rotate = (math.cos(a), math.sin(a), -math.sin(a), math.cos(a), 0.0, 0.0)
    frame = multiply(multiply((1.0, 0.0, 0.0, -1.0, 0.0, 0.0), rotate), (1.0, 0.0, 0.0, 1.0, x, y))
    return multiply(frame, view.to_user)


def local_frame(canvas, x: float, y: float, angle: float = 0.0) -> None:
    """Move the origin to screen point (x, y), rotate clockwise by `angle`
    degrees (fabric.js convention) and flip to a y-up frame, so ordinary
    reportlab drawing calls work with y pointing up from that point.
    Call between canvas.saveState() / canvas.restoreState()."""
    canvas.translate(x, y)
    if angle:
        canvas.rotate(angle)
    canvas.scale(1, -1)
