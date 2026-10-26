# Base images: Docker's official node image, pinned by digest (scripts/aws/node-base-image.env holds the same
# digest). The deploy builds pass NODE_BASE_IMAGE=<our private ECR copy>@<digest> (scripts/aws/node-base-image.sh);
# PR CI passes the Amazon ECR Public or mirror.gcr.io reference it pulled. The default below is Amazon ECR Public,
# never Docker Hub (round C: a deploy failed on a Docker Hub sign-in timeout). No "# syntax=" line: BuildKit's
# built-in Dockerfile frontend covers everything used here, and the docker/dockerfile frontend image is only on
# Docker Hub.
ARG NODE_BASE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562

FROM ${NODE_BASE_IMAGE} AS dependencies
WORKDIR /app
# Round 14 (3.10): install exactly what package-lock.json pins.
COPY package.json package-lock.json ./
RUN npm install -g npm@11.6.0 \
    && npm ci --no-audit --no-fund

FROM ${NODE_BASE_IMAGE} AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SITE_URL
ARG SERVER_ACTION_ALLOWED_ORIGINS

ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV SERVER_ACTION_ALLOWED_ORIGINS=${SERVER_ACTION_ALLOWED_ORIGINS}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build \
    && npm run build:workers \
    && test -f dist/workers/publish-outbox.mjs \
    && test -f dist/workers/consume-notifications.mjs \
    && test -f dist/workers/learning-round-e-content.mjs \
    && test -f dist/workers/media-cdn-backfill.mjs

FROM ${NODE_BASE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NODE_EXTRA_CA_CERTS=/app/certs/ap-south-1-bundle.pem

# Round 13: the web task was OOM-killed with a bare "Killed" (native memory, not the JS heap).
# jemalloc returns freed native memory (libvips/sharp buffers) instead of fragmenting glibc arenas.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libjemalloc2 \
    && rm -rf /var/lib/apt/lists/* \
    && test -f /usr/lib/x86_64-linux-gnu/libjemalloc.so.2
ENV LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2
ENV MALLOC_CONF=background_thread:true,dirty_decay_ms:5000,muzzy_decay_ms:5000
# About 60% of the 2048 MiB task: a real JS leak now fails with a heap error and stack trace
# instead of a silent SIGKILL.
ENV NODE_OPTIONS=--max-old-space-size=1228

COPY --from=builder /app ./

RUN mkdir -p /app/certs \
    && node -e "const https=require('https');const fs=require('fs');const url='https://truststore.pki.rds.amazonaws.com/ap-south-1/ap-south-1-bundle.pem';const request=https.get(url,{timeout:10000},response=>{if(response.statusCode!==200){throw new Error('RDS CA download failed with HTTP '+response.statusCode)}const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const body=Buffer.concat(chunks);if(!body.toString('utf8').includes('-----BEGIN CERTIFICATE-----')){throw new Error('RDS CA download did not contain a PEM certificate')}fs.writeFileSync('/app/certs/ap-south-1-bundle.pem',body,{mode:0o644})})});request.on('timeout',()=>request.destroy(new Error('RDS CA download timed out')));request.on('error',error=>{console.error(error);process.exit(1)})" \
    && npm install -g npm@11.6.0 \
    && npm prune --omit=dev \
    && npm cache clean --force \
    && rm -rf .next/cache \
    && mkdir -p .next/cache \
    && chown -R node:node /app/.next

USER node
EXPOSE 3000

# Node directly (no npm wrapper, so SIGTERM reaches the server for a clean drain). The keep-alive
# timeout outlives the ALB's 60 s idle timeout, so the ALB never reuses a socket Node has closed.
CMD ["node", "node_modules/next/dist/bin/next", "start", "--keepAliveTimeout", "65000"]
