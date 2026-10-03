import { Monitor } from 'lucide-react'
import type { ReactNode } from 'react'

/** Phone-only amber notice for tools that are built for a larger screen (round 8). */
export function WorksBestOnComputer({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <div role="note" className={`flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 md:hidden ${className}`.trim()}>
      <Monitor aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
      <p>{children ?? 'Works best on a computer. Everything still works here.'}</p>
    </div>
  )
}
