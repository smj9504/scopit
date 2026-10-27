"""
Scopit - PDF Editor: passwords

  * protect_pdf encrypts a copy (AES-256) with a password to open it and/or
    a permissions password that restricts printing, copying and editing --
    Adobe's "Protect a PDF". The editor keeps working on the unprotected
    document; protection goes on the copy that leaves it.
  * unlock_pdf opens a password-protected upload, so it can be edited at all
    (every page operation needs to read the file).

AES needs the `cryptography` package (pypdf's crypto provider).
"""

from __future__ import annotations

from io import BytesIO
from typing import Optional

from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions as Perm
from pypdf.errors import DependencyError, FileNotDecryptedError, PdfReadError


class PdfPasswordError(Exception):
    """An encrypted PDF that couldn't be opened. `code`:
    password_required -- no password given, and it has one to open;
    password_incorrect -- the password given doesn't open it;
    unsupported -- encrypted in a way the server can't read."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def unlock_pdf(pdf_data: bytes, password: Optional[str] = None) -> bytes:
    """The PDF without encryption (unchanged if it had none). A file that
    only restricts permissions opens without a password, as in any viewer."""
    try:
        reader = PdfReader(BytesIO(pdf_data))
        if not reader.is_encrypted:
            return pdf_data
        opened = reader.decrypt("")
        if not opened and password:
            opened = reader.decrypt(password)
    except DependencyError as exc:
        raise PdfPasswordError("unsupported", "This PDF's encryption can't be opened on the server.") from exc
    except (PdfReadError, NotImplementedError) as exc:
        raise PdfPasswordError("unsupported", f"This PDF's encryption isn't supported: {exc}") from exc
    if not opened:
        if password:
            raise PdfPasswordError("password_incorrect", "That password doesn't open this PDF.")
        raise PdfPasswordError("password_required", "This PDF is password protected.")
    try:
        writer = PdfWriter(clone_from=reader)
        out = BytesIO()
        writer.write(out)
    except (FileNotDecryptedError, DependencyError) as exc:
        raise PdfPasswordError("unsupported", "This PDF's encryption can't be opened on the server.") from exc
    return out.getvalue()


def protect_pdf(
    pdf_data: bytes,
    open_password: Optional[str] = None,
    permissions_password: Optional[str] = None,
    allow_printing: bool = True,
    allow_copying: bool = True,
    allow_editing: bool = True,
    allow_commenting: bool = True,
) -> bytes:
    """An AES-256 encrypted copy of the PDF.

    With an open password, it can't be opened without it. With a
    permissions password, viewers hold back whatever isn't allowed
    (printing, copying text and images, changing pages, comments and form
    filling) unless that password is given. Restrictions without a
    permissions password would be undone by anyone who can open the file,
    so they need one; ValueError otherwise, or if there's nothing to do."""
    open_password = open_password or ""
    restricted = not (allow_printing and allow_copying and allow_editing and allow_commenting)
    if restricted and not permissions_password:
        raise ValueError("Restricting printing, copying or editing needs a permissions password.")
    if not open_password and not permissions_password:
        raise ValueError("Set a password to open the PDF, or a permissions password.")
    if open_password and permissions_password and open_password == permissions_password:
        raise ValueError("The permissions password must differ from the password to open the PDF.")

    permissions = Perm.all()
    if not allow_printing:
        permissions &= ~(Perm.PRINT | Perm.PRINT_TO_REPRESENTATION)
    if not allow_copying:
        # Text access for screen readers (EXTRACT_TEXT_AND_GRAPHICS) stays on
        permissions &= ~Perm.EXTRACT
    if not allow_editing:
        permissions &= ~(Perm.MODIFY | Perm.ASSEMBLE_DOC)
    if not allow_commenting:
        permissions &= ~(Perm.ADD_OR_MODIFY | Perm.FILL_FORM_FIELDS)

    writer = PdfWriter(clone_from=PdfReader(BytesIO(pdf_data)))
    try:
        writer.encrypt(
            user_password=open_password,
            # Only an open password: knowing it is full access, as in Acrobat
            owner_password=permissions_password or open_password,
            permissions_flag=permissions,
            algorithm="AES-256",
        )
    except DependencyError as exc:
        raise RuntimeError("PDF encryption isn't available on the server (install `cryptography`).") from exc
    out = BytesIO()
    writer.write(out)
    return out.getvalue()
