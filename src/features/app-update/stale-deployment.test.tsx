import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  STALE_RELOAD_KEY_PREFIX,
  createStaleDeploymentHandler,
  decideStaleDeploymentAction,
  isStaleDeploymentError,
  pageHasUnsavedInput,
  setUnsavedInput,
  type StaleDeploymentDeps,
} from './stale-deployment'

/** What Next.js 16 throws in the browser for a Server Action the new server no longer has. */
function staleError() {
  return new Error('Server Action "7f3a" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action')
}

class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function harness(overrides: Partial<StaleDeploymentDeps> = {}) {
  const storage = new MemoryStorage()
  const calls = { reload: 0, prompt: 0 }
  let visible = true
  let unsaved = false
  let onVisible: (() => void) | null = null
  const deps: StaleDeploymentDeps = {
    buildId: 'build-old',
    isVisible: () => visible,
    hasUnsavedInput: () => unsaved,
    storage: () => storage,
    reload: () => { calls.reload += 1 },
    showPrompt: () => { calls.prompt += 1 },
    whenVisible: (callback) => { onVisible = callback; return () => { onVisible = null } },
    ...overrides,
  }
  return {
    storage,
    calls,
    deps,
    setVisible(value: boolean) { visible = value; if (value && onVisible) onVisible() },
    setUnsaved(value: boolean) { unsaved = value },
    waiting: () => onVisible !== null,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  setUnsavedInput('test', false)
})

describe('stale deployment: what counts', () => {
  it('recognises the stale Server Action error and nothing else', () => {
    expect(isStaleDeploymentError(staleError())).toBe(true)
    expect(isStaleDeploymentError(new Error('Failed to find Server Action. This request might be from an older or newer deployment.'))).toBe(true)
    expect(isStaleDeploymentError(new Error('We could not load more posts.'))).toBe(false)
    expect(isStaleDeploymentError(undefined)).toBe(false)
    expect(isStaleDeploymentError({ message: 'Server Action "x" was not found on the server' })).toBe(false)
  })

  it('decides: unsaved or already reloaded shows the bar; hidden waits; clean and visible reloads', () => {
    expect(decideStaleDeploymentAction({ visible: true, unsaved: false, reloadedBefore: false })).toBe('reload')
    expect(decideStaleDeploymentAction({ visible: true, unsaved: true, reloadedBefore: false })).toBe('prompt')
    expect(decideStaleDeploymentAction({ visible: true, unsaved: false, reloadedBefore: true })).toBe('prompt')
    expect(decideStaleDeploymentAction({ visible: false, unsaved: false, reloadedBefore: false })).toBe('wait')
    expect(decideStaleDeploymentAction({ visible: false, unsaved: true, reloadedBefore: false })).toBe('prompt')
  })
})

describe('stale deployment: one reload with a clean page', () => {
  it('reloads exactly once, remembering it under this build', () => {
    const h = harness()
    const handle = createStaleDeploymentHandler(h.deps)
    expect(handle(staleError())).toBe(true)
    expect(h.calls).toEqual({ reload: 1, prompt: 0 })
    expect(h.storage.getItem(`${STALE_RELOAD_KEY_PREFIX}build-old`)).toBe('1')
    // Further failures from the same page (several polls failing at once) do nothing more.
    handle(staleError())
    handle(staleError())
    expect(h.calls).toEqual({ reload: 1, prompt: 0 })
  })

  it('ignores errors that are not stale deployments', () => {
    const h = harness()
    const handle = createStaleDeploymentHandler(h.deps)
    expect(handle(new Error('network down'))).toBe(false)
    expect(h.calls).toEqual({ reload: 0, prompt: 0 })
  })
})

describe('stale deployment: no reload loop', () => {
  it('after a reload that lands on the same old build again, it shows the bar instead of reloading', () => {
    const h = harness()
    createStaleDeploymentHandler(h.deps)(staleError())
    expect(h.calls.reload).toBe(1)
    // The reload: a new page (new handler), same tab storage, same old build (a rolling deploy served it again).
    for (let page = 0; page < 5; page += 1) createStaleDeploymentHandler(h.deps)(staleError())
    expect(h.calls).toEqual({ reload: 1, prompt: 5 })
  })

  it('a newer build gets its own single reload (one per tab per build)', () => {
    const h = harness()
    createStaleDeploymentHandler(h.deps)(staleError())
    createStaleDeploymentHandler({ ...h.deps, buildId: 'build-new' })(staleError())
    createStaleDeploymentHandler({ ...h.deps, buildId: 'build-new' })(staleError())
    expect(h.calls).toEqual({ reload: 2, prompt: 1 })
  })

  it('never reloads when the reload cannot be remembered', () => {
    const throwing = harness({ storage: () => { throw new Error('denied') } })
    createStaleDeploymentHandler(throwing.deps)(staleError())
    expect(throwing.calls).toEqual({ reload: 0, prompt: 1 })
    const missing = harness({ storage: () => null })
    createStaleDeploymentHandler(missing.deps)(staleError())
    expect(missing.calls).toEqual({ reload: 0, prompt: 1 })
    const ignored = harness({ storage: () => ({ getItem: () => null, setItem: () => undefined }) })
    createStaleDeploymentHandler(ignored.deps)(staleError())
    expect(ignored.calls).toEqual({ reload: 0, prompt: 1 })
  })
})

describe('stale deployment: no reload with unsaved input', () => {
  it('shows the bar and does not reload while the page holds unsaved input', () => {
    const h = harness()
    h.setUnsaved(true)
    createStaleDeploymentHandler(h.deps)(staleError())
    expect(h.calls).toEqual({ reload: 0, prompt: 1 })
    expect(h.storage.getItem(`${STALE_RELOAD_KEY_PREFIX}build-old`)).toBeNull()
  })

  it('a hidden tab waits, and re-checks for unsaved input when it is shown', () => {
    const h = harness()
    h.setVisible(false)
    const handle = createStaleDeploymentHandler(h.deps)
    handle(staleError())
    handle(staleError())
    expect(h.calls).toEqual({ reload: 0, prompt: 0 })
    expect(h.waiting()).toBe(true)
    h.setUnsaved(true)
    h.setVisible(true)
    expect(h.calls).toEqual({ reload: 0, prompt: 1 })
  })

  it('a hidden clean tab reloads once it is shown', () => {
    const h = harness()
    h.setVisible(false)
    createStaleDeploymentHandler(h.deps)(staleError())
    expect(h.calls.reload).toBe(0)
    h.setVisible(true)
    expect(h.calls).toEqual({ reload: 1, prompt: 0 })
  })

  it('counts typed text, filled form fields, changed choices and dirty forms as unsaved; an empty page is clean', () => {
    expect(pageHasUnsavedInput()).toBe(false)
    document.body.innerHTML = '<form role="search"><input type="search" value="cadet"></form><textarea></textarea><form><input name="title"></form>'
    expect(pageHasUnsavedInput()).toBe(false)

    const cases: Array<() => void> = [
      () => { document.body.innerHTML = '<textarea>Half a post</textarea>' },
      () => { document.body.innerHTML = '<div contenteditable="true">Hello captain</div>' },
      () => { document.body.innerHTML = '<form><input name="title"></form>'; (document.querySelector('input') as HTMLInputElement).value = 'Chief Officer' },
      () => { document.body.innerHTML = '<form><input type="checkbox" name="remote"></form>'; (document.querySelector('input') as HTMLInputElement).checked = true },
      () => { document.body.innerHTML = '<form><select name="rank"><option selected>Any</option><option>Master</option></select></form>'; (document.querySelector('select') as HTMLSelectElement).selectedIndex = 1 },
      () => { setUnsavedInput('test', true) },
    ]
    for (const make of cases) {
      document.body.innerHTML = ''
      setUnsavedInput('test', false)
      make()
      expect(pageHasUnsavedInput()).toBe(true)
    }
  })
})

describe('stale deployment: the browser handler', () => {
  it('reloads a clean visible tab once and never again for the same build', async () => {
    vi.resetModules()
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } })
    try {
      window.sessionStorage.clear()
      const { handleStaleDeployment } = await import('./stale-deployment')
      expect(handleStaleDeployment(staleError())).toBe(true)
      expect(handleStaleDeployment(staleError())).toBe(true)
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
      window.sessionStorage.clear()
    }
  })
})
