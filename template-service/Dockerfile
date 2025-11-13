FROM node:20-alpine

# Install curl for healthcheck
# RUN apk add --no-cache curl

# Create app directory
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Copy package files
COPY package*.json ./

# Install dependencies as root
RUN npm ci --silent --only=production && \
    npm cache clean --force

# Copy application code
COPY --chown=nestjs:nodejs . .

# Build application
RUN npm run build

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 8084

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:8084/health || exit 1

# Start application
CMD ["node", "dist/main.js"]
