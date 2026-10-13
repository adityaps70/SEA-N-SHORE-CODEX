import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminPageHeader, AdminPanel } from '@/features/admin/components/admin-ui'
import { HEALTH_WINDOWS, createRankingHealth, per100, type RankingHealth } from '@/features/ranking/health'

export const metadata: Metadata = { title: 'Ranking health · Admin' }
export const dynamic = 'force-dynamic'

type Row = { label: string; value: (window: RankingHealth[7]) => string; note?: string }
type Section = { title: string; rows: Row[] }

const m = (window: RankingHealth[7], metric: string) => window.metrics[metric] ?? 0
const count = (value: number) => value.toLocaleString('en-IN')

const SECTIONS: Section[] = [
  {
    title: 'Feed',
    rows: [
      { label: 'Posts seen', value: (w) => count(w.postsSeen), note: 'Each member and post counted once' },
      { label: 'Reactions per 100 posts seen', value: (w) => per100(w.seenThenReacted, w.postsSeen), note: 'By the member shown the post, after it was shown' },
      { label: 'Comments per 100 posts seen', value: (w) => per100(w.seenThenCommented, w.postsSeen), note: 'By the member shown the post, after it was shown' },
      { label: 'Top for you pages', value: (w) => count(m(w, 'feed.top_pages')) },
      { label: 'Recent pages', value: (w) => count(m(w, 'feed.recent_pages')) },
      { label: 'Top share of feed pages', value: (w) => per100(m(w, 'feed.top_pages'), m(w, 'feed.top_pages') + m(w, 'feed.recent_pages')) + '%' },
      { label: '“Show less like this”', value: (w) => count(m(w, 'feed.show_less')) },
    ],
  },
  {
    title: 'People you may know',
    rows: [
      { label: 'Suggestions listed', value: (w) => count(m(w, 'pymk.cards_listed')) },
      { label: 'Requests sent per 100 listed', value: (w) => per100(m(w, 'pymk.requests_sent'), m(w, 'pymk.cards_listed')) },
      { label: 'Dismissed per 100 listed', value: (w) => per100(m(w, 'pymk.dismissed'), m(w, 'pymk.cards_listed')) },
    ],
  },
  {
    title: 'Jobs',
    rows: [
      { label: 'Applications from Jobs for you', value: (w) => count(m(w, 'jobs.applications.for_you')) },
      { label: 'Applications from search', value: (w) => count(m(w, 'jobs.applications.search') + m(w, 'jobs.applications.jobs')), note: 'Search page and the filtered jobs list' },
      { label: 'Applications from alerts and digest', value: (w) => count(m(w, 'jobs.applications.job_alert') + m(w, 'jobs.applications.digest')) },
      { label: 'Applications from a job page link', value: (w) => count(m(w, 'jobs.applications.job_page')) },
      { label: '“Not interested”', value: (w) => count(m(w, 'jobs.not_interested')) },
    ],
  },
  {
    title: 'Alerts and digest',
    rows: [
      { label: 'Job alert emails sent', value: (w) => count(m(w, 'email.job_alerts.sent')) },
      { label: 'Visits from job alerts (?src=job_alert)', value: (w) => count(m(w, 'visits.job_alert')) },
      { label: 'Digest emails sent', value: (w) => count(m(w, 'email.weekly_digest.sent')) },
      { label: 'Visits from the digest (?src=digest)', value: (w) => count(m(w, 'visits.digest')) },
    ],
  },
  {
    title: 'Search',
    rows: [
      { label: 'Searches (Enter, See all or a result opened)', value: (w) => count(w.searches) },
      { label: 'Zero-result rate', value: (w) => `${per100(w.zeroResultSearches, w.searches)}%` },
    ],
  },
]

/**
 * Round G (MEASURE): whether the new rules help, before any weight is tuned. Last 7 and 28 days,
 * totals only: no member names, ids or lists of people.
 */
export default async function RankingHealthPage() {
  const health = await createRankingHealth().load().catch(() => null)

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Ranking health"
        description="Totals for the last 7 and 28 days. No member is named or listed here."
        meta={<Link href="/admin/ranking" className="font-semibold text-ocean-700 hover:underline">Switches and weights</Link>}
      />
      {!health ? <AdminPanel><p className="p-4 text-sm text-muted">The numbers appear once migration 0083 is applied.</p></AdminPanel> : SECTIONS.map((section) => (
        <AdminPanel key={section.title}>
          <table className="w-full text-sm">
            <caption className="border-b border-mist-100 px-4 py-3 text-left text-base font-semibold text-navy-950">{section.title}</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-4 py-2 font-semibold">Measure</th>
                {HEALTH_WINDOWS.map((days) => <th key={days} scope="col" className="px-4 py-2 text-right font-semibold">Last {days} days</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-mist-100">
              {section.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-4 py-2 text-left font-normal text-navy-900">
                    {row.label}
                    {row.note ? <span className="block text-xs text-muted">{row.note}</span> : null}
                  </th>
                  {HEALTH_WINDOWS.map((days) => <td key={days} className="px-4 py-2 text-right tabular-nums text-navy-950">{row.value(health[days])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </AdminPanel>
      ))}
    </div>
  )
}
