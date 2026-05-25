FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY seed.js ./
COPY schema.sql ./

# kanban → GitHub Issues sync (legacy single-shot classifier path)
COPY kanban-github-sync.mjs ./

# Wedge 1 triage worker + tool wrappers + system prompt
COPY triage.mjs ./
COPY tools ./tools
COPY prompts ./prompts

EXPOSE 8080
ENV PORT=8080

CMD ["node", "server.js"]
