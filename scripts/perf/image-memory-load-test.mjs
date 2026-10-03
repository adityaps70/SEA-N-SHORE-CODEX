// Round 13 load test: replays member-photo traffic through Next's image optimizer against the
// production build and samples the server's resident memory, to show that stable signed media
// links keep memory flat across simulated clock-hour boundaries (cache hits), and how much a
// full re-optimisation storm (the old hourly behaviour) costs with the new memory bounds.
//
// Prerequisites (local only, nothing touches AWS): `npm run build`, a moto S3 server
// (`moto_server -p 5055`), and `127.0.0.1 <bucket>.localhost` in /etc/hosts.
// Usage: node scripts/perf/image-memory-load-test.mjs [--images 40] [--port 3100]
import { spawn } from 'node:child_process'
import { createHash, createHmac, hkdfSync } from 'node:crypto'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import sharp from 'sharp'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => (
  value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []))
const IMAGES = Number(args.images ?? 40)
const PORT = Number(args.port ?? 3100)
// --allocator glibc runs without jemalloc, for comparison with the production image.
const JEMALLOC = (args.allocator ?? 'jemalloc') === 'jemalloc'
const BUCKET = 'loadtest-media'
const SECRET = 'loadtest-realtime-ticket-secret-0123456789abcdef'
const WIDTHS = [96, 256, 640, 1080]
const CONCURRENCY = 6
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

// Same derivation as src/lib/images/media-image-link.ts (checked by the first request's 200).
const linkKey = Buffer.from(hkdfSync('sha256', SECRET, Buffer.alloc(0), 'sea-n-shore/media-image-link/v1', 32))
function link(key, now = Date.now()) {
  const offset = createHash('sha256').update(key).digest().readUInt32BE(0) % WINDOW_MS
  const window = Math.floor((now + offset) / WINDOW_MS)
  const signature = createHmac('sha256', linkKey).update(`${key}\n${window}`).digest('base64url').slice(0, 32)
  return `/api/media/image/${key.split('/').map(encodeURIComponent).join('/')}?w=${window}&s=${signature}`
}

const s3 = new S3Client({
  region: 'ap-south-1',
  endpoint: 'http://localhost:5055',
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
})

async function photo(seed) {
  // A 4032x3024 (12 MP, phone-camera sized) noisy JPEG: the worst case for decode memory.
  const width = 4032
  const height = 3024
  const raw = Buffer.alloc(width * height * 3)
  let state = seed * 2654435761
  for (let index = 0; index < raw.length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0
    raw[index] = (state >>> 16) & 0xff
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer()
}

async function seed(prefix, count) {
  const keys = []
  for (let index = 0; index < count; index += 1) {
    const key = `profiles/${prefix}${String(index).padStart(4, '0')}/cover-${prefix}${index}.jpg`
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: await photo(index + prefix.length * 1000), ContentType: 'image/jpeg' }))
    keys.push(key)
  }
  return keys
}

function listPids() {
  return readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map(Number)
}

/** Resident memory of the server and all its child processes, in MiB. */
function treeRssMb(rootPid) {
  const children = new Map()
  for (const pid of listPids()) {
    try {
      const ppid = Number(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1])
      children.set(ppid, [...(children.get(ppid) ?? []), pid])
    } catch { /* process exited */ }
  }
  let total = 0
  const stack = [rootPid]
  while (stack.length) {
    const pid = stack.pop()
    try {
      const rss = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))
      total += rss ? Number(rss[1]) : 0
    } catch { /* process exited */ }
    stack.push(...(children.get(pid) ?? []))
  }
  return Math.round(total / 1024)
}

async function replay(label, urls, pid) {
  const samples = []
  const sampler = setInterval(() => samples.push(treeRssMb(pid)), 500)
  const started = Date.now()
  let hits = 0
  let misses = 0
  let failures = 0
  const queue = [...urls]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const url = queue.shift()
      const response = await fetch(`http://127.0.0.1:${PORT}${url}`, { headers: { accept: 'image/webp,image/*' } })
      await response.arrayBuffer()
      if (!response.ok) failures += 1
      else if (response.headers.get('x-nextjs-cache') === 'HIT') hits += 1
      else misses += 1
    }
  }))
  clearInterval(sampler)
  samples.push(treeRssMb(pid))
  const result = { label, requests: urls.length, hits, misses, failures, seconds: Math.round((Date.now() - started) / 1000), rssMaxMb: Math.max(...samples), rssEndMb: samples.at(-1) }
  console.log('LOAD_PHASE ' + JSON.stringify(result))
  return result
}

const optimizedUrls = (keys) => keys.flatMap((key) => WIDTHS.map((width) =>
  `/_next/image?url=${encodeURIComponent(link(key))}&w=${width}&q=${width <= 256 ? 75 : 90}`))

// Start from an empty optimizer disk cache so every run measures the same misses.
rmSync('.next/cache/images', { recursive: true, force: true })
await s3.send(new CreateBucketCommand({ Bucket: BUCKET, CreateBucketConfiguration: { LocationConstraint: 'ap-south-1' } })).catch(() => {})
console.log(`seeding ${IMAGES} 12 MP photos`)
const stableKeys = await seed('stable', IMAGES)

const server = spawn('node', ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT), '--keepAliveTimeout', '65000'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    ...(JEMALLOC ? {
      LD_PRELOAD: '/usr/lib/x86_64-linux-gnu/libjemalloc.so.2',
      MALLOC_CONF: 'background_thread:true,dirty_decay_ms:5000,muzzy_decay_ms:5000',
    } : {}),
    // The app validates these at request time; the load test never signs anyone in.
    AWS_COGNITO_REGION: 'ap-south-1',
    AWS_COGNITO_USER_POOL_ID: 'ap-south-1_loadtest',
    AWS_COGNITO_CLIENT_ID: 'loadtest',
    NODE_OPTIONS: '--max-old-space-size=1228',
    REALTIME_TICKET_SECRET: SECRET,
    AWS_MEDIA_BUCKET: BUCKET,
    AWS_ENDPOINT_URL_S3: 'http://localhost:5055',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_REGION: 'ap-south-1',
    NO_PROXY: '*',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', () => {})
server.stderr.on('data', (chunk) => process.stderr.write(chunk))
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/auth/sign-in`)).status < 500) break } catch { /* not up yet */ }
  await delay(1000)
}
const probe = await fetch(`http://127.0.0.1:${PORT}${link(stableKeys[0])}`)
if (probe.status !== 200) throw new Error('media link probe failed: ' + probe.status)
console.log(`ALLOCATOR ${JEMALLOC ? 'jemalloc' : 'glibc'}`)
console.log('IDLE_RSS_MB ' + treeRssMb(server.pid))

const results = []
results.push(await replay('first view (all misses)', optimizedUrls(stableKeys), server.pid))
for (let hour = 1; hour <= 3; hour += 1) {
  // Stable links do not change at the top of the hour, so the same URLs are cache hits.
  results.push(await replay(`hour boundary ${hour} (stable links)`, optimizedUrls(stableKeys), server.pid))
}
for (let hour = 1; hour <= 3; hour += 1) {
  // The old behaviour: every URL changed each hour, so every photo was re-optimized at once.
  const fresh = await seed(`storm${hour}x`, IMAGES)
  results.push(await replay(`emulated old hourly storm ${hour} (all new URLs)`, optimizedUrls(fresh), server.pid))
}
await delay(15_000)
console.log('SETTLED_RSS_MB ' + treeRssMb(server.pid))
server.kill('SIGTERM')
console.log('LOAD_SUMMARY ' + JSON.stringify(results.map(({ label, hits, misses, failures, rssMaxMb }) => ({ label, hits, misses, failures, rssMaxMb }))))
