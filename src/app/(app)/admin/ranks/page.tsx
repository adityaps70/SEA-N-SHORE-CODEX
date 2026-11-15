import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { AdminPageHeader, AdminPanel } from '@/features/admin/components/admin-ui'
import { addMasterRank, setMasterRankHidden } from '@/features/roles/admin-ranks-actions'
import { ADDED_RANK_LABEL_MAX, adminRanksRepository } from '@/features/roles/admin-ranks-repository'
import { ensureRoleCatalog } from '@/features/roles/catalog-runtime'
import { allRoles, jobDepartments, ladderStep, roleByKey, type RoleEntry } from '@/features/roles/taxonomy'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Ranks' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

const NOTICES: Record<string, string> = {
  added: 'Rank added. It shows in rank lists, job forms, profiles, search and matching on every server within 30 seconds.',
  hidden: 'Hidden from rank lists and job forms. Jobs and profiles that have it keep it, and it still matches.',
  shown: 'Shown again in rank lists and job forms.',
}
const ERRORS: Record<string, string> = {
  forbidden: 'Only platform administrators can change this.',
  invalid_label: `Enter the rank's name (2 to ${ADDED_RANK_LABEL_MAX} characters, with letters).`,
  invalid_department: 'Choose where the rank goes.',
  invalid_anchor: 'Choose the rank to place it next to.',
  duplicate: 'That name is already a rank or one of its other names. Find it in the list below.',
  invalid_synonym: `Other names: at most 8, each up to ${ADDED_RANK_LABEL_MAX} characters, all different.`,
  no_room: 'There is no room left between those two ranks. Place it next to a different rank.',
  not_found: 'That rank could not be found.',
  failed: 'Could not save the change. Try again.',
}

const RELATIONS = [
  { value: 'below', label: 'Below it (one step more junior)' },
  { value: 'same', label: 'At the same level' },
  { value: 'above', label: 'Above it (one step more senior)' },
] as const

/**
 * P6b (owner-approved 15 Nov): the master rank list in ladder order, department by department. Administrators add a
 * missing rank next to an existing one, and it appears everywhere at once: job validation, rank pickers, profiles,
 * search and matching. Ranks an administrator added can be hidden from pickers (jobs and profiles keep them).
 */
export default async function RanksAdminPage({ searchParams }: { searchParams: SearchParams }) {
  try {
    await requirePlatformAdministratorUser()
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') notFound()
    throw error
  }
  await ensureRoleCatalog()
  const params = await searchParams
  const usage = new Map((await adminRanksRepository.usage().catch(() => [])).map((row) => [row.code, row]))
  const notice = NOTICES[single(params.notice)] ?? null
  const error = ERRORS[single(params.error)] ?? null
  const addedCode = single(params.code)

  const departments = jobDepartments().map((department) => ({
    department,
    // Every rank of the department, hidden added ones included, in list order ("Other" left out).
    roles: allRoles().filter((role) => role.department === department.key && !role.other),
  }))
  const added = departments.reduce((sum, entry) => sum + entry.roles.filter((role) => role.added).length, 0)

  return (
    <div className="space-y-4">
      <Link href="/admin" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ocean-700 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> Overview
      </Link>
      <AdminPageHeader
        title="Ranks"
        meta={`${pluralize(added, 'rank', 'ranks')} added by administrators`}
        description="The master list of departments and ranks, in ladder order (step 1 is the most senior). A rank you add sits next to an existing one on the same ladder and appears everywhere within 30 seconds: job forms and validation, rank pickers, profiles, search and matching. Ranks are never deleted; hiding an added rank removes it from pickers only."
      />

      {notice ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{notice}{addedCode && roleByKey(addedCode) ? ` (${roleByKey(addedCode)!.label})` : ''}</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <AdminPanel>
        <form action={addMasterRank} className="grid gap-3 px-5 py-4 sm:grid-cols-2" aria-labelledby="add-rank-heading">
          <h3 id="add-rank-heading" className="text-sm font-bold text-navy-950 sm:col-span-2">Add a missing rank</h3>
          <label className="grid gap-1 text-sm font-semibold text-navy-950">
            Rank name
            <input name="label" required minLength={2} maxLength={ADDED_RANK_LABEL_MAX} className="min-h-10 rounded-lg border border-mist-200 px-3 font-normal" />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-navy-950">
            Next to
            <select name="anchorKey" required defaultValue="" className="min-h-10 rounded-lg border border-mist-200 px-3 font-normal">
              <option value="" disabled>Choose a rank</option>
              {departments.map(({ department, roles }) => (
                <optgroup key={department.key} label={department.label}>
                  {roles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <fieldset className="grid gap-1 text-sm sm:col-span-2">
            <legend className="font-semibold text-navy-950">Place it</legend>
            {RELATIONS.map((relation) => (
              <label key={relation.value} className="flex min-h-9 items-center gap-2">
                <input type="radio" name="relation" value={relation.value} defaultChecked={relation.value === 'below'} required />
                {relation.label}
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1 text-sm font-semibold text-navy-950 sm:col-span-2">
            Other names (optional, separated by commas)
            <input name="synonyms" maxLength={400} className="min-h-10 rounded-lg border border-mist-200 px-3 font-normal" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="min-h-10 rounded-lg bg-ocean-700 px-4 text-sm font-semibold text-white hover:bg-ocean-800">Add rank</button>
          </div>
        </form>
      </AdminPanel>

      {departments.map(({ department, roles }) => (
        <AdminPanel key={department.key}>
          <section aria-labelledby={`ranks-${department.key}`}>
            <h3 id={`ranks-${department.key}`} className="border-b border-mist-100 px-5 py-3 text-sm font-bold text-navy-950">{department.label}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="px-5 py-2 font-semibold">Rank / role</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Ladder step</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Used by</th>
                  <th scope="col" className="px-5 py-2 text-right font-semibold"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100">
                {roles.map((role: RoleEntry) => {
                  const used = usage.get(role.key)
                  return (
                    <tr key={role.key}>
                      <td className="px-5 py-2 font-semibold text-navy-950">
                        {role.label}
                        {role.added ? <span className="ml-2 rounded bg-ocean-50 px-1.5 py-0.5 text-xs font-semibold text-ocean-700">Added</span> : null}
                        {role.hidden ? <span className="ml-2 rounded bg-mist-100 px-1.5 py-0.5 text-xs font-semibold text-muted">Hidden</span> : null}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted">{ladderStep(role.key) ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-navy-950">
                        {used ? `${pluralize(used.profiles, 'profile', 'profiles')} · ${pluralize(used.jobs, 'job', 'jobs')}` : '—'}
                      </td>
                      <td className="px-5 py-2 text-right">
                        {role.added ? (
                          <form action={setMasterRankHidden}>
                            <input type="hidden" name="code" value={role.key} />
                            <input type="hidden" name="hidden" value={role.hidden ? 'false' : 'true'} />
                            <button
                              type="submit"
                              aria-label={`${role.hidden ? 'Show' : 'Hide'} ${role.label}`}
                              className="min-h-9 rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 hover:bg-mist-50"
                            >
                              {role.hidden ? 'Show' : 'Hide'}
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        </AdminPanel>
      ))}
    </div>
  )
}
