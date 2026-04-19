# frontend/Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install ALL deps (needed at runtime for next start)
RUN npm ci

# Copy source
COPY . .

# Build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --omit=dev

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

# Use next start directly - no standalone needed
CMD ["./node_modules/.bin/next", "start", "-p", "3000"]