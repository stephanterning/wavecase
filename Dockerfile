# Compile architecture-independent JavaScript/CSS natively, not through QEMU.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Install runtime dependencies above for the target architecture; only share bundles.
COPY --from=build /app/build ./build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && npm start"]
