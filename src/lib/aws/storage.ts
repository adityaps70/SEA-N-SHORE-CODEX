import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let client: S3Client | null = null

export function getMediaBucketName(): string {
  const bucket = process.env.AWS_MEDIA_BUCKET?.trim()
  if (!bucket) throw new Error('aws_media_bucket_missing')
  return bucket
}

function getS3Client(): S3Client {
  client ??= new S3Client({
    region: process.env.AWS_REGION || process.env.AWS_COGNITO_REGION || 'ap-south-1',
    requestChecksumCalculation: 'WHEN_REQUIRED',
  })
  return client
}

export async function createMediaReadUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getMediaBucketName(),
    Key: key,
  })
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds })
}

/**
 * Short-lived read URL that also pins the response Content-Type and
 * Content-Disposition, so a private file is always served as its verified
 * type and with a safe file name.
 */
export async function createMediaDownloadUrl(input: {
  key: string
  contentType: string
  contentDisposition: string
  expiresInSeconds?: number
}): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getMediaBucketName(),
    Key: input.key,
    ResponseContentType: input.contentType,
    ResponseContentDisposition: input.contentDisposition,
    ResponseCacheControl: 'private, max-age=300',
  })
  return getSignedUrl(getS3Client(), command, { expiresIn: input.expiresInSeconds ?? 300 })
}

/** Reads only the first bytes of an object (for file-signature checks). */
export async function readMediaObjectPrefix(key: string, byteCount: number): Promise<Uint8Array> {
  const length = Math.max(1, Math.floor(byteCount))
  const response = await getS3Client().send(new GetObjectCommand({
    Bucket: getMediaBucketName(),
    Key: key,
    Range: `bytes=0-${length - 1}`,
  }))
  if (!response.Body) throw new Error('media_object_body_missing')
  const body = await response.Body.transformToByteArray()
  return body.byteLength > length ? body.slice(0, length) : body
}

export async function createMediaUploadUrl(
  input: { key: string; contentType: string },
  expiresInSeconds = 300,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getMediaBucketName(),
    Key: input.key,
    ContentType: input.contentType,
  })
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds })
}

export async function headMediaObject(key: string): Promise<{
  contentType: string | null
  contentLength: number | null
}> {
  const response = await getS3Client().send(new HeadObjectCommand({
    Bucket: getMediaBucketName(),
    Key: key,
  }))

  return {
    contentType: response.ContentType ?? null,
    contentLength: typeof response.ContentLength === 'number' ? response.ContentLength : null,
  }
}

export async function getMediaObject(input: {
  key: string
  maxBytes?: number
}): Promise<{
  body: Uint8Array
  contentType: string | null
  contentLength: number
}> {
  const maximum = input.maxBytes ?? 250 * 1024 * 1024
  const response = await getS3Client().send(new GetObjectCommand({
    Bucket: getMediaBucketName(),
    Key: input.key,
  }))
  const contentLength = typeof response.ContentLength === 'number' ? response.ContentLength : null
  if (contentLength !== null && contentLength > maximum) throw new Error('media_object_too_large')
  if (!response.Body) throw new Error('media_object_body_missing')
  const body = await response.Body.transformToByteArray()
  if (body.byteLength > maximum) throw new Error('media_object_too_large')
  return {
    body,
    contentType: response.ContentType ?? null,
    contentLength: body.byteLength,
  }
}

export async function putMediaObject(input: {
  key: string
  body: Uint8Array | Buffer
  contentType: string
}): Promise<void> {
  await getS3Client().send(new PutObjectCommand({
    Bucket: getMediaBucketName(),
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
  }))
}

export async function deleteMediaObject(key: string): Promise<void> {
  await getS3Client().send(new DeleteObjectCommand({
    Bucket: getMediaBucketName(),
    Key: key,
  }))
}
