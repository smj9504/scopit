"""
Scopit - Tool Registry

Single source of truth for available tools.
Adding a new tool = adding one entry to TOOL_REGISTRY.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class ToolDefinition:
    """Metadata for a single tool in the registry."""
    id: str
    name: str
    description: str
    icon: str
    category: str
    required_plan: str  # "free" | "pro" | "enterprise"
    can_create_estimate: bool = False
    version: str = "1.0.0"
    is_active: bool = True
    tags: List[str] = field(default_factory=list)


TOOL_REGISTRY: Dict[str, ToolDefinition] = {
    "roof_analyzer": ToolDefinition(
        id="roof_analyzer",
        name="Roof Analyzer",
        description="Upload EagleView reports to visualize roof faces, calculate slopes, and estimate areas.",
        icon="HomeOutlined",
        category="Analysis",
        required_plan="free",
        can_create_estimate=True,
        tags=["roofing", "eagleview", "measurements"],
    ),
    "packing": ToolDefinition(
        id="packing",
        name="Packing & Moving Estimator",
        description="Estimate packing and moving costs based on room parameters or photo analysis.",
        icon="InboxOutlined",
        category="Estimation",
        required_plan="free",
        can_create_estimate=True,
        tags=["moving", "packing", "contents"],
    ),
    "item_recommender": ToolDefinition(
        id="item_recommender",
        name="Item Recommender",
        description="Search Xactimate line items by work type and get grouped recommendations (pre-work, main, materials, trim, post-work).",
        icon="SearchOutlined",
        category="Analysis",
        required_plan="free",
        can_create_estimate=False,
        tags=["xactimate", "line-items", "search", "recommendations"],
    ),
    "pdf_editor": ToolDefinition(
        id="pdf_editor",
        name="PDF Editor & E-Sign",
        description="Edit PDFs, add text and images, merge documents, and send for electronic signatures.",
        icon="FileTextOutlined",
        category="Documents",
        # Bumped from "free": reusable field-mapping templates, the
        # Available Field Registry (auto-fill from Customer/Company data),
        # and multi-recipient signing make this a paid-tier capability.
        # NOTE: BETA_MODE currently bypasses this gate for everyone and
        # the per-company plan lookup is hardcoded to "free" -- this value
        # only takes effect once both are addressed (see ToolAccessService).
        required_plan="pro",
        can_create_estimate=False,
        tags=["pdf", "editor", "e-sign", "documents", "signature"],
    ),
}


def get_tool(tool_id: str) -> Optional[ToolDefinition]:
    return TOOL_REGISTRY.get(tool_id)


def get_all_tools(active_only: bool = True) -> List[ToolDefinition]:
    tools = list(TOOL_REGISTRY.values())
    if active_only:
        tools = [t for t in tools if t.is_active]
    return tools


def tool_exists(tool_id: str) -> bool:
    return tool_id in TOOL_REGISTRY
