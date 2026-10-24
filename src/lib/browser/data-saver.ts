'use client'

import { useSyncExternalStore } from 'react'

/**
 * Round P3: Data saver and when video may play by itself.
 *
 * - Data saver is a per-device choice in Settings (stored in this browser only, like a display
 *   preference), or the browser's own data saver (`navigator.connection.saveData`). While it is on,
 *   videos load nothing until they are played.
 * - Video never starts by itself in Data saver, on mobile data, on a slow (2G) connection, or on a
 *   phone whose browser does not say what network it is on (Safari on iPhone never does), since
 *   that may be mobile data.
 */
export const DATA_SAVER_STORAGE_KEY = 'sns:data-saver'

type NetworkInformationLike = {
  saveData?: boolean
  type?: string
  effectiveType?: string
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

function connection(): NetworkInformationLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection
}

const listeners = new Set<() => void>()
/** The switch when this browser blocks storage (private mode): it lasts for this page only. */
let memoryChoice: boolean | null = null

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => { if (event.key === DATA_SAVER_STORAGE_KEY) listener() }
  window.addEventListener('storage', onStorage)
  const network = connection()
  network?.addEventListener?.('change', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
    network?.removeEventListener?.('change', listener)
  }
}

/** The member's own Data saver switch on this device. */
export function dataSaverChosen(): boolean {
  try {
    return window.localStorage.getItem(DATA_SAVER_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function setDataSaverChosen(on: boolean) {
  try {
    if (on) window.localStorage.setItem(DATA_SAVER_STORAGE_KEY, 'on')
    else window.localStorage.removeItem(DATA_SAVER_STORAGE_KEY)
  } catch {
    memoryChoice = on
  }
  notify()
}

/** Data saver from Settings, or the browser's own data saver. */
export function dataSaverActive(): boolean {
  return (memoryChoice ?? dataSaverChosen()) || connection()?.saveData === true
}

function phoneSized() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse) and (max-width: 1024px)').matches
}

/** Why video must not start by itself here, or null when it may. */
export function autoplayBlockReason(): 'data-saver' | 'mobile-data' | 'slow-network' | 'unknown-phone-network' | null {
  if (dataSaverActive()) return 'data-saver'
  const network = connection()
  if (network?.type === 'cellular') return 'mobile-data'
  if (network?.effectiveType === 'slow-2g' || network?.effectiveType === '2g') return 'slow-network'
  if (!network?.type && phoneSized()) return 'unknown-phone-network'
  return null
}

/** False on the server and before hydration: nothing autoplays until the browser has been asked. */
export function useAutoplayAllowed(): boolean {
  return useSyncExternalStore(subscribe, () => autoplayBlockReason() === null, () => false)
}

export function useDataSaver(): boolean {
  return useSyncExternalStore(subscribe, dataSaverActive, () => false)
}

/** `preload` for a <video>: nothing until it is played in Data saver, else just its metadata. */
export function useVideoPreload(): 'none' | 'metadata' {
  return useDataSaver() ? 'none' : 'metadata'
}
