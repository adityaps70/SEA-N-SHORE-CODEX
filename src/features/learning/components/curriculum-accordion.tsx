'use client'

import { IntentLink } from '@/components/navigation/intent-link'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { CheckCircle2, ChevronDown, Circle, LockKeyhole, PlayCircle } from 'lucide-react'
import { moduleLabel } from '../module-label'

/**
 * Learning round E (E1): the course curriculum as an accordion, one module per row. Used by the player's
 * sidebar, the phone curriculum sheet and the public course page ("What's inside").
 *
 * - Only the module holding the current lesson opens by default (the first module when there is none).
 * - Open modules are remembered per course in this browser (`storageKey`), falling back to the default
 *   when storage is unavailable.
 * - Headers are buttons with aria-expanded/aria-controls. ArrowUp/ArrowDown move between headers and
 *   lesson rows, Home/End jump to the first/last, Enter or Space activates.
 * - The current lesson is scrolled into view inside its scrolling container (the closest
 *   `[data-curriculum-scroll]` ancestor) on load and on lesson change, without scrolling the page.
 */

export type CurriculumItemView = {
  id: string
  title: string
  /** Where the row links to; omitted for rows that are not links (e.g. the public outline). */
  href?: string | null
  /** e.g. "Video · 3 min". */
  meta: string
  /** Visible status words ("Completed", "Locked"); screen readers get the status from the icon instead. */
  statusLabel?: string | null
  status: 'completed' | 'available' | 'locked' | 'preview' | 'outline'
  /** e.g. 'After "Lesson 1.2"' for a prerequisite. */
  note?: string | null
}

export type CurriculumModuleView = {
  id: string
  title: string
  items: CurriculumItemView[]
  /** Learner progress (player); omitted on the public page. */
  done?: number
  /** e.g. "4 items · 32 min" on the public page. */
  summary?: string
}

const STORAGE_PREFIX = 'sea-n-shore.learn.curriculum.'

function readStored(storageKey: string | null) {
  if (!storageKey) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : null
  } catch {
    // Storage unavailable (private window) or a bad value: use the default.
    return null
  }
}

function writeStored(storageKey: string | null, open: ReadonlySet<string>) {
  if (!storageKey) return
  try {
    window.localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify([...open]))
  } catch {
    // Not remembered; the accordion still works.
  }
}

function ProgressRing({ percent, label }: { percent: number; label: string }) {
  const radius = 8
  const circumference = 2 * Math.PI * radius
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0 -rotate-90" role="img" aria-label={label}>
      <circle cx="10" cy="10" r={radius} fill="none" stroke="var(--mist-200)" strokeWidth="3" />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke={percent >= 100 ? 'var(--teal-500)' : 'var(--ocean-600)'}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, percent)) / 100)}
      />
    </svg>
  )
}

function StatusIcon({ status, active }: { status: CurriculumItemView['status']; active: boolean }) {
  const tone = active ? 'text-white' : status === 'completed' ? 'text-teal-700' : 'text-navy-500'
  if (status === 'completed') return <CheckCircle2 className={`mt-0.5 size-4 shrink-0 ${tone}`} role="img" aria-label="Completed" />
  if (status === 'locked') return <LockKeyhole className={`mt-0.5 size-4 shrink-0 ${tone}`} role="img" aria-label="Locked" />
  if (status === 'preview') return <PlayCircle className={`mt-0.5 size-4 shrink-0 ${tone}`} role="img" aria-label="Free preview" />
  return <Circle className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden="true" />
}

export function CurriculumAccordion({
  modules,
  currentItemId = null,
  storageKey = null,
  defaultOpenModuleId = null,
  onNavigate,
  label = 'Course curriculum',
}: {
  modules: CurriculumModuleView[]
  currentItemId?: string | null
  /** Remember open modules per course (the course slug); null to not remember. */
  storageKey?: string | null
  /** Module open by default when no item is current (defaults to the first module). */
  defaultOpenModuleId?: string | null
  /** Called after a lesson link is chosen (the phone sheet closes itself). */
  onNavigate?: () => void
  label?: string
}) {
  const baseId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const currentModuleId = modules.find((module) => module.items.some((item) => item.id === currentItemId))?.id
    ?? defaultOpenModuleId
    ?? modules[0]?.id
    ?? null
  // The server render opens only the current module; the remembered state is applied after hydration.
  const [open, setOpen] = useState<Set<string>>(() => new Set(currentModuleId ? [currentModuleId] : []))
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    const stored = readStored(storageKey)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state, applied once after hydration
    if (stored) setOpen(new Set([...stored, ...(currentModuleId ? [currentModuleId] : [])]))
    setRestored(true)
    // The current module always opens when the lesson changes.
  }, [storageKey, currentModuleId])

  const update = useCallback((next: Set<string>) => {
    setOpen(next)
    writeStored(storageKey, next)
  }, [storageKey])

  // Keep the current lesson visible inside the sidebar (not the page) on load and on lesson change.
  useEffect(() => {
    if (!restored || !currentItemId) return
    const container = rootRef.current?.closest<HTMLElement>('[data-curriculum-scroll]')
    const item = rootRef.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(currentItemId)}"]`)
    if (!item) return
    // Inside the phone sheet (no sidebar container) the sheet itself scrolls; the page is locked.
    if (!container) {
      item.scrollIntoView?.({ block: 'nearest' })
      return
    }
    const containerBox = container.getBoundingClientRect()
    const itemBox = item.getBoundingClientRect()
    if (itemBox.top < containerBox.top || itemBox.bottom > containerBox.bottom) {
      container.scrollTop += itemBox.top - containerBox.top - containerBox.height / 3
    }
  }, [restored, currentItemId])

  function toggle(moduleId: string) {
    const next = new Set(open)
    if (next.has(moduleId)) next.delete(moduleId)
    else next.add(moduleId)
    update(next)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const focusable = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-curriculum-focus]') ?? [])
      .filter((element) => !element.closest('[hidden]'))
    if (!focusable.length) return
    const index = focusable.indexOf(document.activeElement as HTMLElement)
    let next = index
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : Math.min(focusable.length - 1, index + 1)
    if (event.key === 'ArrowUp') next = index < 0 ? 0 : Math.max(0, index - 1)
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = focusable.length - 1
    event.preventDefault()
    focusable[next]?.focus()
  }

  const allOpen = modules.length > 0 && modules.every((module) => open.has(module.id))

  return (
    <div ref={rootRef} onKeyDown={onKeyDown}>
      {modules.length > 1 ? (
        <div className="mb-2 flex justify-end px-1">
          <button
            type="button"
            onClick={() => update(allOpen ? new Set() : new Set(modules.map((module) => module.id)))}
            className="min-h-9 cursor-pointer rounded-lg px-2 text-meta font-semibold text-ocean-700 hover:bg-ocean-50"
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      ) : null}
      <ol aria-label={label} className="space-y-1">
        {modules.map((module, moduleIndex) => {
          const expanded = open.has(module.id)
          const panelId = `${baseId}-module-${moduleIndex}`
          const total = module.items.length
          const percent = module.done !== undefined && total ? Math.round((module.done / total) * 100) : null
          return (
            <li key={module.id} className="rounded-2xl">
              <h3 className="m-0 [text-wrap:wrap]">
                <button
                  type="button"
                  data-curriculum-focus=""
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => toggle(module.id)}
                  className="group flex min-h-12 w-full cursor-pointer items-start gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-mist-50"
                >
                  <ChevronDown aria-hidden="true" className={`mt-1 size-4 shrink-0 text-navy-500 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                  <span className="min-w-0 flex-1">
                    {/* Round H (H7): no "Module N" above a title that already starts with it. */}
                    {moduleLabel(moduleIndex, module.title) ? (
                      <span className="block text-meta font-medium text-muted">{moduleLabel(moduleIndex, module.title)}</span>
                    ) : null}
                    <span className="block font-sans text-[15px] font-semibold leading-snug text-navy-950">{module.title}</span>
                    <span className="mt-0.5 block text-meta text-muted">
                      {percent !== null ? `${module.done}/${total} · ${percent}%` : module.summary ?? `${total} item${total === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  {percent !== null ? <ProgressRing percent={percent} label={`${percent}% complete`} /> : null}
                </button>
              </h3>
              <ul id={panelId} hidden={!expanded} className="mb-2 mt-1 space-y-0.5 pl-2">
                {module.items.map((item) => {
                  const active = item.id === currentItemId
                  const body = (
                    <>
                      <StatusIcon status={item.status} active={active} />
                      <span className="min-w-0">
                        <span className="block text-sm leading-5">{item.title}</span>
                        <span className={`mt-0.5 block text-meta ${active ? 'text-white/80' : 'text-muted'}`}>
                          {item.meta}
                          {item.statusLabel ? <span aria-hidden="true"> · {item.statusLabel}</span> : null}
                        </span>
                        {item.note ? (
                          <span className={`mt-1 inline-flex max-w-full rounded-full px-2 py-0.5 text-xs font-semibold ${active ? 'bg-white/15 text-white' : 'bg-amber-50 text-amber-800'}`}>
                            <span className="truncate">{item.note}</span>
                          </span>
                        ) : null}
                      </span>
                    </>
                  )
                  const rowClass = `flex min-h-11 items-start gap-3 rounded-xl px-3 py-2.5 ${active ? 'bg-navy-950 text-white' : 'text-navy-800'}`
                  return (
                    <li key={item.id} data-item-id={item.id}>
                      {item.href ? (
                        // Owner (17 Nov): every visible lesson row was prefetched on load (about 20 RSC requests per
                        // lesson opened, almost all for lessons never visited); now only on hover, focus or tap.
                        <IntentLink
                          href={item.href}
                          data-curriculum-focus=""
                          aria-current={active ? 'page' : undefined}
                          onClick={onNavigate}
                          className={`${rowClass} ${active ? '' : 'hover:bg-mist-50'}`}
                        >
                          {body}
                        </IntentLink>
                      ) : (
                        <div className={rowClass}>{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
