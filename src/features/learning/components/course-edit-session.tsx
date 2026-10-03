'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, CircleDot, Loader2 } from 'lucide-react'

/**
 * Keeps every editor on the course edit page (details form, curriculum,
 * materials, quizzes) honest about unsaved work:
 * - editors report what is unsaved, and how to save it;
 * - "Submit for review" saves everything first, then submits;
 * - leaving the page with unsaved work asks first (links, reload, tab close).
 */

export type SaveOutcome = { ok: true } | { ok: false; error: string }

type UnsavedEntry = {
  label: string
  save?: () => Promise<SaveOutcome>
}

export type SaveAllOutcome = { ok: true } | { ok: false; error: string; label: string }

type CourseEditSessionValue = {
  setEntry: (id: string, entry: UnsavedEntry | null) => void
  unsavedLabels: string[]
  saveAll: () => Promise<SaveAllOutcome>
  getDetailsRevision: () => number | null
  setDetailsRevision: (revision: number) => void
}

type CourseEditRegistry = Omit<CourseEditSessionValue, 'unsavedLabels'>

// Two contexts: the registry's functions never change identity, so editors that
// register unsaved work don't re-run their effects every time the list changes.
const CourseEditRegistryContext = createContext<CourseEditRegistry | null>(null)
const CourseEditUnsavedContext = createContext<string[]>([])

const fallbackSession: CourseEditSessionValue = {
  setEntry: () => undefined,
  unsavedLabels: [],
  saveAll: async () => ({ ok: true }),
  getDetailsRevision: () => null,
  setDetailsRevision: () => undefined,
}

export function useCourseEditSession(): CourseEditSessionValue {
  const registry = useContext(CourseEditRegistryContext)
  const unsavedLabels = useContext(CourseEditUnsavedContext)
  return useMemo(() => (registry ? { ...registry, unsavedLabels } : fallbackSession), [registry, unsavedLabels])
}

/**
 * Registers an editor's unsaved state. `save` is optional: without it the work
 * still triggers the leave warning but "Save and leave" is not offered.
 */
export function useUnsavedChanges(
  id: string,
  dirty: boolean,
  label: string,
  save?: () => Promise<SaveOutcome>,
) {
  const session = useContext(CourseEditRegistryContext)
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })
  const hasSave = Boolean(save)

  useEffect(() => {
    if (!session) return
    if (!dirty) {
      session.setEntry(id, null)
      return
    }
    session.setEntry(id, {
      label,
      save: hasSave ? () => saveRef.current?.() ?? Promise.resolve({ ok: true } as const) : undefined,
    })
  }, [dirty, hasSave, id, label, session])

  useEffect(() => () => session?.setEntry(id, null), [id, session])
}

function isPlainLeftClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function internalDestination(anchor: HTMLAnchorElement) {
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

export function CourseEditSession({
  children,
  initialDetailsRevision = null,
}: {
  children: ReactNode
  initialDetailsRevision?: number | null
}) {
  const router = useRouter()
  const entriesRef = useRef(new Map<string, UnsavedEntry>())
  const [unsaved, setUnsaved] = useState<Array<{ label: string; canSave: boolean }>>([])
  const revisionRef = useRef<number | null>(initialDetailsRevision)
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const stayButtonRef = useRef<HTMLButtonElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const publish = useCallback(() => {
    const next = [...entriesRef.current.values()].map((entry) => ({ label: entry.label, canSave: Boolean(entry.save) }))
    setUnsaved((current) => (
      current.length === next.length
      && current.every((item, index) => item.label === next[index]?.label && item.canSave === next[index]?.canSave)
        ? current
        : next
    ))
  }, [])

  const setEntry = useCallback((id: string, entry: UnsavedEntry | null) => {
    if (entry) entriesRef.current.set(id, entry)
    else if (!entriesRef.current.delete(id)) return
    publish()
  }, [publish])

  const saveAll = useCallback(async (): Promise<SaveAllOutcome> => {
    for (const [id, entry] of [...entriesRef.current.entries()]) {
      if (!entry.save) {
        return { ok: false, label: entry.label, error: 'Finish or cancel this change first.' }
      }
      const result = await entry.save()
      if (!result.ok) return { ok: false, label: entry.label, error: result.error }
      entriesRef.current.delete(id)
    }
    publish()
    return { ok: true }
  }, [publish])

  const unsavedLabels = useMemo(() => unsaved.map((item) => item.label), [unsaved])
  const hasUnsaved = unsaved.length > 0
  const canSaveAll = unsaved.every((item) => item.canSave)

  useEffect(() => {
    if (!hasUnsaved) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      // Required by some browsers to show the native "Leave site?" prompt.
      event.returnValue = ''
    }
    function onClickCapture(event: MouseEvent) {
      if (event.defaultPrevented || !isPlainLeftClick(event)) return
      const target = event.target as Element | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const destination = internalDestination(anchor)
      if (!destination) return
      event.preventDefault()
      returnFocusRef.current = anchor
      setLeaveError(null)
      setPendingHref(destination)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, [hasUnsaved])

  const closeDialog = useCallback(() => {
    setPendingHref(null)
    setLeaveError(null)
    returnFocusRef.current?.focus?.()
  }, [])

  useEffect(() => {
    if (!pendingHref) return
    stayButtonRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDialog()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeDialog, pendingHref])

  function leaveWithoutSaving() {
    if (!pendingHref) return
    const href = pendingHref
    entriesRef.current.clear()
    publish()
    setPendingHref(null)
    router.push(href)
  }

  async function saveAndLeave() {
    if (!pendingHref) return
    const href = pendingHref
    setLeaving(true)
    setLeaveError(null)
    const result = await saveAll()
    setLeaving(false)
    if (!result.ok) {
      setLeaveError(`${result.label} could not be saved: ${result.error}`)
      return
    }
    setPendingHref(null)
    router.push(href)
  }

  const registry = useMemo<CourseEditRegistry>(() => ({
    setEntry,
    saveAll,
    getDetailsRevision: () => revisionRef.current,
    setDetailsRevision: (revision: number) => {
      revisionRef.current = revision
    },
  }), [saveAll, setEntry])

  return (
    <CourseEditRegistryContext.Provider value={registry}>
      <CourseEditUnsavedContext.Provider value={unsavedLabels}>
      {children}
      {pendingHref ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/35 p-4 sm:items-center" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !leaving) closeDialog()
        }}>
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="course-leave-title"
            aria-describedby="course-leave-description"
            className="w-full max-w-md rounded-2xl border border-mist-100 bg-white p-5 shadow-2xl"
          >
            <h2 id="course-leave-title" className="flex items-center gap-2 text-lg font-bold text-navy-950">
              <AlertTriangle aria-hidden="true" className="size-5 text-amber-600" /> You have unsaved changes
            </h2>
            <div id="course-leave-description" className="mt-2 text-sm leading-6 text-muted">
              <p>If you leave now, these changes will be lost:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-navy-950">
                {unsavedLabels.map((label) => <li key={label}>{label}</li>)}
              </ul>
            </div>
            {leaveError ? (
              <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{leaveError}</p>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                ref={stayButtonRef}
                type="button"
                onClick={closeDialog}
                disabled={leaving}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-mist-200 bg-white px-4 py-2 text-sm font-bold text-navy-950 transition hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-60"
              >
                Stay on this page
              </button>
              <button
                type="button"
                onClick={leaveWithoutSaving}
                disabled={leaving}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-800 transition hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:opacity-60"
              >
                Leave without saving
              </button>
              {canSaveAll ? (
                <button
                  type="button"
                  onClick={() => void saveAndLeave()}
                  disabled={leaving}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-60"
                >
                  {leaving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  {leaving ? 'Saving…' : 'Save and leave'}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
      </CourseEditUnsavedContext.Provider>
    </CourseEditRegistryContext.Provider>
  )
}

export type SaveStatusState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error'; message: string }

export function formatSavedTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date)
}

/** "Saving…", "Unsaved changes", "Saved at 14:32" or "Not saved", announced politely to screen readers. */
export function SaveStatus({ state, dirty }: { state: SaveStatusState; dirty: boolean }) {
  let tone = 'text-muted'
  let icon: ReactNode = <CheckCircle2 aria-hidden="true" className="size-4" />
  let copy = 'All changes saved'
  let kind: string = state.kind

  if (state.kind === 'saving') {
    tone = 'text-navy-900'
    icon = <Loader2 aria-hidden="true" className="size-4 animate-spin" />
    copy = 'Saving…'
  } else if (state.kind === 'error') {
    tone = 'text-rose-700'
    icon = <AlertTriangle aria-hidden="true" className="size-4" />
    copy = dirty ? 'Not saved — your changes are still here' : 'Not saved'
  } else if (dirty) {
    tone = 'text-amber-800'
    icon = <CircleDot aria-hidden="true" className="size-4" />
    copy = 'Unsaved changes'
    kind = 'dirty'
  } else if (state.kind === 'saved') {
    tone = 'text-emerald-700'
    copy = `Saved at ${formatSavedTime(state.at)}`
  }

  return (
    <p role="status" aria-live="polite" data-save-state={kind} className={`inline-flex items-center gap-1.5 text-sm font-semibold ${tone}`}>
      {icon}
      <span>{copy}</span>
    </p>
  )
}
