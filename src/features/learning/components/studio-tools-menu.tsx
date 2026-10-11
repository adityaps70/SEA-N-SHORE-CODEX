'use client'

import Link from 'next/link'
import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Wrench } from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'
import { SHEET_MENU_ITEM_CLASS } from '@/components/ui/mobile-sheet'
import { cn } from '@/lib/cn'

/** Learning round E (E9): Studio's secondary pages, grouped under one "Tools" button next to "Create course". */
export function StudioToolsMenu({ tools }: { tools: Array<{ href: string; label: string; icon: ReactNode }> }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 transition hover:border-teal-300 hover:text-teal-800"
      >
        <Wrench aria-hidden="true" className="size-4" /> Tools <ChevronDown aria-hidden="true" className="size-4" />
      </button>
      <ActionMenu open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} label="Studio tools" className="w-60">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(
              'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-navy-950 hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none [&>svg]:size-4 [&>svg]:shrink-0',
              SHEET_MENU_ITEM_CLASS,
            )}
          >
            {tool.icon}
            <span>{tool.label}</span>
          </Link>
        ))}
      </ActionMenu>
    </>
  )
}
