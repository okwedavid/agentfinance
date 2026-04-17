# subtask-worker/Dockerfile
FROM node:20-slim

WORKDIR /app

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

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD node -e "process.exit(0)" || exit 1

CMD ["npm", "run", "start"]
