FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

RUN npm install --force @next/swc-linux-x64-musl

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
