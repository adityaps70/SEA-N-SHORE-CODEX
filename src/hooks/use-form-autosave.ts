'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { isFormSnapshot, readFormSnapshot, type FormSnapshot } from '@/lib/forms/form-snapshot'

/**
 * Hotfix P2: a local copy of a long form, so nothing typed is lost to an error, a reload, a closed tab
 * or an expired session. Kept in this browser only (localStorage), per member and per record, written
 * every few seconds while there are changes and whenever a field loses focus. Never use it for payout,
 * bank, UPI, PAN or other tax details (readFormSnapshot also leaves those out by name).
 */

export type StoredFormDraft = {
  version: 1
  savedAt: string
  values: FormSnapshot
  /** 'session_expired': written just before sending the member to sign in again; restored without asking. */
  reason: 'autosave' | 'session_expired'
}

export const FORM_AUTOSAVE_INTERVAL_MS = 3000

export function formDraftStorageKey({ form, ownerId, recordId }: { form: string; ownerId: string; recordId?: string | null }) {
  return `sns:form-draft:v1:${form}:${ownerId}:${recordId || 'new'}`
}

export function readStoredFormDraft(key: string): StoredFormDraft | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredFormDraft>
    if (parsed?.version !== 1 || typeof parsed.savedAt !== 'string' || !isFormSnapshot(parsed.values)) return null
    return { version: 1, savedAt: parsed.savedAt, values: parsed.values, reason: parsed.reason === 'session_expired' ? 'session_expired' : 'autosave' }
  } catch {
    return null
  }
}

function writeStoredFormDraft(key: string, draft: StoredFormDraft) {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // Storage full, blocked or unavailable: the form still works, only the local copy is missing.
  }
}

function removeStoredFormDraft(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}

export function useFormAutosave({
  storageKey,
  formRef,
  intervalMs = FORM_AUTOSAVE_INTERVAL_MS,
  onSessionRestore,
}: {
  /** null turns the local copy off. */
  storageKey: string | null
  formRef: RefObject<HTMLFormElement | null>
  intervalMs?: number
  /** A copy saved because the session expired is handed here on return (no "Restore?" question). */
  onSessionRestore?: (draft: StoredFormDraft) => void
}) {
  const [found, setFound] = useState<{ key: string; draft: StoredFormDraft | null } | null>(null)
  const [dirty, setDirty] = useState(false)
  const unsyncedRef = useRef(false)
  const pendingRef = useRef<StoredFormDraft | null>(null)
  const onSessionRestoreRef = useRef(onSessionRestore)
  useEffect(() => { onSessionRestoreRef.current = onSessionRestore })

  // The copy left from an earlier visit, read once storage is reachable (never during server rendering).
  useEffect(() => {
    if (!storageKey) return
    const draft = readStoredFormDraft(storageKey)
    if (draft?.reason === 'session_expired' && onSessionRestoreRef.current) {
      pendingRef.current = null
      onSessionRestoreRef.current(draft)
      setDirty(true)
      setFound({ key: storageKey, draft: null })
      return
    }
    pendingRef.current = draft
    setFound({ key: storageKey, draft })
  }, [storageKey])

  const pending = found && found.key === storageKey ? found.draft : null

  const save = useCallback((reason: StoredFormDraft['reason'] = 'autosave') => {
    const form = formRef.current
    if (!storageKey || !form) return
    // While "Restore your unsaved …?" is open the older copy is kept until the member chooses.
    if (pendingRef.current && reason === 'autosave') return
    writeStoredFormDraft(storageKey, { version: 1, savedAt: new Date().toISOString(), values: readFormSnapshot(form), reason })
    unsyncedRef.current = false
  }, [formRef, storageKey])

  const flush = useCallback(() => {
    if (unsyncedRef.current) save()
  }, [save])

  const markDirty = useCallback(() => {
    unsyncedRef.current = true
    setDirty(true)
  }, [])

  useEffect(() => {
    if (!storageKey) return
    const timer = window.setInterval(() => { if (unsyncedRef.current) save() }, intervalMs)
    function onHidden() { if (document.visibilityState === 'hidden' && unsyncedRef.current) save() }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', flush)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', flush)
    }
  }, [flush, intervalMs, save, storageKey])

  /** After a successful save or publish: the server has it, so the local copy goes. */
  const clear = useCallback(() => {
    if (storageKey) removeStoredFormDraft(storageKey)
    unsyncedRef.current = false
    pendingRef.current = null
    setDirty(false)
    setFound((current) => (current ? { ...current, draft: null } : current))
  }, [storageKey])

  /** "Restore": hands back the stored values; they stay stored until the next save replaces them. */
  const takePending = useCallback(() => {
    const draft = pendingRef.current
    pendingRef.current = null
    setFound((current) => (current ? { ...current, draft: null } : current))
    if (draft) setDirty(true)
    return draft
  }, [])

  /** "Discard": forgets the stored copy. */
  const discardPending = useCallback(() => {
    if (storageKey) removeStoredFormDraft(storageKey)
    pendingRef.current = null
    setFound((current) => (current ? { ...current, draft: null } : current))
  }, [storageKey])

  return { pending, dirty, markDirty, save, flush, clear, takePending, discardPending }
}
