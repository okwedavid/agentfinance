FROM node:22

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --include=dev

# Copy source code
COPY . .

# FORCE install prisma CLI + generate client using npx (always works)
RUN npm install prisma@latest --save-dev && \
    npx prisma generate

EXPOSE 4000

CMD ["npm", "run", "start"]
