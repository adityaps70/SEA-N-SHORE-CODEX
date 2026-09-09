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
