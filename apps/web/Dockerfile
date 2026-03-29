FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/map-core/package.json packages/map-core/package.json
COPY packages/policy/package.json packages/policy/package.json

RUN npm ci

COPY . .

RUN npm run build -w @signalstack/web

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "-c", "cd /app/apps/web && npx next start -p ${PORT:-8080}"]
