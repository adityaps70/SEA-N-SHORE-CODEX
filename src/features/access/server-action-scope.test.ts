import { describe, expect, it, vi } from 'vitest'

const getAccessContextFromRepository = vi.hoisted(() => vi.fn(async (profileId: string) => ({ profileId })))
vi.mock('./repository', () => ({ accessRepository: { getAccessContext: getAccessContextFromRepository } }))

const { getAccessContext } = await import('./server')
const { actionScope } = await import('@/lib/server/action-scope')

/** Round CAP: inside one Server Action call the access context (6 queries) is read once per member. */
describe('getAccessContext in a Server Action', () => {
  it('reads once per member per call, and afresh in the next call', async () => {
    await actionScope(async () => {
      await Promise.all([getAccessContext('member-1'), getAccessContext('member-1')])
      await getAccessContext('member-1')
      await getAccessContext('member-2')
    })
    expect(getAccessContextFromRepository).toHaveBeenCalledTimes(2)
    await actionScope(async () => { await getAccessContext('member-1') })
    expect(getAccessContextFromRepository).toHaveBeenCalledTimes(3)
  })
})
