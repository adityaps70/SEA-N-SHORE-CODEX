import Link from 'next/link'

/** Round D: the batch page's tabs in Learning Studio (Overview, Sessions). */
export function BatchTabs({ courseId, batchId, active }: { courseId: string; batchId: string; active: 'overview' | 'sessions' }) {
  const base = `/learn/studio/courses/${courseId}/batches/${batchId}`
  const tabs = [
    { key: 'overview', label: 'Overview', href: base },
    { key: 'sessions', label: 'Sessions', href: `${base}/sessions` },
  ] as const
  return (
    <nav aria-label="Batch" className="mt-5 flex gap-2 overflow-x-auto">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? 'page' : undefined}
          className={`inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-bold ${tab.key === active ? 'border-navy-950 bg-navy-950 text-white' : 'border-mist-200 bg-white text-navy-900 hover:border-teal-400'}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
