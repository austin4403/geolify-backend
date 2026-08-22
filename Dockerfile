# ==========================================
# Stage 1: Build Stage
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (leverage Docker layer caching)
COPY package*.json ./
RUN npm ci

# Copy source code and build config
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# ==========================================
# Stage 2: Production Runtime
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy compiled JavaScript output from builder stage
COPY --from=builder /app/dist ./dist

# Security: Run as non-root user
USER node

EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

CMD ["node", "dist/index.js"]
