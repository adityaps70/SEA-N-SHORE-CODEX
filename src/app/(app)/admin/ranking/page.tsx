import type { Metadata } from 'next'
import { AdminPageHeader, AdminPanel } from '@/features/admin/components/admin-ui'
import { RankingSwitches } from '@/features/ranking/components/ranking-switches'
import { rankingSwitches } from '@/features/ranking/switches'
import { FEED_WEIGHTS_VERSION } from '@/features/ranking/feed-weights'
import { PEOPLE_WEIGHTS_VERSION } from '@/features/ranking/people-weights'
import { JOB_WEIGHTS_VERSION } from '@/features/ranking/job-weights'
import { RankingTestEmails } from '@/features/ranking/components/ranking-test-emails'
import { searchLog } from '@/features/search/search-log'
import { SEARCH_WEIGHTS_VERSION } from '@/features/search/search-weights'
import { listUnmappedTaxonomyValues } from '@/features/taxonomy/backfill'

export const metadata: Metadata = { title: 'Ranking · Admin' }
export const dynamic = 'force-dynamic'

const KIND_LABELS = { rank: 'Ranks', vessel: 'Vessel types', certificate: 'Certificates' } as const

/**
 * Round G: the ranking switches (each area can go back to the old behaviour without a deploy) and
 * the free-text taxonomy values that have no code yet. Values and counts only, never who typed them.
 */
export default async function AdminRankingPage() {
  const [modes, unmapped, noResults] = await Promise.all([
    rankingSwitches.listModes(),
    listUnmappedTaxonomyValues().catch(() => null),
    searchLog.noResults(100).catch(() => null),
  ])

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Ranking"
        description="Turn each new ranking on for administrators first, check it, then turn it on for everyone. Off restores the old behaviour within 30 seconds."
        meta={`Weights ${FEED_WEIGHTS_VERSION} · ${PEOPLE_WEIGHTS_VERSION} · ${JOB_WEIGHTS_VERSION} · ${SEARCH_WEIGHTS_VERSION}`}
      />
      <AdminPanel>
        <h3 className="border-b border-mist-100 px-4 py-3 text-base font-semibold text-navy-950">Switches</h3>
        <RankingSwitches modes={modes} />
      </AdminPanel>
      <AdminPanel>
        <h3 className="border-b border-mist-100 px-4 py-3 text-base font-semibold text-navy-950">Test emails</h3>
        <RankingTestEmails />
      </AdminPanel>
      <AdminPanel>
        <h3 className="border-b border-mist-100 px-4 py-3 text-base font-semibold text-navy-950">Searches with no results (last 30 days)</h3>
        {noResults === null ? (
          <p className="p-4 text-sm text-muted">This list appears once migration 0085 is applied.</p>
        ) : noResults.length ? (
          <table className="m-4 w-[calc(100%-2rem)] text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="pb-2">Search</th><th className="pb-2 text-right">Times</th></tr></thead>
            <tbody className="divide-y divide-mist-100">
              {noResults.map((row) => (
                <tr key={row.query}>
                  <td className="py-1.5 pr-2 text-navy-900">{row.query}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="p-4 text-sm text-muted">Every committed search found something.</p>}
      </AdminPanel>
      <AdminPanel>
        <h3 className="border-b border-mist-100 px-4 py-3 text-base font-semibold text-navy-950">Unmapped taxonomy values</h3>
        {unmapped ? (
          <div className="grid gap-4 p-4 lg:grid-cols-3">
            {(['rank', 'vessel', 'certificate'] as const).map((kind) => {
              const values = unmapped.values.filter((value) => value.kind === kind)
              return (
                <section key={kind} aria-labelledby={`unmapped-${kind}`}>
                  <h4 id={`unmapped-${kind}`} className="text-sm font-semibold text-navy-950">
                    {KIND_LABELS[kind]}: {unmapped.totals[kind].distinct} values, {unmapped.totals[kind].rows} entries
                  </h4>
                  {values.length ? (
                    <table className="mt-2 w-full text-sm">
                      <thead className="sr-only"><tr><th>Value</th><th>Entries</th></tr></thead>
                      <tbody className="divide-y divide-mist-100">
                        {values.map((value) => (
                          <tr key={value.value}>
                            <td className="py-1.5 pr-2 text-navy-900">{value.value}</td>
                            <td className="py-1.5 text-right tabular-nums text-muted">{value.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="mt-2 text-sm text-muted">Everything maps to the taxonomy.</p>}
                </section>
              )
            })}
          </div>
        ) : <p className="p-4 text-sm text-muted">Unmapped values appear once migration 0083 is applied.</p>}
      </AdminPanel>
    </div>
  )
}
