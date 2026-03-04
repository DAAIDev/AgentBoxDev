FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY seed.js ./
COPY schema.sql ./

EXPOSE 8080
ENV PORT=8080

CMD ["node", "server.js"]
