# ==============================================================================
# Production Dockerfile for Kaizen WMS Frontend Web Client (CHG-AZ-005)
# Multi-stage, Node.js runtime serving TanStack Start / Nitro SSR & Assets.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Frontend Assets
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_BUSINESS_API_URL="https://kaizen-wms-backend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io"
ENV VITE_BUSINESS_API_URL=$VITE_BUSINESS_API_URL
ENV VITE_BUSINESS_SERVICE_URL=$VITE_BUSINESS_API_URL
ENV NODE_OPTIONS="--experimental-require-module"

# Build TanStack Start SSR application with node-server preset
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production Node.js Server for TanStack Start SSR
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV NITRO_PORT=8080
ENV NITRO_HOST=0.0.0.0

# Copy compiled output from builder
COPY --from=builder /build/.output /app/.output

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/ || exit 1

CMD ["node", ".output/server/index.mjs"]
