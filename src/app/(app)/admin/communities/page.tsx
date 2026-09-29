import type { Metadata } from 'next'
import Link from 'next/link'
import { Archive, ArchiveRestore, ExternalLink, PencilLine, Search, UserRound } from 'lucide-react'
import { AdminChip, AdminEmptyState, AdminFilterBar, AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { ADMIN_TABLE_DESKTOP_CLASS, AdminMobileCard, AdminMobileList } from '@/features/admin/components/admin-mobile-list'
import { archiveGroupAsAdmin, unarchiveGroupAsAdmin } from '@/features/community/admin-actions'
import { AdminGroupForm, AdminGroupOwnerForm } from '@/features/community/components/admin-group-form'
import { GroupIconTile } from '@/features/community/components/group-icon-tile'
import { communityRepository } from '@/features/community/repository'
import { groupHref, type AdminCommunityGroup } from '@/features/community/types'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Communities · Admin' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const FILTERS = ['all', 'live', 'archived'] as const
type Filter = (typeof FILTERS)[number]
const FILTER_LABELS: Record<Filter, string> = { all: 'All groups', live: 'Live', archived: 'Archived' }

function single(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

function readFilter(value: string | string[] | undefined): Filter {
  const candidate = single(value)
  return (FILTERS as readonly string[]).includes(candidate) ? candidate as Filter : 'all'
}

const actionClass = 'inline-flex min-h-8 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border border-mist-200 bg-white px-2.5 text-xs font-semibold text-navy-950 transition hover:border-ocean-200 hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'

function ArchiveForm({ group }: { group: AdminCommunityGroup }) {
  const archived = Boolean(group.archivedAt)
  return (
    <form action={archived ? unarchiveGroupAsAdmin : archiveGroupAsAdmin}>
      <input type="hidden" name="groupId" value={group.id} />
      <button type="submit" className={actionClass} aria-label={`${archived ? 'Restore' : 'Archive'} ${group.name}`}>
        {archived ? <ArchiveRestore aria-hidden="true" className="size-3.5" /> : <Archive aria-hidden="true" className="size-3.5" />}
        {archived ? 'Restore' : 'Archive'}
      </button>
    </form>
  )
}

export default async function AdminCommunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const query = single(params.q).trim().slice(0, 120)
  const filter = readFilter(params.status)
  const editId = single(params.edit) || single(params.group)
  const createdSlug = single(params.created)
  const groups = await communityRepository.listAdminGroups({ search: query, archived: filter })
  const editing = editId ? groups.find((group) => group.id === editId) ?? null : null

  function href(next: { status?: Filter }) {
    const search = new URLSearchParams()
    if (query) search.set('q', query)
    const status = next.status ?? filter
    if (status !== 'all') search.set('status', status)
    const value = search.toString()
    return `/admin/communities${value ? `?${value}` : ''}`
  }

  return (
    <main className="space-y-4">
      <AdminPageHeader
        title="Communities"
        meta={pluralize(groups.length, 'group')}
        description="Every community group: who owns it, how many members it has and whether it is live. Reports about groups and group posts arrive in Moderation."
        actions={<a href="#create-group" className="inline-flex min-h-9 items-center rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white hover:bg-navy-900">Create group</a>}
      />

      {createdSlug ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
          Group created. <Link href={groupHref(createdSlug)} className="underline">Open its page</Link>.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <AdminFilterBar label="Group filters" options={FILTERS.map((item) => ({ href: href({ status: item }), label: FILTER_LABELS[item], active: item === filter }))} />
        <form method="get" action="/admin/communities" className="flex gap-2 xl:w-96">
          <label className="relative flex-1">
            <span className="sr-only">Search groups</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input type="search" name="q" defaultValue={query} maxLength={120} placeholder="Name or slug" className="min-h-9 w-full rounded-lg border border-mist-100 bg-white py-1.5 pl-9 pr-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100" />
          </label>
          {filter !== 'all' ? <input type="hidden" name="status" value={filter} /> : null}
          <button type="submit" className="min-h-9 rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white hover:bg-navy-900">Search</button>
        </form>
      </div>

      <AdminPanel>
        {groups.length === 0 ? (
          <AdminEmptyState title="No groups match this view." description="Try a different search term or filter, or create a group below." />
        ) : (
          <>
            <AdminMobileList label="Groups">
              {groups.map((group) => (
                <AdminMobileCard
                  key={group.id}
                  title={group.name}
                  href={groupHref(group.slug)}
                  leading={<GroupIconTile icon={group.icon} iconUrl={group.iconUrl} size="sm" />}
                  subtitle={`/${group.slug}`}
                  badges={group.archivedAt ? <AdminChip tone="danger">Archived</AdminChip> : <AdminChip tone="success">Live</AdminChip>}
                  fields={[
                    { label: 'Visibility', value: group.visibility === 'private' ? 'Private' : 'Public' },
                    { label: 'Members', value: group.pendingCount ? `${group.memberCount} (+${group.pendingCount} waiting)` : group.memberCount },
                    { label: 'Owner', value: group.owner?.fullName ?? 'No owner' },
                    { label: 'Created', value: formatAdminDate(group.createdAt) },
                  ]}
                  actions={[
                    { kind: 'link', href: groupHref(group.slug), label: 'View group', icon: <ExternalLink aria-hidden="true" /> },
                    { kind: 'link', href: `/admin/communities?edit=${group.id}#edit-group`, label: 'Edit, archive or change owner', icon: <PencilLine aria-hidden="true" /> },
                    ...(group.owner ? [{ kind: 'link' as const, href: `/admin/users/${group.owner.id}`, label: `Owner: ${group.owner.fullName}`, icon: <UserRound aria-hidden="true" /> }] : []),
                  ]}
                />
              ))}
            </AdminMobileList>
            <div className={ADMIN_TABLE_DESKTOP_CLASS}>
              <table className="w-full min-w-[58rem] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[30%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                  <col className="w-[17%]" />
                  <col className="w-[10%]" />
                  <col className="w-[11%]" />
                  <col className="w-[13%]" />
                </colgroup>
                <thead className="border-b border-mist-100 bg-mist-50/70 text-xs font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Group</th>
                    <th scope="col" className="px-4 py-2.5">Visibility</th>
                    <th scope="col" className="px-4 py-2.5">Members</th>
                    <th scope="col" className="px-4 py-2.5">Owner</th>
                    <th scope="col" className="px-4 py-2.5">State</th>
                    <th scope="col" className="px-4 py-2.5">Created</th>
                    <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mist-100">
                  {groups.map((group) => (
                    <tr key={group.id} className={`align-middle transition hover:bg-mist-50/60 ${editing?.id === group.id ? 'bg-ocean-50/40' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex min-w-0 items-center gap-3">
                          <GroupIconTile icon={group.icon} iconUrl={group.iconUrl} size="sm" />
                          <div className="min-w-0">
                            <Link href={groupHref(group.slug)} className="block truncate font-semibold text-navy-950 hover:text-ocean-700 hover:underline" title={group.name}>{group.name}</Link>
                            <p className="truncate text-xs text-muted">/{group.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-navy-900">{group.visibility === 'private' ? 'Private' : 'Public'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-navy-900">
                        {group.memberCount}
                        {group.pendingCount ? <span className="ml-1 text-xs text-amber-800" title="Join requests waiting">+{group.pendingCount}</span> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        {group.owner
                          ? <Link href={`/admin/users/${group.owner.id}`} className="block truncate font-medium text-navy-900 hover:text-ocean-700 hover:underline">{group.owner.fullName}</Link>
                          : <span className="text-muted">No owner</span>}
                      </td>
                      <td className="px-4 py-2.5">{group.archivedAt ? <AdminChip tone="danger">Archived</AdminChip> : <AdminChip tone="success">Live</AdminChip>}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatAdminDate(group.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Link href={`/admin/communities?edit=${group.id}#edit-group`} className={actionClass}><PencilLine aria-hidden="true" className="size-3.5" /> Edit</Link>
                          <ArchiveForm group={group} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </AdminPanel>

      {editing ? (
        <section id="edit-group" aria-labelledby="edit-group-heading" className="scroll-mt-24 space-y-4 rounded-xl border border-mist-100 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="edit-group-heading" className="text-lg font-bold text-navy-950">Edit {editing.name}</h3>
            <div className="flex flex-wrap gap-1">
              <Link href={groupHref(editing.slug)} className={actionClass}><ExternalLink aria-hidden="true" className="size-3.5" /> View group</Link>
              <ArchiveForm group={editing} />
              <Link href={href({})} className={actionClass}>Close</Link>
            </div>
          </div>
          <AdminGroupForm group={editing} />
          <div className="border-t border-mist-100 pt-4">
            <h4 className="mb-2 text-sm font-bold text-navy-950">Owner</h4>
            <AdminGroupOwnerForm group={editing} />
          </div>
        </section>
      ) : editId ? (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">That group is not in this view. Clear the search or filter to find it.</p>
      ) : null}

      <section id="create-group" aria-labelledby="create-group-heading" className="scroll-mt-24 space-y-4 rounded-xl border border-mist-100 bg-white p-4 sm:p-5">
        <div>
          <h3 id="create-group-heading" className="text-lg font-bold text-navy-950">Create group</h3>
          <p className="mt-1 text-sm text-muted">The owner is added as an active member at once; they can then appoint moderators from the group’s Members tab.</p>
        </div>
        <AdminGroupForm />
      </section>
    </main>
  )
}
