"""
Scopit - PDF Editor Tool Schemas

Pydantic models for the PDF editor tool, covering document management,
page operations, annotations, signing workflow, and company document library.
"""

import re
from datetime import datetime
from typing import Annotated, Literal, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# ============================================
# PDF DOCUMENT SCHEMAS
# ============================================

class PdfDocumentCreate(BaseModel):
    name: str
    source_type: str = "upload"
    source_id: Optional[str] = None


class PdfDocumentUpdate(BaseModel):
    name: Optional[str] = None


class PdfDocumentResponse(BaseModel):
    id: str
    name: str
    file_size: int
    page_count: int
    mime_type: str
    source_type: str
    source_id: Optional[str] = None
    annotations: list = []
    thumbnail_url: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PdfDocumentListResponse(BaseModel):
    items: list[PdfDocumentResponse]
    total: int
    skip: int
    limit: int


# ============================================
# PAGE OPERATION SCHEMAS
# ============================================

class MergeDocumentsRequest(BaseModel):
    document_ids: list[str] = Field(..., min_length=2)
    name: Optional[str] = None


class PageReorderRequest(BaseModel):
    page_order: list[int]  # 0-indexed new order


class PageDeleteRequest(BaseModel):
    page_numbers: list[int]  # 1-indexed pages to remove


class PageRotateRequest(BaseModel):
    rotations: dict[str, int]  # {"1": 90, "3": 180} - page_number: degrees


class CropMargins(BaseModel):
    """Points to trim off each side, as the page is shown in the editor."""
    left: float = Field(0, ge=0)
    top: float = Field(0, ge=0)
    right: float = Field(0, ge=0)
    bottom: float = Field(0, ge=0)


class PageCropRequest(BaseModel):
    page_numbers: Optional[list[int]] = None  # 1-indexed; None = every page
    margins: Optional[CropMargins] = None
    reset: bool = False  # show the whole page again
    # Undo: {page number: [x0, y0, x1, y1]} in PDF user space, as a crop
    # returned them in previousCropBoxes; page_numbers is ignored
    boxes: Optional[dict[int, list[float]]] = None


class PageExtractRequest(BaseModel):
    page_numbers: list[int] = Field(..., min_length=1)  # 1-indexed
    separate: bool = False       # one document per page
    delete_after: bool = False   # remove them from this document
    name: Optional[str] = Field(None, max_length=255)


class ProtectRequest(BaseModel):
    open_password: Optional[str] = Field(None, max_length=128)
    permissions_password: Optional[str] = Field(None, max_length=128)
    allow_printing: bool = True
    allow_copying: bool = True
    allow_editing: bool = True
    allow_commenting: bool = True


class ApplyRedactionsRequest(BaseModel):
    mark_ids: Optional[list[str]] = None  # None = every redaction mark
    fill_color: str = Field("#000000", pattern=r"^#[0-9a-fA-F]{6}$")
    remove_metadata: bool = False


# ============================================
# ANNOTATION SCHEMAS
# ============================================

class AnnotationStyle(BaseModel):
    # The frontend's AnnotationStyle interface is camelCase (fontSize,
    # backgroundColor, ...); without this alias, Pydantic's default
    # extra="ignore" would silently drop every field here whose name
    # differs by casing, keeping only color/opacity (no underscore to
    # diverge) -- annotations would round-trip with font/border/background
    # silently reset on every save. populate_by_name keeps snake_case input
    # working too; model_dump() (no by_alias) still emits snake_case, which
    # is what the annotation-burning code and DB storage already expect.
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    font_family: Optional[str] = None
    font_size: Optional[float] = None
    font_weight: Optional[str] = None       # normal, bold
    font_style: Optional[str] = None        # normal, italic
    text_decoration: Optional[str] = None  # none, underline
    color: Optional[str] = None
    background_color: Optional[str] = None
    border_color: Optional[str] = None
    border_width: Optional[float] = None
    opacity: Optional[float] = None
    # Edit Text: the PDF font the replaced words were printed in (its name
    # as pdf.js reports it); the text is drawn with it where possible
    pdf_font: Optional[str] = None


class Annotation(BaseModel):
    id: str
    type: str  # text, image, drawing, stamp, shape, sign_field, redact (marked, not yet applied)
    page: int  # 1-indexed, matching the editor and PDF.js
    x: float
    y: float
    width: float
    height: float
    rotation: float = 0
    content: str = ""
    style: AnnotationStyle = AnnotationStyle()


class AnnotationSaveRequest(BaseModel):
    annotations: list[Annotation]


class TextCover(BaseModel):
    """An Edit cover's box, in the same geometry as an Annotation: over
    words ("text") or over an image picked up to edit ("image")."""
    id: str
    x: float
    y: float
    width: float
    height: float
    rotation: float = 0
    kind: Literal["text", "image"] = "text"


class TextEditPreviewRequest(BaseModel):
    covers: list[TextCover] = Field(..., max_length=2000)


# ============================================
# IMPORT SCHEMAS
# ============================================

class ImportEstimateRequest(BaseModel):
    estimate_id: str
    template: str = "classic"


class ImportInvoiceRequest(BaseModel):
    invoice_id: str
    template: str = "classic"


class ImportCompanyDocRequest(BaseModel):
    company_document_id: str


# ============================================
# FIELD MAPPING / DATA BINDING SCHEMAS
# ============================================

class DataBinding(BaseModel):
    mode: str  # "prefilled" | "signer_input" | "creator_input"
    source_entity: Optional[str] = None   # "customer" | "company" | "custom" | None
    source_field: Optional[str] = None


class FieldDefinition(BaseModel):
    key: str                     # unique within template, e.g. "customer.name", "custom.field_1", "sig.homeowner"
    label: str
    type: str = "text"           # text, date, signature, initials, checkbox, number, ... (open string, EX-1)
    page: int                    # 1-indexed
    x: float
    y: float
    width: float
    height: float
    data_binding: DataBinding
    signer_role: Optional[str] = None   # required when mode=="signer_input" or type in (signature, initials)
    required: bool = False
    font_size: Optional[int] = None     # points; None = auto-fit to field height


class FieldDefinitionsUpdateRequest(BaseModel):
    fields: list[FieldDefinition]


# ============================================
# SIGN REQUEST SCHEMAS
# ============================================

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email_address(value: str) -> str:
    """Syntax-check an email address (email-validator when installed, a
    plain regex otherwise -- pydantic's EmailStr would make importing this
    module fail outright in environments without it)."""
    value = (value or "").strip()
    try:
        from email_validator import EmailNotValidError, validate_email
    except ImportError:
        if not _EMAIL_RE.match(value):
            raise ValueError(f"'{value}' is not a valid email address")
        return value
    try:
        return validate_email(value, check_deliverability=False).normalized
    except EmailNotValidError as exc:
        raise ValueError(f"'{value}' is not a valid email address: {exc}") from exc


EmailAddress = Annotated[str, AfterValidator(_validate_email_address)]


class SignRecipientCreate(BaseModel):
    role: str
    name: str
    email: EmailAddress
    phone: Optional[str] = None


class SignRequestCreate(BaseModel):
    document_id: str
    recipients: list[SignRecipientCreate] = Field(..., min_length=1)
    customer_id: Optional[str] = None
    delivery_method: str = "email_request"  # "direct_link" | "email_request"
    sender_email: Optional[str] = None
    sender_name: Optional[str] = None
    email_subject: Optional[str] = None
    email_message: Optional[str] = None
    cc_emails: list[EmailAddress] = []
    bcc_emails: list[EmailAddress] = []
    expires_in_days: int = Field(default=14, ge=1, le=365)


class CreatorFieldValuesRequest(BaseModel):
    values: dict[str, str]


class SignRequestResponse(BaseModel):
    id: str
    document_id: str = Field(serialization_alias="documentId")
    document_name: Optional[str] = Field(default=None, serialization_alias="documentName")
    recipient_email: str = Field(serialization_alias="recipientEmail")
    recipient_name: str = Field(serialization_alias="recipientName")
    sender_email: str = Field(serialization_alias="senderEmail")
    sender_name: str = Field(serialization_alias="senderName")
    customer_id: Optional[str] = Field(default=None, serialization_alias="customerId")
    status: str
    sign_fields: list = Field(default=[], serialization_alias="signFields")
    email_subject: Optional[str] = Field(default=None, serialization_alias="emailSubject")
    email_message: Optional[str] = Field(default=None, serialization_alias="emailMessage")
    cc_emails: list[str] = Field(default=[], serialization_alias="ccEmails")
    bcc_emails: list[str] = Field(default=[], serialization_alias="bccEmails")
    expires_at: Optional[datetime] = Field(default=None, serialization_alias="expiresAt")
    sent_at: Optional[datetime] = Field(default=None, serialization_alias="sentAt")
    viewed_at: Optional[datetime] = Field(default=None, serialization_alias="viewedAt")
    signed_at: Optional[datetime] = Field(default=None, serialization_alias="signedAt")
    declined_at: Optional[datetime] = Field(default=None, serialization_alias="declinedAt")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: Optional[datetime] = Field(default=None, serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class SignRequestListResponse(BaseModel):
    items: list[SignRequestResponse]
    total: int
    skip: int
    limit: int


class SignViewResponse(BaseModel):
    document_name: str = Field(serialization_alias="documentName")
    sender_name: str = Field(serialization_alias="senderName")
    sender_email: str = Field(serialization_alias="senderEmail")
    company_name: Optional[str] = Field(default=None, serialization_alias="companyName")
    company_logo_url: Optional[str] = Field(default=None, serialization_alias="companyLogoUrl")
    page_count: int = Field(serialization_alias="pageCount")
    sign_fields: list = Field(default=[], serialization_alias="signFields")
    status: str
    expires_at: datetime = Field(serialization_alias="expiresAt")

    model_config = ConfigDict(populate_by_name=True)


class SignSubmitRequest(BaseModel):
    signature_data: str  # base64 PNG
    signature_type: str = "draw"  # "draw" or "type"
    signature_font: Optional[str] = None  # font name if type mode
    field_values: dict[str, str] = {}  # this recipient's own signer_input values, keyed by field key
    consent_agreed: bool = False
    initials_data: Optional[str] = None  # base64 PNG, captured separately for initials fields


class SignDeclineRequest(BaseModel):
    reason: Optional[str] = None


# ============================================
# SIGN AUDIT SCHEMAS
# ============================================

class SignAuditEventResponse(BaseModel):
    id: str
    event_type: str = Field(serialization_alias="eventType")
    actor_email: Optional[str] = Field(default=None, serialization_alias="actorEmail")
    actor_ip: Optional[str] = Field(default=None, serialization_alias="actorIp")
    event_metadata: dict = Field(default={}, serialization_alias="eventMetadata")
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ============================================
# COMPANY DOCUMENT SCHEMAS
# ============================================

class CompanyDocumentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    tags: list[str] = []


class CompanyDocumentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[list[str]] = None


class CompanyDocumentResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    file_size: int = Field(serialization_alias="fileSize")
    mime_type: str = Field(serialization_alias="mimeType")
    page_count: int = Field(serialization_alias="pageCount")
    thumbnail_url: Optional[str] = Field(default=None, serialization_alias="thumbnailUrl")
    tags: list[str] = []
    use_count: int = Field(default=0, serialization_alias="useCount")
    last_used_at: Optional[datetime] = Field(default=None, serialization_alias="lastUsedAt")
    is_active: bool = Field(serialization_alias="isActive")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: Optional[datetime] = Field(default=None, serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class CompanyDocumentListResponse(BaseModel):
    items: list[CompanyDocumentResponse]
    total: int
    skip: int
    limit: int
