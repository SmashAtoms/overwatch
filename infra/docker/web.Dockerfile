FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages ./packages

RUN npm install
RUN npm run build -w @signalstack/web

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "@signalstack/web"]
