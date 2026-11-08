"""
Scopit - FastAPI Application Entry Point
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import DataError
from starlette.middleware.sessions import SessionMiddleware

import app.core.images  # noqa: F401  (sets Pillow's decompression-bomb ceiling)
import app.domains.tools.modules.packing.converter  # noqa: F401

# Import tool converters (registers them in the converter registry)
import app.domains.tools.modules.roof_analyzer.converter  # noqa: F401
from app.core.config import settings
from app.core.database import get_db_context
from app.domains.admin.api import router as admin_router

# Import routers
from app.domains.auth.api import router as auth_router
from app.domains.company.api import router as company_router
from app.domains.customer.api import router as customer_router
from app.domains.dashboard.api import router as dashboard_router
from app.domains.estimate.api import router as estimate_router
from app.domains.invoice.api import router as invoice_router
from app.domains.line_item.api import router as line_item_router
from app.domains.product_library.api import router as product_library_router
from app.domains.settings.api import router as settings_router
from app.domains.support.api import admin_router as support_admin_router
from app.domains.support.api import router as support_router
from app.domains.tools.api import router as tools_router
from app.domains.tools.modules.bathroom_estimate.api import router as bathroom_estimate_router
from app.domains.tools.modules.cabinet_estimate.api import router as cabinet_estimate_router
from app.domains.tools.modules.item_recommender.api import router as item_recommender_router
from app.domains.tools.modules.packing.api import router as packing_router
from app.domains.tools.modules.packing.demo_api import router as packing_demo_router
from app.domains.tools.modules.packing.lead_api import limiter as packing_lead_limiter
from app.domains.tools.modules.packing.lead_api import public_router as packing_leads_public_router
from app.domains.tools.modules.packing.lead_api import router as packing_leads_router
from app.domains.tools.modules.packing.lead_cleanup import cleanup_expired_leads
from app.domains.tools.modules.pdf_editor.api import router as pdf_editor_router
from app.domains.tools.modules.pdf_editor.company_docs_api import router as company_docs_router
from app.domains.tools.modules.pdf_editor.in_person_api import router as sign_in_person_router
from app.domains.tools.modules.pdf_editor.sign_api import public_router as sign_public_router
from app.domains.tools.modules.pdf_editor.sign_api import router as sign_router
from app.domains.tools.modules.roof_analyzer.api import router as roof_analyzer_router
from app.domains.unit_prices.api import router as unit_prices_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    print(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    print(f"Environment: {settings.ENV}")
    print(f"Beta Mode: {settings.BETA_MODE}")

    try:
        with get_db_context() as db:
            cleanup_expired_leads(db)
    except Exception as exc:
        print(f"Startup packing-lead cleanup skipped: {exc}")

    yield
    # Shutdown
    print("Shutting down...")


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Simple estimating software for restoration contractors",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url="/api/redoc" if settings.DEBUG else None,
)

# Rate limiting (packing-lead public endpoints)
app.state.limiter = packing_lead_limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(DataError)
async def _invalid_data_handler(request, exc: DataError):
    """Postgres refused a value the client sent (an id that isn't a UUID, text
    longer than its column, an out-of-range number). That's a bad request,
    not a server failure."""
    logging.getLogger("scopit").warning(
        "Rejected invalid data on %s %s: %s", request.method, request.url.path,
        type(getattr(exc, "orig", exc)).__name__,
    )
    return JSONResponse(status_code=400, content={"detail": "Invalid identifier or value."})


class BodySizeLimitMiddleware:
    """Refuse request bodies over a hard ceiling before they are read.

    JSON bodies (e.g. photo batches as base64) are parsed fully into memory,
    so without a ceiling one request can exhaust the container. Endpoints
    still apply their own tighter limits; this only stops absurd sizes.
    Added before CORS so a 413 still carries CORS headers to the browser.
    """

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    too_big = int(value) > self.max_bytes
                except ValueError:
                    too_big = False
                if too_big:
                    response = JSONResponse(
                        status_code=413,
                        content={"detail": "Request is too large."},
                    )
                    return await response(scope, receive, send)
                break

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # Bodies sent without Content-Length (chunked)
                    raise HTTPException(status_code=413, detail="Request is too large.")
            return message

        return await self.app(scope, limited_receive, send)


app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.MAX_REQUEST_BODY_MB * 1024 * 1024)

# Session middleware (required for OAuth). Only holds the OAuth state for
# the few seconds of the Google round trip.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SECRET_KEY,
    max_age=15 * 60,
    same_site="lax",
    https_only=settings.ENV == "production",
)


# Security headers on every API response. The API returns JSON, PDFs and
# images that the frontend fetches or shows in <img>; it is never framed.
# (No default-src CSP: it would stop Chrome's viewer if a PDF URL were ever
# opened directly.)
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "cross-origin",
}


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    for name, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    if settings.ENV == "production":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response


# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)


# Health check
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "env": settings.ENV,
    }


# API Info
@app.get("/api")
async def api_info():
    """API information"""
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "beta_mode": settings.BETA_MODE,
    }


# Include routers
app.include_router(auth_router, prefix="/api/auth", tags=["Authentication"])
app.include_router(company_router, prefix="/api/company", tags=["Company"])
app.include_router(customer_router, prefix="/api/customers", tags=["Customers"])
app.include_router(line_item_router, prefix="/api/line-items", tags=["Line Items"])
app.include_router(estimate_router, prefix="/api/estimates", tags=["Estimates"])
app.include_router(invoice_router, prefix="/api/invoices", tags=["Invoices"])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(settings_router, prefix="/api/settings", tags=["Settings"])
app.include_router(admin_router, prefix="/api/admin", tags=["Admin"])
app.include_router(support_router, prefix="/api/support", tags=["Support"])
app.include_router(support_admin_router, prefix="/api/admin/inquiries", tags=["Admin"])
app.include_router(tools_router, prefix="/api/tools", tags=["Tools"])
app.include_router(roof_analyzer_router, prefix="/api/tools/roof-analyzer", tags=["Roof Analyzer"])
app.include_router(packing_router, prefix="/api/tools/packing", tags=["Packing Estimator"])
app.include_router(packing_demo_router, prefix="/api/demo/packing", tags=["Packing Demo"])
app.include_router(item_recommender_router, prefix="/api/tools/item-recommender", tags=["Item Recommender"])
app.include_router(cabinet_estimate_router, prefix="/api/tools/cabinet-estimate", tags=["Cabinet Estimator"])
app.include_router(bathroom_estimate_router, prefix="/api/tools/bathroom-estimate", tags=["Bathroom Estimator"])
app.include_router(product_library_router, prefix="/api/products", tags=["Product Library"])
app.include_router(unit_prices_router, prefix="/api/unit-prices", tags=["Unit Prices"])
app.include_router(pdf_editor_router, prefix="/api/tools/pdf-editor", tags=["PDF Editor"])
app.include_router(sign_in_person_router, prefix="/api/tools/pdf-editor/sign/in-person", tags=["E-Sign In Person"])
app.include_router(sign_router, prefix="/api/tools/pdf-editor/sign", tags=["E-Sign"])
app.include_router(sign_public_router, prefix="/api/sign", tags=["E-Sign Public"])
app.include_router(company_docs_router, prefix="/api/company-documents", tags=["Company Documents"])
app.include_router(packing_leads_router, prefix="/api/packing-leads", tags=["Packing Leads"])
app.include_router(packing_leads_public_router, prefix="/api/packing-leads", tags=["Packing Leads Public"])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
