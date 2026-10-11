'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Circle } from 'lucide-react'

/**
 * Learning round E (E9): the course editor's step navigation. A sticky column on wide screens and a row of chips
 * on phones. Each step links to its section and says whether it is done or needs attention; the section in view
 * is marked as the current one.
 */

export type CourseEditorStep = {
  id: string
  label: string
  /** done = ✓, attention = needs something before review, none = optional or informational. */
  state: 'done' | 'attention' | 'none'
  hint?: string
}

function StateIcon({ state }: { state: CourseEditorStep['state'] }) {
  if (state === 'done') return <CheckCircle2 role="img" aria-label="Done" className="size-4 shrink-0 text-teal-700" />
  if (state === 'attention') return <CircleAlert role="img" aria-label="Needs attention" className="size-4 shrink-0 text-amber-700" />
  return <Circle aria-hidden="true" className="size-4 shrink-0 text-mist-300" />
}

export function CourseEditorSteps({ steps }: { steps: CourseEditorStep[] }) {
  const [current, setCurrent] = useState<string | null>(steps[0]?.id ?? null)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const sections = steps.map((step) => document.getElementById(step.id)).filter((element): element is HTMLElement => Boolean(element))
    const visible = new Map<string, number>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top)
        else visible.delete(entry.target.id)
      }
      // The highest section still in view is the current step.
      const top = steps.find((step) => visible.has(step.id))
      if (top) setCurrent(top.id)
    }, { rootMargin: '-96px 0px -55% 0px' })
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [steps])

  const attention = steps.filter((step) => step.state === 'attention').length

  return (
    <nav aria-label="Course editor sections" className="lg:sticky lg:top-24">
      <p className="mb-2 hidden text-meta text-muted lg:block">
        {attention ? `${attention} section${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} attention` : 'Every section is ready'}
      </p>
      <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
        {steps.map((step) => {
          const active = step.id === current
          return (
            <li key={step.id} className="shrink-0">
              <a
                href={`#${step.id}`}
                aria-current={active ? 'location' : undefined}
                title={step.hint}
                onClick={() => setCurrent(step.id)}
                className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition max-lg:border ${active ? 'bg-navy-950 text-white max-lg:border-navy-950 [&_svg]:text-white' : 'text-navy-900 hover:bg-mist-50 max-lg:border-mist-200 max-lg:bg-white'}`}
              >
                <StateIcon state={step.state} />
                <span className="whitespace-nowrap">{step.label}</span>
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
