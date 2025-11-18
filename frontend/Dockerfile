# frontend/Dockerfile (dev)
FROM node:20-slim

WORKDIR /app
#RUN apk add --no-cache libc6-compat
# Install deps needed for building
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    bash \
    ca-certificates \
    git \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Use npm ci for deterministic install
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

# For Next.js dev - change to "start" or "start:prod" if using production
CMD ["npm", "run", "dev"]
