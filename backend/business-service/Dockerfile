# ==============================================================================
# Production Dockerfile for Kaizen WMS Business Service (CHG-AZ-001, CHG-AZ-005)
# Multi-stage, rootless, minimal Debian runtime bundled with DigiCert Root CA.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build & Wheel Compilation
# ------------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS builder

WORKDIR /build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

# Download DigiCert Global Root CA for Azure PostgreSQL Flexible Server SSL verify-full
RUN curl -fsSL -o /install/DigiCertGlobalRootCA.crt.pem \
    https://cacerts.digicert.com/DigiCertGlobalRootCA.crt.pem

# ------------------------------------------------------------------------------
# Stage 2: Minimal Production Hardened Runtime
# ------------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/app" \
    PORT=8000 \
    SSL_CERT_FILE="/etc/ssl/certs/DigiCertGlobalRootCA.crt.pem"

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-built wheels and CA certificates from builder stage
COPY --from=builder /install /usr/local
COPY --from=builder /install/DigiCertGlobalRootCA.crt.pem /etc/ssl/certs/DigiCertGlobalRootCA.crt.pem
RUN update-ca-certificates

# Create dedicated non-root application user and group (UID 10001)
RUN groupadd -g 10001 appgroup && \
    useradd -u 10001 -g appgroup -s /bin/bash -m appuser && \
    mkdir -p /app/media_uploads /app/logs && \
    chown -R appuser:appgroup /app

# Copy application source tree with correct ownership
COPY --chown=appuser:appgroup . /app

# Switch to unprivileged runtime user
USER appuser

EXPOSE 8000

# Continuous healthcheck probing the deep readiness endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health/ready || exit 1

# Production WSGI/ASGI invocation with multi-worker concurrency
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4", "--proxy-headers", "--forwarded-allow-ips", "*"]

