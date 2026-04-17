# worker/Dockerfile
FROM node:20-slim

WORKDIR /app

# Install build deps
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    bash \
    openssl \
    ca-certificates \
    git \
  && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

RUN npx prisma generate

# Healthcheck - worker process may not have HTTP; do a simple exit 0 (optional)
HEALTHCHECK --interval=60s --timeout=3s --start-period=20s \
  CMD node -e "process.exit(0)" || exit 1

CMD ["npm", "start"]
