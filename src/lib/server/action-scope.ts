import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Round CAP (server actions, owner-approved 13 Nov): one memo per Server Action call.
 *
 * React `cache()` memoises within a render only. Inside a Server Action body every call runs again (Next runs the
 * action outside a Flight render), so an action whose helpers each resolve the member resolved auth two to four
 * times. `actionScope(work)` gives one call a memo that ends when the call ends; `scoped(key, load)` returns the
 * memoised promise inside a scope and simply loads outside one (renders keep using React `cache()`).
 *
 * Only reads that cannot change during the call belong here (who the member is, their access context); never a
 * read the action itself changes and then reads back. A failed load is shared within the call, exactly as calling
 * it twice would fail twice.
 */
const storage = new AsyncLocalStorage<Map<string, Promise<unknown>>>()

export function actionScope<T>(work: () => Promise<T>): Promise<T> {
  // A nested scope (one action calling another's body) shares the outer memo.
  if (storage.getStore()) return work()
  return storage.run(new Map(), work)
}

export function inActionScope() {
  return storage.getStore() !== undefined
}

export function scoped<T>(key: string, load: () => Promise<T>): Promise<T> {
  const memo = storage.getStore()
  if (!memo) return load()
  const known = memo.get(key)
  if (known) return known as Promise<T>
  const pending = load()
  memo.set(key, pending)
  return pending
}
