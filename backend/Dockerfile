# Scopit Backend Dockerfile
FROM python:3.11-slim

WORKDIR /app

# System dependencies
#  - libpq-dev / gcc          : psycopg2 + building any C extensions
#  - poppler-utils            : pdf2image (PDF -> image, thumbnails, PDF editor)
#  - libpango* / libcairo* /  : WeasyPrint (estimate & invoice PDF generation)
#    libgdk-pixbuf / libffi /
#    shared-mime-info
#  - fonts-*                  : text rendering inside generated PDFs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    gcc \
    poppler-utils \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libpangoft2-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    libjpeg62-turbo \
    fonts-liberation \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Render provides $PORT; default to 8001 for local `docker build` / compose runs.
# Run DB migrations on startup, then launch the API.
EXPOSE 8001
CMD alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}
