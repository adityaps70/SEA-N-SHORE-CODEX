import { describe, expect, it, vi } from 'vitest'
import { createProfileMediaService } from './profile-media-service'

describe('profile media service', () => {
  it('stores the new object, updates the path, then removes the old object', async () => {
    const putObject = vi.fn(async () => undefined)
    const replaceMediaPath = vi.fn(async () => 'profiles/u/old.webp')
    const deleteObject = vi.fn(async () => undefined)
    const service = createProfileMediaService({ putObject, replaceMediaPath, deleteObject })

    await service.upload('11111111-1111-4111-8111-111111111111', 'avatar', {
      type: 'image/webp',
      size: 4,
      bytes: new Uint8Array([1, 2, 3, 4]),
    })

    expect(putObject).toHaveBeenCalledTimes(1)
    expect(replaceMediaPath).toHaveBeenCalledTimes(1)
    expect(deleteObject).toHaveBeenCalledWith('profiles/u/old.webp')
  })

  it('removes a newly uploaded object when the database update fails', async () => {
    const putObject = vi.fn(async () => undefined)
    const replaceMediaPath = vi.fn(async () => { throw new Error('db') })
    const deleteObject = vi.fn(async () => undefined)
    const service = createProfileMediaService({ putObject, replaceMediaPath, deleteObject })

    await expect(service.upload('11111111-1111-4111-8111-111111111111', 'cover', {
      type: 'image/png',
      size: 4,
      bytes: new Uint8Array([1, 2, 3, 4]),
    })).rejects.toThrow('db')

    expect(deleteObject).toHaveBeenCalledTimes(1)
    expect(deleteObject.mock.calls[0]?.[0]).toMatch(/\/cover-/)
  })
})
