'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/cn'

/**
 * Round 11: every card on My Profile edits in place. Only one card (or one experience /
 * credential item) is in edit mode at a time; opening another while the open one has unsaved
 * changes asks in the page — "Discard changes to Basic information?" — never with window.confirm.
 */
type CardRef = { id: string; label: string }

type ProfileCardEditingContextValue = {
  activeId: string | null
  request: (card: CardRef) => void
  close: (id: string) => void
  markDirty: (id: string) => void
}

const ProfileCardEditingContext = createContext<ProfileCardEditingContextValue | null>(null)

function focusCardForm(id: string) {
  const form = document.querySelector<HTMLElement>(`[data-profile-card-form="${id}"]`)
  if (!form) return
  form.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  form.focus({ preventScroll: true })
}

export function ProfileCardEditingProvider({
  children,
  openOnLoad = null,
}: {
  children: ReactNode
  /** Round 12: a card a link asked to open (e.g. from a job's "Complete your profile to apply"). */
  openOnLoad?: CardRef | null
}) {
  const [active, setActive] = useState<CardRef | null>(null)
  const [pending, setPending] = useState<CardRef | null>(null)
  const activeRef = useRef<CardRef | null>(null)
  const dirtyRef = useRef(false)
  const titleId = useId()

  const activate = useCallback((card: CardRef | null) => {
    activeRef.current = card
    dirtyRef.current = false
    setActive(card)
    setPending(null)
  }, [])

  const request = useCallback((card: CardRef) => {
    const current = activeRef.current
    if (current?.id === card.id) {
      focusCardForm(card.id)
      return
    }
    if (current && dirtyRef.current) {
      setPending(card)
      return
    }
    activate(card)
  }, [activate])

  const close = useCallback((id: string) => {
    if (activeRef.current?.id === id) activate(null)
  }, [activate])

  const markDirty = useCallback((id: string) => {
    if (activeRef.current?.id === id) dirtyRef.current = true
  }, [])

  function keepEditing() {
    setPending(null)
    if (activeRef.current) focusCardForm(activeRef.current.id)
  }

  // Open the linked card once, then bring its form into view when it has rendered.
  const openedOnLoadRef = useRef(false)
  useEffect(() => {
    if (!openOnLoad || openedOnLoadRef.current) return
    openedOnLoadRef.current = true
    activate(openOnLoad)
    const frame = window.requestAnimationFrame(() => focusCardForm(openOnLoad.id))
    return () => window.cancelAnimationFrame(frame)
  }, [openOnLoad, activate])

  const value = useMemo(() => ({ activeId: active?.id ?? null, request, close, markDirty }), [active, request, close, markDirty])

  return (
    <ProfileCardEditingContext.Provider value={value}>
      {children}
      {pending && active ? (
        <div
          role="alertdialog"
          aria-labelledby={titleId}
          data-testid="profile-discard-prompt"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              keepEditing()
            }
          }}
          className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-2xl border border-mist-200 bg-white p-4 shadow-[0_18px_48px_rgba(7,24,46,.22)] md:bottom-6"
        >
          <p id={titleId} className="text-sm font-semibold text-navy-950">Discard changes to {active.label}?</p>
          <p className="mt-1 text-sm text-muted">Your changes to {active.label} have not been saved.</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              autoFocus
              onClick={keepEditing}
              className="min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition-colors hover:border-ocean-300 hover:bg-mist-50"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => activate(pending)}
              className="min-h-10 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-800"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </ProfileCardEditingContext.Provider>
  )
}

/**
 * Edit state for one card. Inside ProfileCardEditingProvider (My Profile) only one card edits at
 * a time; elsewhere each card keeps its own state. Closing returns focus to the card's pencil.
 */
export function useProfileCardEditor(id: string, label: string) {
  const context = useContext(ProfileCardEditingContext)
  const [localEditing, setLocalEditing] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocusRef = useRef(false)
  const editing = context ? context.activeId === id : localEditing
  const wasEditingRef = useRef(editing)

  useEffect(() => {
    if (wasEditingRef.current && !editing && restoreFocusRef.current) triggerRef.current?.focus()
    if (!editing) restoreFocusRef.current = false
    wasEditingRef.current = editing
  }, [editing])

  // The provider's functions are stable, so open / close / markDirty keep their identity while
  // other cards open and close.
  const request = context?.request
  const closeCard = context?.close
  const markCardDirty = context?.markDirty

  const open = useCallback(() => {
    if (request) request({ id, label })
    else setLocalEditing(true)
  }, [request, id, label])

  const close = useCallback(() => {
    restoreFocusRef.current = true
    if (closeCard) closeCard(id)
    else setLocalEditing(false)
  }, [closeCard, id])

  const markDirty = useCallback(() => {
    markCardDirty?.(id)
  }, [markCardDirty, id])

  return { editing, open, close, markDirty, triggerRef }
}

export const profileCardInputClass = 'mt-1 min-h-10 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500'
export const profileCardLabelClass = 'block text-sm font-semibold text-navy-950'

export function ProfileCardFieldError({ fieldErrors, name }: { fieldErrors?: Record<string, string[] | undefined>; name: string }) {
  const message = fieldErrors?.[name]?.[0]
  return message ? <p className="mt-1 text-xs font-medium text-red-700">{message}</p> : null
}

/**
 * The in-place edit form of a profile card: fields, an inline error, then Cancel and Save at the
 * bottom (kept reachable above the phone tab bar). Esc cancels; while saving both buttons are
 * disabled and Save reads "Saving…".
 */
export function ProfileCardForm({
  cardId,
  label,
  action,
  pending,
  onCancel,
  onDirty,
  error,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  saveDisabled = false,
  footerStart,
  className,
  children,
  onSubmit,
}: {
  cardId: string
  /** Accessible name of the form, e.g. "Edit About". */
  label: string
  action?: (formData: FormData) => void
  pending: boolean
  onCancel: () => void
  onDirty?: () => void
  error?: string | null
  submitLabel?: string
  cancelLabel?: string
  saveDisabled?: boolean
  /** Extra controls on the left of the footer, such as Delete. */
  footerStart?: ReactNode
  className?: string
  children: ReactNode
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
}) {
  const formRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    const form = formRef.current
    if (!form) return
    form.scrollIntoView?.({ block: 'nearest' })
    form.focus({ preventScroll: true })
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Escape' || event.defaultPrevented || pending) return
    const target = event.target as HTMLElement | null
    // An open organization search or list handles its own Escape first.
    if (target?.closest?.('[aria-expanded="true"], [data-phone-fullscreen="true"]')) return
    event.preventDefault()
    onCancel()
  }

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={onSubmit}
      tabIndex={-1}
      aria-label={label}
      data-profile-card-form={cardId}
      onChange={onDirty}
      onInput={onDirty}
      onKeyDown={onKeyDown}
      className={cn('mt-4 outline-none', className)}
    >
      {children}
      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-2 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mb-1 max-md:bg-white/95 max-md:py-3 max-md:backdrop-blur group-has-[[data-phone-tabbar=on]]/shell:max-md:bottom-[calc(4.5rem+env(safe-area-inset-bottom))]">
        {footerStart}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition-colors hover:border-ocean-300 hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={pending || saveDisabled}
            className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition-colors enabled:hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </form>
  )
}
