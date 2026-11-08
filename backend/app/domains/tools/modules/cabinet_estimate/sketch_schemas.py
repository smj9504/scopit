"""
Cabinet Estimate Sketch Pydantic schemas.
"""

from typing import Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class CabinetSketchWall(BaseModel):
    id: str
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    thickness: float = 4
    color: str = "#333333"
    length_ft: float = 0


class CabinetSketchCabinet(BaseModel):
    id: str
    preset_code: str          # "B30", "SB36", "CUSTOM", etc. — matches CABINET_PRESETS keys
    cab_type: str              # base / wall / tall / specialty — color-coding only, not pricing
    x: float
    y: float
    width: float               # canvas pixels
    height: float              # canvas pixels
    rotation: float = 0
    label: str = ""
    # Real-world size of the Edit-tab box this shape stands for. Optional
    # because sketches saved before the Edit-tab sync don't carry them.
    location: Optional[str] = None   # perimeter / island
    width_in: Optional[float] = None
    depth_in: Optional[float] = None
    height_in: Optional[float] = None
    # Which end of a corner unit (lazy susan, blind corner, …) sits in the
    # corner, seen from the front: "left" (default) or "right".
    corner_side: Optional[str] = None
    # Copied from the Edit-tab box: its doors are drawn as glass.
    has_glass_door: Optional[bool] = None
    # Copied from the Edit-tab box: the pattern drawn in its doors (lattice / lattice_band / mullion).
    door_pattern: Optional[str] = None


class CabinetSketchAppliance(BaseModel):
    """One unit of the estimate's Appliance Detach & Reset list, placed on the plan."""

    id: str
    type: str                  # appliance_list type: dishwasher, range_gas, ...
    x: float
    y: float
    width: float               # canvas pixels
    height: float              # canvas pixels (depth)
    rotation: float = 0
    # The cabinet it sits in or on (range base, sink base, oven cabinet, ...);
    # it moves with that cabinet. None when it stands on its own.
    host_id: Optional[str] = None


class CabinetSketchFinish(BaseModel):
    """What the 3D view's realistic look and the AI photo finish the kitchen in.

    Keys of the frontend's kitchenFinish.ts choices; not priced.
    """

    cabinet_color: str = "white"
    door_style: str = "shaker"
    countertop: str = "white_quartz"
    backsplash: str = "white_subway"
    sink: str = "stainless"
    faucet: str = "stainless"
    # The hardware's metal; hardware_style its shape (bar / knob / cup / none).
    hardware: str = "nickel"
    hardware_style: str = "bar"
    floor: str = "light_oak"


class CabinetSketchOverlayData(BaseModel):
    walls: List[CabinetSketchWall] = Field(default_factory=list)
    cabinets: List[CabinetSketchCabinet] = Field(default_factory=list)
    appliances: List[CabinetSketchAppliance] = Field(default_factory=list)
    element_order: List[str] = Field(default_factory=list)
    finish: Optional[CabinetSketchFinish] = None
    # The estimate's "cabinets on both sides" the island was last laid out
    # for, so the Sketch re-lays it (two rows / one) only when that changes.
    island_two_sided: Optional[bool] = None
    # Wall faces left without backsplash ("<wall id>:<1|-1>", which face of
    # the wall). See splashFaceKey in the frontend's cabinetBacksplash.ts.
    backsplash_off: Optional[List[str]] = None
    # Faces given backsplash that start without one: a side wall at a run's
    # end, tiled in some kitchens and not in others.
    backsplash_on: Optional[List[str]] = None
    # Inches a face's backsplash stops short of its [left, right] end, as
    # you face that wall.
    backsplash_trim: Optional[Dict[str, List[float]]] = None


class CabinetSketchResponse(BaseModel):
    id: UUID
    estimate_id: UUID
    canvas_width: int
    canvas_height: int
    scale_pixels_per_foot: float
    overlay_data: CabinetSketchOverlayData

    class Config:
        from_attributes = True


class CabinetSketchUpdate(BaseModel):
    canvas_width: Optional[int] = None
    canvas_height: Optional[int] = None
    scale_pixels_per_foot: Optional[float] = None


class CabinetSketchAiPhotoRequest(BaseModel):
    """The 3D view's realistic render, to be redrawn as a photo (sketch_ai_photo.py)."""

    # Base64 JPEG / PNG / WebP, bare or as a data: URL.
    image: str = Field(..., max_length=12_000_000)
    # The kitchen's finishes in words, from the frontend's kitchenFinish.ts.
    finish: str = Field("", max_length=1000)
    # Anything else the picture should show, in the user's words.
    notes: Optional[str] = Field(None, max_length=1000)


class CabinetSketchAiPhotoResponse(BaseModel):
    # The picture, as a data: URL.
    image: str
    model: str
