import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/aws/storage', () => ({
  putMediaObject: vi.fn(),
  deleteMediaObject: vi.fn(),
}))
vi.mock('./repository', () => ({
  communityRepository: { replaceImagePath: vi.fn() },
}))

import { createCommunityMediaService } from './media-service'

const groupId = '22222222-2222-4222-8222-222222222222'

type ReplaceImagePath = (id: string, kind: 'cover' | 'icon', next: string | null) => Promise<string | null>

function harness(replaceImagePath: ReplaceImagePath = vi.fn(async () => null)) {
  const order: string[] = []
  const putObject = vi.fn(async (input: { key: string }) => { order.push(`put:${input.key}`) })
  const deleteObject = vi.fn(async (key: string) => { order.push(`delete:${key}`) })
  const replace = vi.fn(async (id: string, kind: 'cover' | 'icon', next: string | null) => {
    order.push(`db:${kind}:${next ?? 'null'}`)
    return replaceImagePath(id, kind, next)
  })
  return { order, putObject, deleteObject, replace, service: createCommunityMediaService({ putObject, deleteObject, replaceImagePath: replace }) }
}

describe('community media service', () => {
  it('validates first, then puts the object, swaps the path and finally deletes the previous object', async () => {
    const { order, putObject, deleteObject, replace, service } = harness(vi.fn(async () => 'communities/g/cover-old.webp'))

    const key = await service.upload(groupId, 'cover', { type: 'image/webp', size: 4, bytes: new Uint8Array([1, 2, 3, 4]) })

    expect(key).toMatch(/^communities\/22222222-2222-4222-8222-222222222222\/cover-[a-f0-9-]+\.webp$/)
    expect(putObject).toHaveBeenCalledWith({ key, body: new Uint8Array([1, 2, 3, 4]), contentType: 'image/webp' })
    expect(replace).toHaveBeenCalledWith(groupId, 'cover', key)
    expect(deleteObject).toHaveBeenCalledTimes(1)
    expect(order).toEqual([`put:${key}`, `db:cover:${key}`, 'delete:communities/g/cover-old.webp'])
  })

  it('keeps the object when the group had no previous image', async () => {
    const { deleteObject, service } = harness()
    await service.upload(groupId, 'icon', { type: 'image/png', size: 2, bytes: new Uint8Array([1, 2]) })
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('rejects invalid files before touching storage', async () => {
    const { putObject, replace, service } = harness()
    await expect(service.upload(groupId, 'icon', { type: 'image/gif', size: 2, bytes: new Uint8Array([1, 2]) })).rejects.toThrow('Please upload a JPG, PNG or WebP image.')
    await expect(service.upload(groupId, 'icon', { type: 'image/png', size: 6 * 1024 * 1024, bytes: new Uint8Array([1]) })).rejects.toThrow('Image must be 5 MB or smaller.')
    expect(putObject).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('removes the newly uploaded object when the database update fails', async () => {
    const { order, deleteObject, service } = harness(vi.fn(async () => { throw new Error('community_group_missing') }))

    await expect(service.upload(groupId, 'icon', { type: 'image/jpeg', size: 3, bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow('community_group_missing')

    expect(deleteObject).toHaveBeenCalledTimes(1)
    const key = deleteObject.mock.calls[0]?.[0]
    expect(key).toMatch(/\/icon-[a-f0-9-]+\.jpg$/)
    expect(order).toEqual([`put:${key}`, `db:icon:${key}`, `delete:${key}`])
  })

  it('remove clears the path and deletes the previous object', async () => {
    const { order, deleteObject, replace, service } = harness(vi.fn(async () => 'communities/g/icon-old.png'))
    await expect(service.remove(groupId, 'icon')).resolves.toBe('communities/g/icon-old.png')
    expect(replace).toHaveBeenCalledWith(groupId, 'icon', null)
    expect(deleteObject).toHaveBeenCalledWith('communities/g/icon-old.png')
    expect(order).toEqual(['db:icon:null', 'delete:communities/g/icon-old.png'])
  })

  it('remove is a no-op on storage when nothing was stored, and survives a failed delete', async () => {
    const first = harness()
    await expect(first.service.remove(groupId, 'cover')).resolves.toBeNull()
    expect(first.deleteObject).not.toHaveBeenCalled()

    const second = harness(vi.fn(async () => 'communities/g/cover-old.png'))
    second.deleteObject.mockRejectedValueOnce(new Error('s3'))
    await expect(second.service.remove(groupId, 'cover')).resolves.toBe('communities/g/cover-old.png')
  })
})
