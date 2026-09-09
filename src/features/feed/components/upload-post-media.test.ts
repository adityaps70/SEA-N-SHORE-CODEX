import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadPostMediaFile } from './upload-post-media'

type ProgressHandler = ((event: ProgressEvent) => void) | null

type LoadHandler = ((event: ProgressEvent) => void) | null

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = []

  method = ''
  url = ''
  status = 0
  body: Document | XMLHttpRequestBodyInit | null = null
  headers = new Map<string, string>()
  upload: { onprogress: ProgressHandler } = { onprogress: null }
  onload: LoadHandler = null
  onerror: LoadHandler = null
  onabort: LoadHandler = null

  constructor() {
    FakeXMLHttpRequest.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value)
  }

  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.body = body ?? null
  }
}

function xhr() {
  const instance = FakeXMLHttpRequest.instances.at(-1)
  if (!instance) throw new Error('expected_xhr_instance')
  return instance
}

describe('uploadPostMediaFile', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads the file with PUT, exact Content-Type, and computable progress', async () => {
    const file = new File(['video-bytes'], 'bridge.mp4', { type: 'video/mp4' })
    const onProgress = vi.fn()

    const promise = uploadPostMediaFile({
      uploadUrl: 'https://s3.example/presigned-put',
      file,
      onProgress,
    })

    expect(xhr().method).toBe('PUT')
    expect(xhr().url).toBe('https://s3.example/presigned-put')
    expect(xhr().headers.get('Content-Type')).toBe('video/mp4')
    expect(xhr().body).toBe(file)

    xhr().upload.onprogress?.({
      lengthComputable: true,
      loaded: 25,
      total: 100,
    } as ProgressEvent)
    expect(onProgress).toHaveBeenCalledWith(25)

    xhr().status = 204
    xhr().onload?.(new ProgressEvent('load'))
    await expect(promise).resolves.toBeUndefined()
  })

  it('ignores progress events whose total length is not computable', () => {
    const onProgress = vi.fn()
    void uploadPostMediaFile({
      uploadUrl: 'https://s3.example/upload',
      file: new File(['image'], 'photo.jpg', { type: 'image/jpeg' }),
      onProgress,
    })

    xhr().upload.onprogress?.({
      lengthComputable: false,
      loaded: 1,
      total: 0,
    } as ProgressEvent)

    expect(onProgress).not.toHaveBeenCalled()
  })

  it.each([
    ['non-2xx response', () => {
      xhr().status = 403
      xhr().onload?.(new ProgressEvent('load'))
    }],
    ['network failure', () => xhr().onerror?.(new ProgressEvent('error'))],
    ['abort', () => xhr().onabort?.(new ProgressEvent('abort'))],
  ])('rejects with a safe error on %s', async (_label, fail) => {
    const promise = uploadPostMediaFile({
      uploadUrl: 'https://s3.example/upload',
      file: new File(['image'], 'photo.webp', { type: 'image/webp' }),
      onProgress: vi.fn(),
    })

    fail()
    await expect(promise).rejects.toThrow('media_upload_failed')
  })
})
