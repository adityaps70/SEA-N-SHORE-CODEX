/**
 * Round G (G4): the browser side of real-time search, without React so it can be tested alone.
 * - Debounced (120 ms for the dropdown, 250 ms for the full page).
 * - Each new request aborts the previous one (AbortController).
 * - A sequence number: a slow, older response never replaces a newer one.
 * - The last 20 queries' results stay in memory for the session, so backspacing is instant.
 * - A 429 backs off quietly (old results stay; the next keystroke after the pause tries again).
 * - Request cuts (owner-approved 18 Nov): nothing is requested until the trimmed text has at least
 *   SEARCH_MIN_QUERY_LENGTH characters; a single letter matches too much to be useful and cost a request per keystroke.
 */
export type SuggestItem = {
  id: string
  kind: 'person' | 'org' | 'community' | 'job' | 'course' | 'event' | 'post'
  name: string
  subtitle: string | null
  avatarUrl: string | null
  href: string
}
export type SuggestResponse = { query: string; items: SuggestItem[]; partial?: boolean }

export type SearchClientState =
  | { status: 'idle'; query: string; response: SuggestResponse | null }
  | { status: 'loading'; query: string; response: SuggestResponse | null }
  | { status: 'ready'; query: string; response: SuggestResponse }
  | { status: 'error'; query: string; response: SuggestResponse | null }

type Fetch = (input: string, init: { signal: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export const SEARCH_MEMORY_SIZE = 20
export const SEARCH_MIN_QUERY_LENGTH = 2
const BACKOFF_MS = 2000

/** True when trimmed text is long enough to ask for suggestions (counted in characters, not UTF-16 units). */
export function isSearchableQuery(text: string) {
  return Array.from(text.trim()).length >= SEARCH_MIN_QUERY_LENGTH
}

export function createSearchClient(input: {
  endpoint?: string
  debounceMs?: number
  fetch?: Fetch
  onState: (state: SearchClientState) => void
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  now?: () => number
}) {
  const endpoint = input.endpoint ?? '/api/search/suggest'
  const debounceMs = input.debounceMs ?? 120
  const doFetch: Fetch = input.fetch ?? ((url, init) => fetch(url, init))
  const setTimer = input.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = input.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const now = input.now ?? Date.now
  const memory = new Map<string, SuggestResponse>()
  let sequence = 0
  let shown = 0
  let controller: AbortController | null = null
  let timer: unknown = null
  let backoffUntil = 0
  let last: SuggestResponse | null = null

  function remember(key: string, response: SuggestResponse) {
    memory.delete(key)
    memory.set(key, response)
    while (memory.size > SEARCH_MEMORY_SIZE) memory.delete(memory.keys().next().value as string)
  }

  async function run(query: string, id: number) {
    controller?.abort()
    const current = new AbortController()
    controller = current
    try {
      const response = await doFetch(`${endpoint}?q=${encodeURIComponent(query)}`, { signal: current.signal, headers: { accept: 'application/json' } })
      if (id < shown) return
      if (response.status === 429) {
        // Over the limit: keep the old results, pause quietly, then try the latest text once.
        backoffUntil = now() + BACKOFF_MS
        if (id === sequence) {
          input.onState({ status: 'loading', query, response: last })
          timer = setTimer(() => {
            timer = null
            if (id === sequence) void run(query, id)
          }, BACKOFF_MS)
        }
        return
      }
      if (!response.ok) {
        if (id === sequence) input.onState({ status: 'error', query, response: last })
        return
      }
      const body = await response.json() as SuggestResponse
      remember(query, body)
      // Never let an older response replace a newer one already shown.
      if (id < shown) return
      shown = id
      last = body
      input.onState({ status: 'ready', query, response: body })
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') return
      if (id === sequence) input.onState({ status: 'error', query, response: last })
    }
  }

  return {
    /**
     * Call on every keystroke. Empty text clears the results (the caller shows recent searches); text shorter than
     * SEARCH_MIN_QUERY_LENGTH clears them too and requests nothing.
     */
    type(raw: string) {
      const query = raw.trim().slice(0, 80)
      if (timer !== null) clearTimer(timer)
      timer = null
      sequence += 1
      const id = sequence
      if (!isSearchableQuery(query)) {
        controller?.abort()
        shown = id
        last = null
        input.onState({ status: 'idle', query, response: null })
        return
      }
      const remembered = memory.get(query)
      if (remembered) {
        controller?.abort()
        shown = id
        last = remembered
        input.onState({ status: 'ready', query, response: remembered })
        return
      }
      // Old results stay on screen while the new ones load.
      input.onState({ status: 'loading', query, response: last })
      timer = setTimer(() => {
        timer = null
        void run(query, id)
      }, Math.max(debounceMs, backoffUntil - now()))
    },
    cancel() {
      if (timer !== null) clearTimer(timer)
      timer = null
      controller?.abort()
    },
    get memorySize() {
      return memory.size
    },
  }
}
