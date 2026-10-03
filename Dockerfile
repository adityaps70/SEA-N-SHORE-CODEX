# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json ./
RUN npm install -g npm@11.6.0 \
    && npm install

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SITE_URL
ARG SERVER_ACTION_ALLOWED_ORIGINS

ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV SERVER_ACTION_ALLOWED_ORIGINS=${SERVER_ACTION_ALLOWED_ORIGINS}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-bookworm-slim AS runner
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
