import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { send, getSignedUrl, s3ClientState } = vi.hoisted(() => ({
  send: vi.fn<(command: unknown) => Promise<unknown>>(async () => ({})),
  getSignedUrl: vi.fn<(
    client: unknown,
    command: unknown,
    options: { expiresIn: number },
  ) => Promise<string>>(async () => 'https://signed.example/media'),
  s3ClientState: { config: null as Record<string, unknown> | null },
}))

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }

  return {
    S3Client: class {
      send = send
      constructor(config: Record<string, unknown>) {
        s3ClientState.config = config
      }
    },
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    DeleteObjectCommand: Command,
    HeadObjectCommand: Command,
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }))

import {
  createMediaReadUrl,
  createMediaUploadUrl,
  deleteMediaObject,
  getMediaBucketName,
  headMediaObject,
  putMediaObject,
} from './storage'

const mediaBucket = 'sea-n-shore-staging-310356785722-media'

describe('AWS media storage boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AWS_MEDIA_BUCKET = mediaBucket
  })

  afterEach(() => {
    delete process.env.AWS_MEDIA_BUCKET
  })

  it('fails predictably when the media bucket is missing', () => {
    delete process.env.AWS_MEDIA_BUCKET

    expect(() => getMediaBucketName()).toThrow('aws_media_bucket_missing')
  })

  it('uploads to the configured private media bucket with the exact key and content type', async () => {
    await putMediaObject({
      key: 'profile/post/image.jpg',
      body: Buffer.from('image'),
      contentType: 'image/jpeg',
    })

    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0]![0] as { input: Record<string, unknown> }
    expect(command.input).toMatchObject({
      Bucket: mediaBucket,
      Key: 'profile/post/image.jpg',
      ContentType: 'image/jpeg',
    })
  })

  it('constructs the S3 client with checksum calculation limited to required operations', async () => {
    await createMediaUploadUrl({
      key: 'profile/post/video.mp4',
      contentType: 'video/mp4',
    })

    expect(s3ClientState.config).toMatchObject({
      requestChecksumCalculation: 'WHEN_REQUIRED',
    })
  })

  it('signs media reads for 3600 seconds by default', async () => {
    const url = await createMediaReadUrl('profile/post/image.jpg')

    expect(url).toBe('https://signed.example/media')
    expect(getSignedUrl).toHaveBeenCalledTimes(1)
    expect(getSignedUrl.mock.calls[0]![2]).toEqual({ expiresIn: 3600 })
    const command = getSignedUrl.mock.calls[0]![1] as { input: Record<string, unknown> }
    expect(command.input).toMatchObject({ Bucket: mediaBucket, Key: 'profile/post/image.jpg' })
  })

  it('signs direct PUT uploads for five minutes with the exact key and content type', async () => {
    const url = await createMediaUploadUrl({
      key: 'profile/post/video.mp4',
      contentType: 'video/mp4',
    })

    expect(url).toBe('https://signed.example/media')
    expect(getSignedUrl).toHaveBeenCalledTimes(1)
    expect(getSignedUrl.mock.calls[0]![2]).toEqual({ expiresIn: 300 })
    const command = getSignedUrl.mock.calls[0]![1] as { input: Record<string, unknown> }
    expect(command.input).toMatchObject({
      Bucket: mediaBucket,
      Key: 'profile/post/video.mp4',
      ContentType: 'video/mp4',
    })
  })

  it('reads object metadata with HEAD without downloading object bytes', async () => {
    send.mockResolvedValueOnce({ ContentType: 'video/webm', ContentLength: 123456 })

    await expect(headMediaObject('profile/post/video.webm')).resolves.toEqual({
      contentType: 'video/webm',
      contentLength: 123456,
    })

    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0]![0] as { input: Record<string, unknown> }
    expect(command.input).toEqual({ Bucket: mediaBucket, Key: 'profile/post/video.webm' })
  })

  it('normalizes missing HEAD metadata to null values', async () => {
    send.mockResolvedValueOnce({})

    await expect(headMediaObject('profile/post/image.webp')).resolves.toEqual({
      contentType: null,
      contentLength: null,
    })
  })

  it('deletes the exact media object key', async () => {
    await deleteMediaObject('profile/post/image.jpg')

    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0]![0] as { input: Record<string, unknown> }
    expect(command.input).toMatchObject({ Bucket: mediaBucket, Key: 'profile/post/image.jpg' })
  })
})
