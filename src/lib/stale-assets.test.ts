import { describe, expect, it, vi } from 'vitest'
import { isStaleAssetError, recoverFromStaleAssets } from './stale-assets'

function fakeWindow() {
  const store = new Map<string, string>()
  return {
    location: { reload: vi.fn() } as unknown as Location,
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    },
  }
}

describe('isStaleAssetError', () => {
  it('recognises Next.js chunk load failures by name or message', () => {
    const named = Object.assign(new Error('boom'), { name: 'ChunkLoadError' })
    expect(isStaleAssetError(named)).toBe(true)
    expect(isStaleAssetError(new Error('Failed to load chunk /_next/static/chunks/389-abc.js from module 1'))).toBe(true)
    expect(isStaleAssetError(new Error('Loading chunk 389 failed.'))).toBe(true)
  })

  it('recognises a form posted to a Server Action from an older build', () => {
    // Next.js throws UnrecognizedActionError in the browser when the server answers "action not found".
    const unrecognized = Object.assign(new Error('Server Action "7f3a9c0d" was not found on the server.'), { name: 'UnrecognizedActionError' })
    expect(isStaleAssetError(unrecognized)).toBe(true)
    expect(isStaleAssetError(new Error('Server Action "7f3a9c0d" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'))).toBe(true)
  })

  it('ignores ordinary errors', () => {
    expect(isStaleAssetError(new Error('Network request failed'))).toBe(false)
    expect(isStaleAssetError(null)).toBe(false)
    expect(isStaleAssetError('ChunkLoadError')).toBe(false)
    expect(isStaleAssetError(new Error('Server Action failed validation'))).toBe(false)
  })
})

describe('recoverFromStaleAssets', () => {
  it('reloads once and then refuses to loop within the guard window', () => {
    const target = fakeWindow()
    expect(recoverFromStaleAssets(target, 1_000)).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)

    expect(recoverFromStaleAssets(target, 30_000)).toBe(false)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })

  it('allows another reload after the guard window has passed', () => {
    const target = fakeWindow()
    recoverFromStaleAssets(target, 1_000)
    expect(recoverFromStaleAssets(target, 120_000)).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(2)
  })

  it('still reloads when storage is unavailable', () => {
    const target = { location: { reload: vi.fn() } as unknown as Location }
    expect(recoverFromStaleAssets(target)).toBe(true)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })
})
