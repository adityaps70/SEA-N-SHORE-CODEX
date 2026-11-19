import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { AdminPageHeader, AdminPanel } from '@/features/admin/components/admin-ui'
import { setJobExtraRankHidden } from '@/features/jobs/extra-ranks-admin-actions'
import { extraRanksRepository, type DepartmentExtraRankLink } from '@/features/jobs/extra-ranks-repository'
import { departmentByKey, roleByKey } from '@/features/roles/taxonomy'
import { pluralize } from '@/lib/format'
import { requireAdminAccess } from '@/features/admin/admin-access'

export const metadata: Metadata = { title: 'Job extra ranks' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

const NOTICES: Record<string, string> = {
  hidden: 'Hidden. It no longer shows on that department’s job form; jobs already posted keep it.',
  shown: 'Shown again on that department’s job form.',
}
const ERRORS: Record<string, string> = {
  forbidden: 'Only platform administrators can change this.',
  not_found: 'That rank is no longer linked to the department.',
  failed: 'Could not save the change. Try again.',
}

/**
 * P6 (owner-approved 13 Nov): ranks from other departments that posters added to a department's jobs. Each shows
 * as a tick box (not ticked) on that department's job form for every poster, most used first. Hiding one removes it
 * from future forms only; jobs already posted keep their ranks.
 */
export default async function JobExtraRanksAdminPage({ searchParams }: { searchParams: SearchParams }) {
  try {
    await requireAdminAccess('platform')
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') notFound()
    throw error
  }
  const params = await searchParams
  const links = await extraRanksRepository.listAll()
  const notice = NOTICES[single(params.notice)] ?? null
  const error = ERRORS[single(params.error)] ?? null

  const byDepartment = new Map<string, DepartmentExtraRankLink[]>()
  for (const link of links) byDepartment.set(link.departmentKey, [...(byDepartment.get(link.departmentKey) ?? []), link])
  const hidden = links.filter((link) => link.hidden).length

  return (
    <div className="space-y-4">
      <Link href="/admin" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ocean-700 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> Overview
      </Link>
      <AdminPageHeader
        title="Job extra ranks"
        meta={`${pluralize(links.length, 'rank', 'ranks')} added across ${pluralize(byDepartment.size, 'department', 'departments')} · ${hidden} hidden`}
        description="Ranks from other departments that posters added to a department’s jobs. Every poster then sees them as tick boxes (not ticked) on that department’s job form, most used first. “Used on” counts the jobs under the department (drafts included, deleted ones not) that accept the rank. Hiding one removes it from future forms only; jobs already posted keep it."
      />

      {notice ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {byDepartment.size ? [...byDepartment].map(([departmentKey, entries]) => {
        const departmentLabel = departmentByKey(departmentKey)?.label ?? departmentKey
        const headingId = `extra-ranks-${departmentKey}`
        return (
          <AdminPanel key={departmentKey}>
            <section aria-labelledby={headingId}>
              <h3 id={headingId} className="border-b border-mist-100 px-5 py-3 text-sm font-bold text-navy-950">{departmentLabel}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="px-5 py-2 font-semibold">Rank / role</th>
                    <th scope="col" className="px-3 py-2 font-semibold">From</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Used on</th>
                    <th scope="col" className="px-5 py-2 text-right font-semibold"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mist-100">
                  {entries.map((link) => {
                    const role = roleByKey(link.roleKey)
                    const label = role?.label ?? link.roleKey
                    return (
                      <tr key={link.roleKey}>
                        <td className="px-5 py-2 font-semibold text-navy-950">
                          {label}
                          {link.hidden ? <span className="ml-2 rounded bg-mist-100 px-1.5 py-0.5 text-xs font-semibold text-muted">Hidden</span> : null}
                        </td>
                        <td className="px-3 py-2 text-muted">{role ? departmentByKey(role.department)?.label ?? role.department : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-navy-950">{pluralize(link.timesUsed, 'job', 'jobs')}</td>
                        <td className="px-5 py-2 text-right">
                          <form action={setJobExtraRankHidden}>
                            <input type="hidden" name="departmentKey" value={departmentKey} />
                            <input type="hidden" name="roleKey" value={link.roleKey} />
                            <input type="hidden" name="hidden" value={link.hidden ? 'false' : 'true'} />
                            <button
                              type="submit"
                              aria-label={`${link.hidden ? 'Show' : 'Hide'} ${label} for ${departmentLabel}`}
                              className="min-h-9 rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 hover:bg-mist-50"
                            >
                              {link.hidden ? 'Show' : 'Hide'}
                            </button>
                          </form>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          </AdminPanel>
        )
      }) : (
        <AdminPanel>
          <p className="px-5 py-4 text-sm text-muted">No posters have added ranks from other departments yet.</p>
        </AdminPanel>
      )}
    </div>
  )
}
