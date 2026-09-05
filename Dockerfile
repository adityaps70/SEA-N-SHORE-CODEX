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
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NODE_EXTRA_CA_CERTS=/app/certs/ap-south-1-bundle.pem

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

CMD ["npm", "start"]
