import { describe, expect, it, vi } from 'vitest'
import { actionScope, inActionScope, scoped } from './action-scope'

/** Round CAP (server actions): one memo per action call, none outside, nothing shared between calls. */
describe('actionScope', () => {
  it('loads a key once per call, again in the next call, and every time outside a scope', async () => {
    const load = vi.fn(async () => ({ id: 'member' }))
    expect(inActionScope()).toBe(false)
    await scoped('auth', load)
    await scoped('auth', load)
    expect(load).toHaveBeenCalledTimes(2)

    await actionScope(async () => {
      expect(inActionScope()).toBe(true)
      const [a, b] = await Promise.all([scoped('auth', load), scoped('auth', load)])
      expect(a).toBe(b)
      await scoped('auth', load)
    })
    expect(load).toHaveBeenCalledTimes(3)

    await actionScope(async () => { await scoped('auth', load) })
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('keeps keys apart, shares a nested scope, and shares a failure within the call only', async () => {
    const a = vi.fn(async () => 'a')
    const b = vi.fn(async () => 'b')
    await actionScope(async () => {
      expect(await scoped('access:1', a)).toBe('a')
      expect(await scoped('access:2', b)).toBe('b')
      await actionScope(async () => { await scoped('access:1', a) })
    })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    const failing = vi.fn(async () => { throw new Error('auth_failed') })
    await actionScope(async () => {
      await expect(scoped('auth', failing)).rejects.toThrow('auth_failed')
      await expect(scoped('auth', failing)).rejects.toThrow('auth_failed')
    })
    await actionScope(async () => { await expect(scoped('auth', failing)).rejects.toThrow('auth_failed') })
    expect(failing).toHaveBeenCalledTimes(2)
  })

  it('never leaks a memo between concurrent calls', async () => {
    let n = 0
    const load = async () => ++n
    const [first, second] = await Promise.all([
      actionScope(async () => [await scoped('auth', load), await scoped('auth', load)]),
      actionScope(async () => [await scoped('auth', load), await scoped('auth', load)]),
    ])
    expect(first![0]).toBe(first![1])
    expect(second![0]).toBe(second![1])
    expect(first![0]).not.toBe(second![0])
  })
})
