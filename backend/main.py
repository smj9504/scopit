"""
ScopeIt - FastAPI Application Entry Point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings

# Import tool converters (registers them in the converter registry)
import app.domains.tools.modules.roof_analyzer.converter  # noqa: F401
import app.domains.tools.modules.packing.converter  # noqa: F401

# Import routers
from app.domains.auth.api import router as auth_router
from app.domains.company.api import router as company_router
from app.domains.customer.api import router as customer_router
from app.domains.line_item.api import router as line_item_router
from app.domains.estimate.api import router as estimate_router
from app.domains.invoice.api import router as invoice_router
from app.domains.dashboard.api import router as dashboard_router
from app.domains.settings.api import router as settings_router
from app.domains.admin.api import router as admin_router
from app.domains.tools.api import router as tools_router
from app.domains.tools.modules.roof_analyzer.api import router as roof_analyzer_router
from app.domains.tools.modules.packing.api import router as packing_router
from app.domains.tools.modules.packing.demo_api import router as packing_demo_router
from app.domains.tools.modules.item_recommender.api import router as item_recommender_router
from app.domains.tools.modules.pdf_editor.api import router as pdf_editor_router
from app.domains.tools.modules.pdf_editor.sign_api import router as sign_router
from app.domains.tools.modules.pdf_editor.sign_api import public_router as sign_public_router
from app.domains.tools.modules.pdf_editor.company_docs_api import router as company_docs_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    print(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    print(f"Environment: {settings.ENV}")
    print(f"Beta Mode: {settings.BETA_MODE}")

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

# Session middleware (required for OAuth)
app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)

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
app.include_router(tools_router, prefix="/api/tools", tags=["Tools"])
app.include_router(roof_analyzer_router, prefix="/api/tools/roof-analyzer", tags=["Roof Analyzer"])
app.include_router(packing_router, prefix="/api/tools/packing", tags=["Packing Estimator"])
app.include_router(packing_demo_router, prefix="/api/demo/packing", tags=["Packing Demo"])
app.include_router(item_recommender_router, prefix="/api/tools/item-recommender", tags=["Item Recommender"])
app.include_router(pdf_editor_router, prefix="/api/tools/pdf-editor", tags=["PDF Editor"])
app.include_router(sign_router, prefix="/api/tools/pdf-editor/sign", tags=["E-Sign"])
app.include_router(sign_public_router, prefix="/api/sign", tags=["E-Sign Public"])
app.include_router(company_docs_router, prefix="/api/company-documents", tags=["Company Documents"])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
