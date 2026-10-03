import { pathToFileURL } from 'node:url'

const DEFAULT_SOURCE_BUCKET = 'post-media'

function objectSize(value) {
  return Number.isFinite(value) && value >= 0 ? Number(value) : null
}

function verificationError(key, reason) {
  return new Error(`migration_verification_failed:${key}:${reason}`)
}

export async function migratePostMedia({
  source,
  destination,
  sourceBucket = DEFAULT_SOURCE_BUCKET,
  destinationBucket,
  dryRun = false,
  now = () => new Date(),
}) {
  if (!source || typeof source.listObjects !== 'function' || typeof source.downloadObject !== 'function') {
    throw new Error('migration_source_adapter_required')
  }
  if (!destination || typeof destination.headObject !== 'function' || typeof destination.putObject !== 'function') {
    throw new Error('migration_destination_adapter_required')
  }
  if (!destinationBucket) throw new Error('migration_destination_bucket_required')

  const sourceObjects = await source.listObjects()
  let sourceBytes = 0
  let copiedCount = 0
  let verifiedCount = 0

  for (const object of sourceObjects) {
    if (!object?.key) throw new Error('migration_source_key_required')
    const expectedSize = objectSize(object.size)
    if (expectedSize !== null) sourceBytes += expectedSize

    const existing = await destination.headObject(object.key)
    if (existing) {
      const destinationSize = objectSize(existing.size)
      if (expectedSize !== null && destinationSize !== expectedSize) {
        throw verificationError(object.key, 'size_mismatch')
      }
      verifiedCount += 1
      continue
    }

    if (dryRun) continue

    const body = await source.downloadObject(object.key)
    const actualSourceSize = body?.byteLength
    if (!Number.isFinite(actualSourceSize)) {
      throw verificationError(object.key, 'source_bytes_unavailable')
    }
    if (expectedSize !== null && actualSourceSize !== expectedSize) {
      throw verificationError(object.key, 'source_size_mismatch')
    }

    await destination.putObject({
      key: object.key,
      body,
      contentType: object.contentType ?? 'application/octet-stream',
    })
    copiedCount += 1

    const copied = await destination.headObject(object.key)
    if (!copied) throw verificationError(object.key, 'missing_destination')
    const copiedSize = objectSize(copied.size)
    const sizeToVerify = expectedSize ?? actualSourceSize
    if (copiedSize !== sizeToVerify) throw verificationError(object.key, 'size_mismatch')
    verifiedCount += 1
  }

  return {
    sourceBucket,
    destinationBucket,
    sourceObjectCount: sourceObjects.length,
    sourceBytes,
    copiedCount,
    verifiedCount,
    timestamp: now().toISOString(),
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`missing_required_environment:${name}`)
  return value
}

function supabaseHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  }
}

function normalizeSupabaseUrl(value) {
  return value.replace(/\/+$/, '')
}

function joinObjectPath(prefix, name) {
  return prefix ? `${prefix}/${name}` : name
}

export function createSupabaseSource({ url, serviceRoleKey, bucket = DEFAULT_SOURCE_BUCKET, fetchImpl = fetch }) {
  const baseUrl = normalizeSupabaseUrl(url)
  const headers = supabaseHeaders(serviceRoleKey)

  async function listFolder(prefix) {
    const objects = []
    let offset = 0
    const limit = 100

    while (true) {
      const response = await fetchImpl(`${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prefix,
          limit,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        }),
      })
      if (!response.ok) throw new Error(`supabase_storage_list_failed:${response.status}`)
      const entries = await response.json()
      if (!Array.isArray(entries)) throw new Error('supabase_storage_list_invalid_response')

      for (const entry of entries) {
        const key = joinObjectPath(prefix, entry.name)
        if (entry.id) {
          objects.push({
            key,
            size: objectSize(entry.metadata?.size),
            contentType: entry.metadata?.mimetype ?? entry.metadata?.contentType ?? null,
          })
        } else {
          objects.push(...await listFolder(key))
        }
      }

      if (entries.length < limit) break
      offset += limit
    }

    return objects
  }

  return {
    async listObjects() {
      return listFolder('')
    },
    async downloadObject(key) {
      const encodedKey = key.split('/').map(encodeURIComponent).join('/')
      const response = await fetchImpl(
        `${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodedKey}`,
        { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } },
      )
      if (!response.ok) throw new Error(`supabase_storage_download_failed:${response.status}:${key}`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}

export async function createS3Destination({ bucket, region = process.env.AWS_REGION || 'ap-south-1' }) {
  const { S3Client, HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const client = new S3Client({ region })

  return {
    async headObject(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return { key, size: objectSize(result.ContentLength) }
      } catch (error) {
        const status = error?.$metadata?.httpStatusCode
        const name = error?.name
        if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return null
        throw error
      }
    },
    async putObject({ key, body, contentType }) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }))
    },
  }
}

async function main() {
  const sourceBucket = process.env.SUPABASE_POST_MEDIA_BUCKET?.trim() || DEFAULT_SOURCE_BUCKET
  const destinationBucket = requiredEnv('AWS_MEDIA_BUCKET')
  const source = createSupabaseSource({
    url: requiredEnv('SUPABASE_URL'),
    serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    bucket: sourceBucket,
  })
  const destination = await createS3Destination({ bucket: destinationBucket })
  const summary = await migratePostMedia({
    source,
    destination,
    sourceBucket,
    destinationBucket,
    dryRun: process.env.DRY_RUN?.toLowerCase() === 'true',
  })

  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectExecution) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'migration_failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
