# coordinator/Dockerfile
FROM node:20-slim

WORKDIR /app

# Build deps
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    bash \
    openssl \
    ca-certificates \
    git \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

RUN mkdir -p src
COPY index.js src/index.js
COPY . .

# If Prisma used here
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate || true; fi

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:4100/health || exit 1

CMD ["npm", "run", "start"]
