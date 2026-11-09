'use client'

import { unstable_isUnrecognizedActionError } from 'next/navigation'

/**
 * Round ARCH (Phase 5 follow-up): a tab still running the previous deploy calls Server Actions the new server no
 * longer has (Next.js logs "Failed to find Server Action"; the client gets an UnrecognizedActionError). Such a tab
 * keeps polling and failing until it loads the new build. This moves it on, safely:
 *
 * - at most one automatic reload per tab per build: the reload is remembered in sessionStorage under this tab's own
 *   build ID, so a reload that lands on the same old build again (a rolling deploy) never reloads a second time;
 * - only while the tab is visible (a hidden tab waits until it is shown);
 * - never while the page has unsaved input (a form marked dirty, any filled-in form field, any typed text): then a
 *   small "Sea N Shore has been updated, tap to refresh" bar is shown instead, and the member decides.
 * If the reload cannot be remembered (storage unavailable), it does not reload either: the bar is shown.
 */

/** This build's identifier, inlined into the client bundle by next.config.ts. */
export const APP_BUILD_ID = process.env.NEXT_PUBLIC_APP_BUILD_ID || 'development'
/** Fired on window when the update bar should be shown. */
export const APP_UPDATED_EVENT = 'sns:app-updated'
export const STALE_RELOAD_KEY_PREFIX = 'sns:stale-reload:'

export function isStaleDeploymentError(error: unknown): boolean {
  try {
    if (unstable_isUnrecognizedActionError(error)) return true
  } catch {
    // Not an error object Next.js recognises; fall back to the message.
  }
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /Server Action "[^"]*" was not found on the server|Failed to find Server Action/.test(message)
}

// Forms that know they hold unsaved input say so here (see useUnsavedChangesWarning, the composers).
const unsavedKeys = new Set<string>()

export function setUnsavedInput(key: string, dirty: boolean) {
  if (dirty) unsavedKeys.add(key)
  else unsavedKeys.delete(key)
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'email', 'url', 'tel', 'number', 'password', 'date', 'datetime-local', 'time', 'month', 'week'])

/**
 * True when reloading could lose something the member typed or chose. Deliberately cautious: any form field with a
 * value counts (a pre-filled edit form only shows the bar instead of reloading, which loses nothing).
 */
export function pageHasUnsavedInput(doc: Document = document): boolean {
  if (unsavedKeys.size > 0) return true
  for (const area of Array.from(doc.querySelectorAll('textarea'))) {
    if (!area.disabled && !area.readOnly && area.value.trim() !== '') return true
  }
  for (const editable of Array.from(doc.querySelectorAll('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'))) {
    if ((editable.textContent ?? '').trim() !== '') return true
  }
  for (const input of Array.from(doc.querySelectorAll('form input')) as HTMLInputElement[]) {
    if (input.disabled || input.readOnly || input.type === 'hidden' || input.type === 'search') continue
    if (input.closest('[role="search"]')) continue
    if (TEXT_INPUT_TYPES.has(input.type) && input.value.trim() !== '') return true
    if ((input.type === 'checkbox' || input.type === 'radio') && input.checked !== input.defaultChecked) return true
    if (input.type === 'file' && input.files && input.files.length > 0) return true
  }
  for (const select of Array.from(doc.querySelectorAll('form select')) as HTMLSelectElement[]) {
    if (!select.disabled && Array.from(select.options).some((option) => option.selected !== option.defaultSelected)) return true
  }
  return false
}

export type StaleDeploymentAction = 'reload' | 'prompt' | 'wait'

export function decideStaleDeploymentAction(state: { visible: boolean; unsaved: boolean; reloadedBefore: boolean }): StaleDeploymentAction {
  if (state.reloadedBefore || state.unsaved) return 'prompt'
  if (!state.visible) return 'wait'
  return 'reload'
}

export type StaleDeploymentDeps = {
  buildId: string
  isVisible: () => boolean
  hasUnsavedInput: () => boolean
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | null
  reload: () => void
  showPrompt: () => void
  /** Calls back once the tab is visible again; returns a function that cancels the wait. */
  whenVisible: (callback: () => void) => () => void
}

/** Returns a handler: give it any error; it returns true when the error was a stale deployment and acts on it. */
export function createStaleDeploymentHandler(deps: StaleDeploymentDeps) {
  const key = `${STALE_RELOAD_KEY_PREFIX}${deps.buildId}`
  let settled = false
  let cancelWait: (() => void) | null = null

  function reloadedBefore(): boolean | null {
    try {
      const storage = deps.storage()
      return storage ? storage.getItem(key) === '1' : null
    } catch {
      return null
    }
  }

  function rememberReload(): boolean {
    try {
      const storage = deps.storage()
      if (!storage) return false
      storage.setItem(key, '1')
      return storage.getItem(key) === '1'
    } catch {
      return false
    }
  }

  function act() {
    if (settled) return
    const before = reloadedBefore()
    const action = decideStaleDeploymentAction({ visible: deps.isVisible(), unsaved: deps.hasUnsavedInput(), reloadedBefore: before !== false })
    if (action === 'wait') {
      if (!cancelWait) cancelWait = deps.whenVisible(() => { cancelWait = null; act() })
      return
    }
    settled = true
    if (action === 'reload' && rememberReload()) deps.reload()
    else deps.showPrompt()
  }

  return function handleStaleDeployment(error: unknown): boolean {
    if (!isStaleDeploymentError(error)) return false
    act()
    return true
  }
}

function browserDeps(): StaleDeploymentDeps {
  return {
    buildId: APP_BUILD_ID,
    isVisible: () => document.visibilityState === 'visible',
    hasUnsavedInput: () => pageHasUnsavedInput(document),
    storage: () => window.sessionStorage,
    reload: () => window.location.reload(),
    showPrompt: () => window.dispatchEvent(new Event(APP_UPDATED_EVENT)),
    whenVisible: (callback) => {
      const onChange = () => {
        if (document.visibilityState !== 'visible') return
        document.removeEventListener('visibilitychange', onChange)
        callback()
      }
      document.addEventListener('visibilitychange', onChange)
      return () => document.removeEventListener('visibilitychange', onChange)
    },
  }
}

let browserHandler: ((error: unknown) => boolean) | null = null

/** For catch blocks: hand over any error; returns true when it meant "this tab is running an old build". */
export function handleStaleDeployment(error: unknown): boolean {
  if (typeof window === 'undefined') return false
  browserHandler ??= createStaleDeploymentHandler(browserDeps())
  return browserHandler(error)
}
