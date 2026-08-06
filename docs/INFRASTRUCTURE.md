# Scopit - 인프라 가이드

> 환경 설정, Docker, CI/CD, 배포 가이드

---

## 🌍 환경 구성

| 환경 | Frontend | Backend | Database |
|------|----------|---------|----------|
| **Local** | localhost:3000 | localhost:8000 | Docker PostgreSQL |
| **Stage** | stage.scopit.work | api.stage.scopit.work | Neon (stage) |
| **Production** | scopit.work | api.scopit.work | Neon (prod) |

### 비용 예상

| 서비스 | 무료 | 유료 |
|--------|------|------|
| Vercel | 100GB/월 | $20/월 |
| Render | 750시간/월 | $7/월 |
| Neon | 0.5GB | $19/월 |
| **합계** | **$0** | **$7~26/월** |

---

## 🐳 Docker

### Backend Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y gcc libpq-dev

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### docker-compose.local.yml

```yaml
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: scopit
      POSTGRES_PASSWORD: scopit123
      POSTGRES_DB: scopit_local
    ports:
      - "5432:5432"
    volumes:
      - scopit_db:/var/lib/postgresql/data

  backend:
    build: ./backend
    environment:
      - ENV=local
    env_file:
      - ./backend/.env.local
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app
    depends_on:
      - db
    command: uvicorn app.main:app --reload --host 0.0.0.0

  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - backend

volumes:
  scopit_db:
```

---

## 🚀 CI/CD (GitHub Actions)

### ci.yml

```yaml
name: CI

on:
  push:
    branches: [main, develop]

jobs:
  backend-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r backend/requirements.txt pytest
      - run: pytest backend/tests/

  frontend-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm ci
        working-directory: frontend
      - run: npm test -- --watchAll=false
        working-directory: frontend
```

### deploy-prod.yml

```yaml
name: Deploy Production

on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Render
        run: |
          curl -X POST "https://api.render.com/v1/services/${{ secrets.RENDER_SERVICE_ID }}/deploys" \
            -H "Authorization: Bearer ${{ secrets.RENDER_API_KEY }}"

  deploy-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-args: '--prod'
          working-directory: ./frontend
```

---

## ☁️ 서비스 설정

### Vercel (Frontend)

```bash
npm i -g vercel
vercel login
vercel link
vercel env add REACT_APP_API_URL
vercel --prod
```

### Render (Backend)

```yaml
# render.yaml
services:
  - type: web
    name: scopit-api
    env: python
    plan: starter
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: scopit-db
```

### Neon (PostgreSQL)

1. https://console.neon.tech 접속
2. Create Project: scopit
3. Branches: main (prod), stage
4. Connection String 복사 → 환경변수 설정

---

## 🔐 보안 체크리스트

- [ ] SECRET_KEY 랜덤 생성 (32자+)
- [ ] Production DEBUG=false
- [ ] .env 파일 .gitignore 추가
- [ ] HTTPS 강제
- [ ] CORS 도메인 제한

---

## 📋 배포 체크리스트

### Stage
- [ ] develop 브랜치 머지
- [ ] CI 통과 확인
- [ ] Stage 배포 확인
- [ ] 기능 테스트

### Production
- [ ] main 브랜치 머지
- [ ] CI 통과 확인
- [ ] DB 마이그레이션
- [ ] 배포 후 헬스체크
- [ ] 스모크 테스트

---

*Last Updated: 2026-01-26*
