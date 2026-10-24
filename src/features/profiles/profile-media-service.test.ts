import { describe, expect, it, vi } from 'vitest'
import { createProfileMediaService } from './profile-media-service'

const WEBP = new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('profile media service', () => {
  it('stores the new object, updates the path, then removes the old object', async () => {
    const putObject = vi.fn(async () => undefined)
    const replaceMediaPath = vi.fn(async () => 'profiles/u/old.webp')
    const deleteObject = vi.fn(async (key: string) => {
      void key
      return undefined
    })
    const service = createProfileMediaService({ putObject, replaceMediaPath, deleteObject })

    await service.upload('11111111-1111-4111-8111-111111111111', 'avatar', {
      type: 'image/webp',
      size: WEBP.length,
      bytes: WEBP,
    })

    expect(putObject).toHaveBeenCalledTimes(1)
    expect(replaceMediaPath).toHaveBeenCalledTimes(1)
    expect(deleteObject).toHaveBeenCalledWith('profiles/u/old.webp')
  })

  it('removes a newly uploaded object when the database update fails', async () => {
    const putObject = vi.fn(async () => undefined)
    const replaceMediaPath = vi.fn(async () => { throw new Error('db') })
    const deleteObject = vi.fn(async (key: string) => {
      void key
      return undefined
    })
    const service = createProfileMediaService({ putObject, replaceMediaPath, deleteObject })

    await expect(service.upload('11111111-1111-4111-8111-111111111111', 'cover', {
      type: 'image/png',
      size: PNG.length,
      bytes: PNG,
    })).rejects.toThrow('db')

    expect(deleteObject).toHaveBeenCalledTimes(1)
    expect(deleteObject.mock.calls[0]?.[0]).toMatch(/\/cover-/)
  })

  it('refuses a file whose bytes are not the declared image type (Round P3), before storing anything', async () => {
    const putObject = vi.fn(async () => undefined)
    const replaceMediaPath = vi.fn(async () => null)
    const deleteObject = vi.fn(async () => undefined)
    const service = createProfileMediaService({ putObject, replaceMediaPath, deleteObject })

    await expect(service.upload('11111111-1111-4111-8111-111111111111', 'avatar', {
      type: 'image/png',
      size: 8,
      bytes: new TextEncoder().encode('%PDF-1.7'),
    })).rejects.toThrow('This file is not a real JPG, PNG or WebP image. Choose another image.')
    expect(putObject).not.toHaveBeenCalled()
  })
})
