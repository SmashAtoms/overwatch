FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY apps/gateway-api/package.json apps/gateway-api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/policy/package.json packages/policy/package.json

RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "-c", "cd /app/apps/gateway-api && npx tsx src/index.ts"]
