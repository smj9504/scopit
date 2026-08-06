# Scopit — Production Deployment Guide

> Target: scopit.work (frontend) + api.scopit.work (backend)
> Stack: Vercel + Render + Neon PostgreSQL

---

## Step 1: Register Domain

Register `scopit.work` at [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (~$9/year, no markup).

**Alt options**: Namecheap, Google Domains, Porkbun.

---

## Step 2: Push Code to GitHub

```bash
# In the project root:
cd /path/to/scopit-project/scopit

# Create GitHub repo at github.com (private)
# Then:
git remote add origin https://github.com/YOUR_ORG/scopit.git
git push -u origin main
```

---

## Step 3: Set Up Database (Neon)

1. Go to [console.neon.tech](https://console.neon.tech)
2. Create project: **scopit**
3. Database: **scopit** / User: **scopit**
4. Copy the connection string (format: `postgresql://scopit:PASSWORD@ep-xxx.region.aws.neon.tech/scopit?sslmode=require`)

---

## Step 4: Deploy Backend (Render)

### Option A — Blueprint (render.yaml, recommended)
1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **New > Blueprint**
3. Connect your GitHub repo
4. Render reads `render.yaml` automatically
5. After deploy, go to **Environment** tab and set:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com
   - `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` = from Google Cloud Console
   - `DATABASE_URL` = Neon connection string (override the auto-generated one)

### Option B — Manual
1. New > Web Service → connect repo
2. Root directory: `backend`
3. Build: `pip install -r requirements.txt && alembic upgrade head`
4. Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Set all env vars from `backend/.env.production.example`

**Custom domain**: Settings > Custom Domains → add `api.scopit.work`

---

## Step 5: Deploy Frontend (Vercel)

```bash
cd frontend
npm install -g vercel
vercel login
vercel link  # link to your Vercel project
vercel env add VITE_API_URL production
# Enter: https://api.scopit.work/api
vercel --prod
```

**Or via Vercel dashboard**:
1. New Project → Import from GitHub
2. Framework: Vite
3. Root directory: `frontend`
4. Environment variable: `VITE_API_URL` = `https://api.scopit.work/api`
5. Deploy

**Custom domain**: Settings > Domains → add `scopit.work` and `www.scopit.work`

---

## Step 6: Configure DNS

After getting your Render URL (e.g., `scopit-api.onrender.com`) and Vercel URL:

| Type  | Name | Value |
|-------|------|-------|
| CNAME | api  | `scopit-api.onrender.com` |
| CNAME | www  | `cname.vercel-dns.com` |
| A     | @    | `76.76.19.61` (Vercel IP) |

---

## Step 7: Update Google OAuth

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
- Add to **Authorized redirect URIs**: `https://api.scopit.work/api/auth/google/callback`
- Add to **Authorized JavaScript origins**: `https://scopit.work`

---

## Step 8: Run Database Migrations

Render runs `alembic upgrade head` automatically during build. To run manually:

```bash
# From backend/ with DATABASE_URL set
alembic upgrade head
```

---

## Step 9: Smoke Test

```bash
# Health check
curl https://api.scopit.work/health

# Frontend
open https://scopit.work
```

---

## Required Secrets (GitHub Actions)

Set these in GitHub repo > Settings > Secrets > Actions:

| Secret | Where to get |
|--------|-------------|
| `RENDER_API_KEY` | Render > Account > API Keys |
| `RENDER_SERVICE_ID` | Render service URL (srv-xxxxx) |
| `VERCEL_TOKEN` | vercel.com > Settings > Tokens |

---

## Cost Summary

| Service | Free tier | Paid |
|---------|-----------|------|
| Vercel (frontend) | 100GB/mo, unlimited | $20/mo pro |
| Render (backend) | 750 hrs/mo | $7/mo starter |
| Neon (database) | 0.5GB, 97 days | $19/mo |
| Cloudflare (domain) | — | ~$9/yr |
| **Total** | **~$0** startup | **~$7-46/mo** |

For beta launch: free tier is sufficient (Render free spins down after 15min idle — use starter $7/mo to avoid cold starts).

---

*Last updated: 2026-04-05*
