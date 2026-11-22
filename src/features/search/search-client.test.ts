import { describe, expect, it } from 'vitest'
import { createSearchClient, isSearchableQuery, SEARCH_MIN_QUERY_LENGTH, type SearchClientState, type SuggestResponse } from './search-client'

/** A manual clock and timer queue, and fetches the test resolves in any order. */
function harness() {
  let clock = 0
  const timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = []
  const pending: Array<{ url: string; signal: AbortSignal; resolve: (value: { ok: boolean; status: number; json(): Promise<unknown> }) => void }> = []
  const states: SearchClientState[] = []
  const client = createSearchClient({
    debounceMs: 120,
    onState: (state) => states.push(state),
    now: () => clock,
    setTimer: (callback, ms) => {
      const timer = { at: clock + ms, callback, cancelled: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (handle) => { (handle as { cancelled: boolean }).cancelled = true },
    fetch: (url, init) => new Promise((resolve) => pending.push({ url, signal: init.signal, resolve })),
  })
  return {
    client,
    states,
    pending,
    advance(ms: number) {
      clock += ms
      for (const timer of timers.filter((item) => !item.cancelled && item.at <= clock)) {
        timer.cancelled = true
        timer.callback()
      }
    },
    respond(index: number, body: SuggestResponse, status = 200) {
      pending[index]!.resolve({ ok: status < 400, status, json: async () => body })
    },
    last: () => states[states.length - 1]!,
  }
}

const body = (query: string): SuggestResponse => ({ query, items: [{ id: query, kind: 'person', name: query, subtitle: null, avatarUrl: null, href: `/people/${query}` }] })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('real-time search client', () => {
  it('debounces keystrokes into one request', async () => {
    const h = harness()
    h.client.type('s')
    h.advance(50)
    h.client.type('sa')
    h.advance(50)
    h.client.type('sac')
    h.advance(120)
    expect(h.pending.map((item) => item.url)).toEqual(['/api/search/suggest?q=sac'])
  })

  it('a slow earlier response never replaces a newer one, and the old request is aborted', async () => {
    const h = harness()
    h.client.type('sa')
    h.advance(120)
    h.client.type('sach')
    h.advance(120)
    expect(h.pending[0]!.signal.aborted).toBe(true)
    h.respond(1, body('sach'))
    await flush()
    h.respond(0, body('sa'))
    await flush()
    expect(h.last()).toMatchObject({ status: 'ready', query: 'sach' })
    expect(h.states.filter((state) => state.status === 'ready').map((state) => state.query)).toEqual(['sach'])
  })

  it('keeps the old results on screen while new ones load (no blank flash)', async () => {
    const h = harness()
    h.client.type('sa')
    h.advance(120)
    h.respond(0, body('sa'))
    await flush()
    h.client.type('sac')
    expect(h.last()).toMatchObject({ status: 'loading', response: { query: 'sa' } })
  })

  it('remembers the last 20 queries so backspacing is instant', async () => {
    const h = harness()
    h.client.type('sac')
    h.advance(120)
    h.respond(0, body('sac'))
    await flush()
    h.client.type('sach')
    h.advance(120)
    h.respond(1, body('sach'))
    await flush()
    h.client.type('sac')
    expect(h.last()).toMatchObject({ status: 'ready', query: 'sac' })
    expect(h.pending).toHaveLength(2)
  })

  it('backs off quietly on 429 and recovers with the latest text', async () => {
    const h = harness()
    h.client.type('sa')
    h.advance(120)
    h.respond(0, body('sa'), 429)
    await flush()
    expect(h.states.some((state) => state.status === 'error')).toBe(false)
    h.client.type('sac')
    h.advance(120)
    expect(h.pending).toHaveLength(1)
    h.advance(2000)
    expect(h.pending.map((item) => item.url)).toEqual(['/api/search/suggest?q=sa', '/api/search/suggest?q=sac'])
    h.respond(1, body('sac'))
    await flush()
    expect(h.last()).toMatchObject({ status: 'ready', query: 'sac' })
  })

  it('requests nothing for fewer than two characters, trimmed (request cuts)', async () => {
    expect(SEARCH_MIN_QUERY_LENGTH).toBe(2)
    const h = harness()
    for (const text of ['s', ' s ', '   ', '']) {
      h.client.type(text)
      h.advance(1000)
      expect(h.last()).toEqual({ status: 'idle', query: text.trim(), response: null })
    }
    expect(h.pending).toHaveLength(0)
    expect(h.states.some((state) => state.status === 'loading')).toBe(false)
    h.client.type(' sa ')
    h.advance(120)
    expect(h.pending.map((item) => item.url)).toEqual(['/api/search/suggest?q=sa'])
  })

  it('backspacing to one character drops the results and aborts the request in flight', async () => {
    const h = harness()
    h.client.type('sa')
    h.advance(120)
    h.respond(0, body('sa'))
    await flush()
    h.client.type('sac')
    h.advance(120)
    h.client.type('s')
    expect(h.pending[1]!.signal.aborted).toBe(true)
    expect(h.last()).toEqual({ status: 'idle', query: 's', response: null })
    h.advance(1000)
    expect(h.pending).toHaveLength(2)
    // A late answer for the aborted text never shows.
    h.respond(1, body('sac'))
    await flush()
    expect(h.last()).toEqual({ status: 'idle', query: 's', response: null })
  })

  it('counts characters, not UTF-16 units', () => {
    expect(isSearchableQuery('a')).toBe(false)
    expect(isSearchableQuery(' a ')).toBe(false)
    expect(isSearchableQuery('\u{1F6A2}')).toBe(false)
    expect(isSearchableQuery('ab')).toBe(true)
    expect(isSearchableQuery('\u00e9a')).toBe(true)
  })
})
