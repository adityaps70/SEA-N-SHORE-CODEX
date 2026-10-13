import { describe, expect, it, vi } from 'vitest'
import { createRankingSwitches, RANKING_SETTINGS_TTL_MS } from './switches'

function fakeQuery(modes: Record<string, string>, admins: string[] = []) {
  return vi.fn(async (text: string, values?: readonly unknown[]) => {
    if (text.includes('from public.ranking_settings')) return Object.entries(modes).map(([key, mode]) => ({ key, mode }))
    if (text.includes('from public.user_roles')) return admins.includes(String(values?.[0])) ? [{ '?column?': 1 }] : []
    return []
  })
}

describe('ranking switches', () => {
  it('is off for everyone by default, and on only for administrators in admins mode', async () => {
    const query = fakeQuery({ feed: 'admins', people: 'everyone' }, ['admin-1'])
    const switches = createRankingSwitches({ query })
    expect(await switches.isEnabled('feed', 'admin-1')).toBe(true)
    expect(await switches.isEnabled('feed', 'member-1')).toBe(false)
    expect(await switches.isEnabled('feed', null)).toBe(false)
    expect(await switches.isEnabled('people', 'member-1')).toBe(true)
    expect(await switches.isEnabled('jobs', 'admin-1')).toBe(false)
  })

  it('falls back to off when the settings cannot be read', async () => {
    const switches = createRankingSwitches({ query: vi.fn(async () => { throw Object.assign(new Error('missing'), { code: '42P01' }) }) })
    expect(await switches.isEnabled('feed', 'admin-1')).toBe(false)
    expect(await switches.modeFor('people')).toBe('off')
  })

  it('reads the table at most once per 30 seconds, and again right after a change', async () => {
    let clock = 0
    const query = fakeQuery({ feed: 'everyone' })
    const switches = createRankingSwitches({ query, now: () => clock })
    await switches.modeFor('feed')
    await switches.modeFor('people')
    clock += RANKING_SETTINGS_TTL_MS - 1
    await switches.modeFor('feed')
    expect(query.mock.calls.filter(([text]) => text.includes('ranking_settings')).length).toBe(1)
    clock += 2
    await switches.modeFor('feed')
    expect(query.mock.calls.filter(([text]) => text.includes('select key, mode')).length).toBe(2)
    await switches.setMode('feed', 'off', 'admin-1')
    await switches.modeFor('feed')
    expect(query.mock.calls.filter(([text]) => text.includes('select key, mode')).length).toBe(3)
  })
})
