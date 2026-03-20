FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/gateway-api ./apps/gateway-api
COPY packages ./packages

RUN npm install
RUN npm run build -w @signalstack/gateway-api

EXPOSE 4000

CMD ["npm", "run", "start", "-w", "@signalstack/gateway-api"]
