# ==============================================================================
# Production Dockerfile for Kaizen WMS Frontend Web Client (CHG-AZ-005)
# Multi-stage, unprivileged NGINX serving Vite/React SPA.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Frontend Assets
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build Vite SPA with production bundle minification
RUN npm run build && \
    if [ -d ".output/public" ] && [ ! -d "dist" ]; then cp -r .output/public dist; fi

# ------------------------------------------------------------------------------
# Stage 2: NGINX Unprivileged Production Web Server
# ------------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:alpine-slim AS runtime

USER root

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from builder
COPY --from=builder /build/dist /usr/share/nginx/html

RUN chown -R 101:101 /usr/share/nginx/html

USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]

