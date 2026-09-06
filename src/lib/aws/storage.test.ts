import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { send, getSignedUrl } = vi.hoisted(() => ({
  send: vi.fn<(command: unknown) => Promise<unknown>>(async () => ({})),
  getSignedUrl: vi.fn<(
    client: unknown,
    command: unknown,
    options: { expiresIn: number },
  ) => Promise<string>>(async () => 'https://signed.example/media'),
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
    },
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    DeleteObjectCommand: Command,
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }))

import {
  createMediaReadUrl,
  deleteMediaObject,
  getMediaBucketName,
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

  it('signs media reads for 3600 seconds by default', async () => {
    const url = await createMediaReadUrl('profile/post/image.jpg')

    expect(url).toBe('https://signed.example/media')
    expect(getSignedUrl).toHaveBeenCalledTimes(1)
    expect(getSignedUrl.mock.calls[0]![2]).toEqual({ expiresIn: 3600 })
    const command = getSignedUrl.mock.calls[0]![1] as { input: Record<string, unknown> }
    expect(command.input).toMatchObject({ Bucket: mediaBucket, Key: 'profile/post/image.jpg' })
  })

  it('deletes the exact media object key', async () => {
    await deleteMediaObject('profile/post/image.jpg')

    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0]![0] as { input: Record<string, unknown> }
    expect(command.input).toMatchObject({ Bucket: mediaBucket, Key: 'profile/post/image.jpg' })
  })
})
