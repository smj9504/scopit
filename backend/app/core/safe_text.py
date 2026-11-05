"""
Scopit - Escaping user text for the formats we generate

Every helper here takes text a user (or an AI model) wrote and makes it inert
in one output format:

- html_text: HTML email bodies.
- rl_text: ReportLab Paragraph markup. Paragraph parses its input as XML-ish
  markup, so a raw "<" breaks the PDF and "<img src=...>" makes ReportLab
  open files on the server.
- excel_cell: .xlsx cells. openpyxl stores a string starting with "=" as a
  formula, which runs when the file is opened (e.g. =HYPERLINK phishing).
- content_disposition: download filenames, which may contain quotes or
  non-Latin-1 characters (Korean names) that would otherwise break the
  header or the response.
"""
import html
import re
import unicodedata
from typing import Any, Optional
from urllib.parse import quote
from xml.sax.saxutils import escape as _xml_escape


def html_text(value: Any) -> str:
    """Escape for an HTML text node or a quoted attribute. None -> ""."""
    if value is None:
        return ""
    return html.escape(str(value), quote=True)


def rl_text(value: Any) -> str:
    """Escape for ReportLab Paragraph markup. None -> ""."""
    if value is None:
        return ""
    return _xml_escape(str(value), {'"': "&quot;"})


def excel_cell(value: Any) -> Any:
    """Make a string safe to write into an .xlsx cell with openpyxl.

    openpyxl stores any string that starts with "=" as a formula, which Excel
    then runs when the file is opened (e.g. =HYPERLINK to a phishing site).
    Every other string is stored as plain text, which Excel never evaluates,
    so "+1 555 0100" or "-" stay exactly as typed. Non-strings pass through so
    numeric columns stay numeric. (A CSV export would also need + - @ handled;
    there are none today.)
    """
    if isinstance(value, str) and value.startswith("="):
        return "'" + value
    return value


_UNSAFE_FILENAME_CHARS = re.compile(r'[\x00-\x1f\x7f"\\/:*?<>|;]+')


def safe_filename(name: Optional[str], default: str = "download") -> str:
    """A filename with path separators, quotes and control characters removed."""
    cleaned = _UNSAFE_FILENAME_CHARS.sub("_", (name or "").strip())
    cleaned = cleaned.strip(" .")
    return cleaned[:150] or default


def content_disposition(filename: Optional[str], disposition: str = "attachment",
                        default: str = "download") -> str:
    """RFC 6266 header value with an ASCII fallback and a UTF-8 filename*.

    Korean and other non-Latin-1 names used to make the response itself
    fail (headers must be Latin-1); filename* carries them correctly.
    """
    name = safe_filename(filename, default)
    ascii_name = (
        unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    )
    ascii_name = safe_filename(ascii_name, default)
    # Keep the extension even if the stem was all non-ASCII.
    if "." in name and "." not in ascii_name:
        ascii_name = f"{default}.{name.rsplit('.', 1)[-1]}"
        ascii_name = safe_filename(ascii_name, default)
    header = f'{disposition}; filename="{ascii_name}"'
    if ascii_name != name:
        header += f"; filename*=UTF-8''{quote(name, safe='')}"
    return header
