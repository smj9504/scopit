"""
Reading a retailer's product page from the server.

Whatever link a person pastes is fetched by us, so the fetch only goes to
public internet addresses (never the server's own network or a cloud
metadata address), re-checks every redirect, and stops at a size cap. Then
the parts that describe the product are picked out: schema.org Product data
(most retailers publish it), Open Graph tags, and the visible text, for
Claude to read the rest from (extract.py).

Big retailers often turn a server away with a bot check; that comes back as
FetchError(blocked=True), and a screenshot of the page is the way in instead.
"""

import ipaddress
import json
import re
import socket
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx

MAX_PAGE_BYTES = 4_000_000
MAX_IMAGE_BYTES = 12_000_000
# Page text handed to Claude, characters: a listing's useful part fits well within it.
MAX_TEXT_CHARS = 24_000
TIMEOUT_S = 20.0
MAX_REDIRECTS = 5

# A browser's request, as the retailers expect one.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Words a bot-check page says instead of showing the product.
BOT_WALL = re.compile(
    r"access denied|robot or human|are you a robot|pardon our interruption|captcha|"
    r"verify you are a human|request unsuccessful|unusual traffic",
    re.IGNORECASE,
)


class FetchError(Exception):
    """The page couldn't be had. `blocked`: the retailer turned us away, so a screenshot is the way in."""

    def __init__(self, message: str, blocked: bool = False):
        super().__init__(message)
        self.blocked = blocked


def check_public_url(url: str) -> None:
    """Refuse anything but an http(s) link to a public internet address."""
    parts = urlparse(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise FetchError("Only http and https links can be read")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror:
        raise FetchError(f"Couldn't find {parts.hostname}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if not ip.is_global or ip.is_multicast:
            raise FetchError("That link points at a private address")


def fetch(url: str, max_bytes: int) -> Tuple[str, str, bytes]:
    """GET a public URL, following redirects one checked hop at a time. Returns (final url, content type, body)."""
    current = url
    with httpx.Client(timeout=TIMEOUT_S, follow_redirects=False, headers=HEADERS) as client:
        for _ in range(MAX_REDIRECTS + 1):
            check_public_url(current)
            try:
                with client.stream("GET", current) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                        current = urljoin(current, resp.headers["location"])
                        continue
                    if resp.status_code in (401, 403, 429, 503):
                        raise FetchError(f"The site turned the request away ({resp.status_code})", blocked=True)
                    if resp.status_code >= 400:
                        raise FetchError(f"The page answered {resp.status_code}")
                    body = bytearray()
                    for chunk in resp.iter_bytes():
                        body.extend(chunk)
                        if len(body) > max_bytes:
                            raise FetchError("The page is too large to read")
                    return current, resp.headers.get("content-type", ""), bytes(body)
            except httpx.TimeoutException:
                raise FetchError("The site took too long to answer")
            except httpx.HTTPError as e:
                raise FetchError(f"Couldn't reach the site: {e.__class__.__name__}")
    raise FetchError("Too many redirects")


class _PageParser(HTMLParser):
    """Collects JSON-LD blocks, meta tags, the title and the visible text."""

    SKIP = {"script", "style", "noscript", "svg", "template", "iframe", "head"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.json_ld: List[str] = []
        self.meta: Dict[str, List[str]] = {}
        self.title = ""
        self.text: List[str] = []
        self._skip_depth = 0
        self._in_json_ld = False
        self._in_title = False
        self._buf: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
            if key and a.get("content"):
                self.meta.setdefault(key, []).append(a["content"].strip())
            return
        if tag == "script" and "ld+json" in a.get("type", "").lower():
            self._in_json_ld = True
            self._buf = []
        if tag == "title":
            self._in_title = True
        if tag in self.SKIP:
            self._skip_depth += 1
        if tag in ("br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "td", "th", "dd", "dt"):
            self.text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._in_json_ld:
            self.json_ld.append("".join(self._buf))
            self._in_json_ld = False
        if tag == "title":
            self._in_title = False
        if tag in self.SKIP and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._in_json_ld:
            self._buf.append(data)
        elif self._in_title:
            self.title += data
        elif not self._skip_depth:
            self.text.append(data)


@dataclass
class Page:
    url: str
    title: str
    # The schema.org Product the page publishes, if any.
    product: Dict[str, Any] = field(default_factory=dict)
    meta: Dict[str, List[str]] = field(default_factory=dict)
    text: str = ""

    @property
    def blocked(self) -> bool:
        """A bot check, not the product: no product data and the words such pages use."""
        return not self.product and bool(BOT_WALL.search(self.title + " " + self.text[:2000]))


def _is_product(node: Any) -> bool:
    kind = node.get("@type") if isinstance(node, dict) else None
    kinds = kind if isinstance(kind, list) else [kind]
    return any(isinstance(k, str) and k.lower() in ("product", "productgroup", "individualproduct") for k in kinds)


def _find_product(data: Any) -> Optional[Dict[str, Any]]:
    """The first Product node anywhere in a JSON-LD document (top level, a list, or an @graph)."""
    if isinstance(data, list):
        for item in data:
            found = _find_product(item)
            if found:
                return found
    elif isinstance(data, dict):
        if _is_product(data):
            return data
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in data:
                found = _find_product(data[key])
                if found:
                    return found
    return None


def parse_page(html: str, url: str) -> Page:
    parser = _PageParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        # A malformed page still leaves what was read before it went wrong.
        pass
    product: Dict[str, Any] = {}
    for block in parser.json_ld:
        try:
            found = _find_product(json.loads(block))
        except (ValueError, TypeError):
            continue
        if found:
            product = found
            break
    text = re.sub(r"[ \t\r\f\v]+", " ", "".join(parser.text))
    text = re.sub(r"\n\s*\n+", "\n", text).strip()
    return Page(url=url, title=parser.title.strip(), product=product, meta=parser.meta, text=text[:MAX_TEXT_CHARS])


def _first(value: Any) -> Any:
    return value[0] if isinstance(value, list) and value else value


def _image_urls(value: Any, base: str) -> List[str]:
    out: List[str] = []
    for item in value if isinstance(value, list) else [value]:
        if isinstance(item, dict):
            item = item.get("url") or item.get("contentUrl")
        if isinstance(item, str) and item.strip():
            full = urljoin(base, item.strip())
            if full.startswith(("http://", "https://")) and full not in out:
                out.append(full)
    return out


def _price(offers: Any) -> Optional[float]:
    for offer in offers if isinstance(offers, list) else [offers]:
        if not isinstance(offer, dict):
            continue
        for key in ("price", "lowPrice"):
            raw = offer.get(key)
            if raw is None and isinstance(offer.get("priceSpecification"), dict):
                raw = offer["priceSpecification"].get("price")
            try:
                if raw not in (None, ""):
                    return float(str(raw).replace(",", "").replace("$", ""))
            except ValueError:
                continue
    return None


def _inches(value: Any) -> Optional[float]:
    """A schema.org QuantitativeValue (or a bare number taken as inches) in inches."""
    unit = ""
    if isinstance(value, dict):
        unit = str(value.get("unitCode") or value.get("unitText") or "").lower()
        value = value.get("value")
    try:
        number = float(str(value).split()[0])
    except (ValueError, IndexError):
        return None
    factor = {"cmt": 1 / 2.54, "cm": 1 / 2.54, "mmt": 1 / 25.4, "mm": 1 / 25.4, "ft": 12, "fot": 12}.get(unit, 1)
    return round(number * factor, 3)


def page_fields(page: Page) -> Tuple[Dict[str, Any], List[str]]:
    """What the page states outright (its Product data and Open Graph tags): fields, and its pictures main one first."""
    p = page.product
    meta = page.meta
    fields: Dict[str, Any] = {}
    brand = p.get("brand")
    if isinstance(brand, dict):
        brand = brand.get("name")
    if isinstance(brand, list):
        brand = _first(brand)
        brand = brand.get("name") if isinstance(brand, dict) else brand
    title = p.get("name") or _first(meta.get("og:title", [])) or page.title
    if title:
        fields["title"] = str(title).strip()[:300]
    if brand:
        fields["brand"] = str(brand).strip()[:120]
    for key, target in (("sku", "sku"), ("mpn", "model_number"), ("model", "model_number"), ("color", "finish")):
        value = p.get(key)
        if isinstance(value, dict):
            value = value.get("name")
        if value and target not in fields:
            fields[target] = str(_first(value)).strip()[:160]
    description = p.get("description") or _first(meta.get("og:description", []))
    if description:
        fields["description"] = str(description).strip()[:2000]
    price = _price(p.get("offers"))
    if price is None:
        for key in ("product:price:amount", "og:price:amount"):
            try:
                price = float(_first(meta.get(key, [])) or "")
                break
            except ValueError:
                continue
    if price is not None:
        fields["price"] = price
    for key, target in (("width", "width_in"), ("depth", "depth_in"), ("height", "height_in")):
        inches = _inches(p.get(key)) if p.get(key) is not None else None
        if inches:
            fields[target] = inches
    images = _image_urls(p.get("image"), page.url) + _image_urls(meta.get("og:image", []), page.url)
    return fields, list(dict.fromkeys(images))[:12]
