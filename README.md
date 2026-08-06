# Scopit

Simple estimating software for restoration contractors.

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+
- A [Neon](https://neon.tech) PostgreSQL project (used for local dev and production)
- Docker (optional)

### Option 1: Docker

```bash
# Set DATABASE_URL in .env to your Neon connection string first (see below)
docker-compose up -d

# Frontend: http://localhost:3001
# Backend:  http://localhost:8001
# API Docs: http://localhost:8001/api/docs
```

### Option 2: Manual Setup

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Set DATABASE_URL in .env.local to your Neon connection string, then:
alembic upgrade head

# Run server
uvicorn main:app --reload --port 8001
```

#### Frontend

```bash
cd frontend
npm install
npm run dev  # http://localhost:3001
```

## Project Structure

```
scopit/
├── backend/
│   ├── app/
│   │   ├── core/           # Config, database, security, storage
│   │   ├── common/         # Shared utilities
│   │   └── domains/        # Feature modules (DDD)
│   │       ├── auth/
│   │       ├── company/
│   │       ├── customer/
│   │       ├── estimate/
│   │       ├── invoice/
│   │       ├── line_item/
│   │       └── tools/      # PDF editor, packing, roof analyzer
│   ├── alembic/            # Database migrations
│   └── main.py
├── frontend/
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Page components
│   │   ├── services/       # API services
│   │   ├── stores/         # Zustand stores
│   │   ├── hooks/          # Custom hooks
│   │   └── types/          # TypeScript types
│   └── index.html
├── render.yaml             # Render deployment blueprint
└── docker-compose.yml
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript, Vite 5, Ant Design 5, Zustand, TanStack Query |
| Backend | FastAPI, Python 3.11+, SQLAlchemy 2.0 (sync), Pydantic V2 |
| Database | PostgreSQL 15 (NeonDB) |
| File Storage | Local (dev) / Cloudflare R2 (production) |
| Auth | JWT (HS256), Google OAuth |
| PDF | WeasyPrint, PyPDF, ReportLab, pdf2image |

## Deployment

### Architecture

```
Users → Vercel (Frontend) → Render (Backend API) → NeonDB (PostgreSQL)
                                    ↕
                            Cloudflare R2 (Files)
```

| Service | Provider | URL |
|---------|----------|-----|
| Frontend | Vercel | `scopit.work` |
| Backend | Render | `api.scopit.work` |
| Database | NeonDB | `ep-xxx.neon.tech` |
| Files | Cloudflare R2 | `scopit-uploads` bucket |

### 1. NeonDB Setup

1. Create project at [neon.tech](https://neon.tech)
2. Copy connection string: `postgresql://user:pass@ep-xxx.neon.tech/scopit?sslmode=require`
3. Local dev uses the same Neon DB (no local Postgres container) — set `DATABASE_URL`
   in `backend/.env.local` (manual/uvicorn workflow) and in the root `.env`
   (docker-compose workflow):
   ```
   DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/scopit?sslmode=require
   ```
   Consider creating a separate Neon branch (e.g. `dev`) for local work so it
   doesn't share data with production.

#### Migrate Local Data to NeonDB

```bash
# Dump local DB
pg_dump -U postgres -d scopit_local -Fc -f scopit_backup.dump

# Restore to NeonDB
pg_restore -h ep-xxx.neon.tech -U scopit -d scopit \
  --no-owner --no-privileges scopit_backup.dump
```

### 2. Cloudflare R2 Setup

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → R2
2. Create bucket: `scopit-uploads`
3. Create API token: R2 → Manage R2 API Tokens → Create API Token
4. Note: `Account ID`, `Access Key ID`, `Secret Access Key`
5. Endpoint URL: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

#### Migrate Local Files to R2

```bash
# Install rclone
# Configure rclone with R2 credentials, then:
rclone copy ./backend/uploads r2:scopit-uploads --progress
```

After migrating files, update `file_path` and `thumbnail_path` columns
in the database to use storage keys (strip the `uploads/` prefix):

```sql
UPDATE pdf_documents
SET file_path = REPLACE(file_path, 'uploads/', ''),
    thumbnail_path = REPLACE(thumbnail_path, 'uploads/', '')
WHERE file_path LIKE 'uploads/%';

UPDATE company_documents
SET file_path = REPLACE(file_path, 'uploads/', ''),
    thumbnail_path = REPLACE(thumbnail_path, 'uploads/', '')
WHERE file_path LIKE 'uploads/%';

UPDATE sign_requests
SET signed_file_path = REPLACE(signed_file_path, 'uploads/', '')
WHERE signed_file_path LIKE 'uploads/%';
```

### 3. Render (Backend)

The backend deploys on Render's **Docker** runtime (not native Python) because
WeasyPrint (PDF generation) and pdf2image (PDF editor) require system libraries
— `libpango`/`libcairo`/`libgdk-pixbuf` and `poppler-utils` — that the native
runtime cannot install. These are provided by `backend/Dockerfile`. Database
migrations (`alembic upgrade head`) run automatically on every container start.

1. Connect GitHub repo at [render.com](https://render.com)
2. Use the `render.yaml` blueprint (recommended — it creates the service as a
   Docker web service), or create a Web Service manually:
   - **Runtime**: Docker
   - **Dockerfile Path**: `./backend/Dockerfile`
   - **Docker Context**: `./backend`
3. Set environment variables in Render dashboard (blueprint marks these
   `sync: false`, so they must be filled in there):
   - `DATABASE_URL` (NeonDB connection string)
   - `CORS_ORIGINS` (your Vercel URL, e.g. `https://scopit.work`)
   - `FRONTEND_URL`, `GOOGLE_REDIRECT_URI`
   - `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `ANTHROPIC_API_KEY`
4. Add custom domain: `api.scopit.work`

> **Free plan note:** The Item Recommender (semantic search) loads a
> sentence-transformers/torch model (~500MB–1GB RAM) that exceeds the free
> plan's 512MB limit, so `ITEM_RECOMMENDER_ENABLED` is set to `False` in
> `render.yaml`. After upgrading to a paid plan (e.g. Starter) with more RAM —
> and providing the `parsed_json` dataset — set it to `True` to enable the tool.
> The free plan also spins the service down after inactivity, causing a cold
> start (~30–60s) on the next request.

### 4. Vercel (Frontend)

1. Import repo at [vercel.com](https://vercel.com)
2. Set **Root Directory**: `frontend`
3. Set environment variable:
   ```
   VITE_API_URL=https://api.scopit.work/api
   ```
4. Add custom domain: `scopit.work`

### 5. DNS Configuration

```
scopit.work        → CNAME → cname.vercel-dns.com
www.scopit.work    → CNAME → cname.vercel-dns.com
api.scopit.work    → CNAME → scopit-api.onrender.com
```

### 6. Post-Deployment Checklist

- [ ] Update Google OAuth redirect URI to `https://api.scopit.work/api/auth/google/callback`
- [ ] Verify CORS allows `https://scopit.work`
- [ ] Test file upload/download with R2
- [ ] Test PDF editor operations (merge, rotate, sign)
- [ ] Test Google OAuth login flow

## Environment Variables

### Backend (.env.local)

```env
ENV=local
DEBUG=True
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/scopit?sslmode=require
SECRET_KEY=dev-secret-key
CORS_ORIGINS=http://localhost:3001
BETA_MODE=True

# File storage (default: local)
STORAGE_PROVIDER=local
STORAGE_BASE_DIR=uploads

# Item Recommender semantic search (heavy torch model).
# Set to False on memory-constrained hosts (e.g. Render free plan).
ITEM_RECOMMENDER_ENABLED=True

# Optional: use R2 locally
# STORAGE_PROVIDER=r2
# R2_ENDPOINT_URL=https://ACCOUNT_ID.r2.cloudflarestorage.com
# R2_ACCESS_KEY_ID=xxx
# R2_SECRET_ACCESS_KEY=xxx
# R2_BUCKET_NAME=scopit-uploads
```

### Frontend (.env.local)

```env
VITE_API_URL=http://localhost:8001/api
```

## Design System

| Property | Value |
|----------|-------|
| Primary | `#111827` |
| Background | `#f9fafb` |
| Border | `#e5e7eb` |
| Headings | Plus Jakarta Sans |
| Body | Inter |
| Border Radius | 6px (buttons), 12px (cards) |

**UI Library**: Ant Design 5 with custom theme

## API Documentation

- Swagger: http://localhost:8001/api/docs
- ReDoc: http://localhost:8001/api/redoc

## Testing

```bash
# Backend
cd backend && pytest

# Frontend
cd frontend && npm test
```

## License

Proprietary - All rights reserved.
