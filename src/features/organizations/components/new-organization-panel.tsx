'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { OrganizationApplicationForm } from './organization-application-form'

/** Keeps the long registration form out of the way until someone asks for it. */
export function NewOrganizationPanel({ initiallyOpen = false, prefillName }: { initiallyOpen?: boolean; prefillName?: string }) {
  const [open, setOpen] = useState(initiallyOpen)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(initiallyOpen)

  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus()
    wasOpen.current = open
  }, [open])

  if (!open) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 transition hover:border-ocean-200 hover:bg-ocean-50"
      >
        <Plus aria-hidden="true" className="size-4" /> Register a new organization
      </button>
    )
  }

  return <OrganizationApplicationForm mode="create" prefillName={prefillName} onCancel={() => setOpen(false)} />
}
