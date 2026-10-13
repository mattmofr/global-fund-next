FROM node:22-bookworm-slim

WORKDIR /app

# Keep workspace devDependencies: the production server is started through tsx.
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tests ./tests
COPY tsconfig.json ./
COPY assets ./assets
COPY ASSET_LICENSES.md ./

RUN npm ci && npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3102
EXPOSE 3102

CMD ["npm", "run", "start"]
