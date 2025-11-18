# backend/Dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
# Create app directory
WORKDIR /app

# Install OS-level build deps needed for native modules & Prisma
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

# Copy app source
COPY . .

# If Prisma schema exists, generate the client
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate || true; fi
#RUN npx prisma migrate deploy || npx prisma db push

# Expose backend port (update if your backend uses another port)
EXPOSE 4000

# Healthcheck (adjust /health path if different)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:4000/health || exit 1

# Default command
CMD ["npm", "run", "start"]
