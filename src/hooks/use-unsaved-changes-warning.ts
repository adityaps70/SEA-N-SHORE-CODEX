'use client'

import { useEffect, useId } from 'react'
import { setUnsavedInput } from '@/features/app-update/stale-deployment'

export const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Leave this page anyway?'

export function isPlainLeftClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/** The same-site path a link goes to, or null when it opens elsewhere, downloads, or stays on this page. */
export function internalDestination(anchor: HTMLAnchorElement) {
  if (anchor.target && anchor.target !== '_self') return null
  if (anchor.hasAttribute('download')) return null
  const rawHref = anchor.getAttribute('href')
  if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return null
  let url: URL
  try {
    url = new URL(anchor.href, window.location.href)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Hotfix P2: while `active`, closing or reloading the tab shows the browser's "Leave site?" prompt, and a
 * link to another page in the app asks first (client-side navigation never fires beforeunload).
 */
export function useUnsavedChangesWarning(active: boolean, message = UNSAVED_CHANGES_MESSAGE) {
  useUnsavedInput(active)
  useEffect(() => {
    if (!active) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      // Required by some browsers to show the native "Leave site?" prompt.
      event.returnValue = ''
    }
    function onClickCapture(event: MouseEvent) {
      if (event.defaultPrevented || !isPlainLeftClick(event)) return
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || !internalDestination(anchor)) return
      if (window.confirm(message)) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, [active, message])
}

/** Round ARCH (Phase 5 follow-up): while `dirty`, a tab on an old build never reloads by itself (stale-deployment.ts). */
export function useUnsavedInput(dirty: boolean) {
  const key = useId()
  useEffect(() => {
    setUnsavedInput(key, dirty)
    return () => setUnsavedInput(key, false)
  }, [key, dirty])
}
