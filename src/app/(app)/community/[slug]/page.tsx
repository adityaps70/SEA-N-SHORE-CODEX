import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Globe, Lock, Search, ShieldCheck } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { EditGroupForm } from '@/features/community/components/edit-group-form'
import { GroupCover, GroupIconTile } from '@/features/community/components/group-icon-tile'
import { GroupMembersList } from '@/features/community/components/group-members-list'
import { GroupMembershipButton } from '@/features/community/components/group-membership-button'
import { GroupPageMenu } from '@/features/community/components/group-page-menu'
import { JoinRequestsPanel } from '@/features/community/components/join-requests-panel'
import { communityRepository } from '@/features/community/repository'
import {
  GROUP_PAGE_TABS,
  groupHref,
  groupTabHref,
  parseGroupPageTab,
  viewerAdministersGroup,
  viewerCanSeeGroupContent,
  viewerIsActiveMember,
  type GroupMember,
} from '@/features/community/types'
import { FeedList } from '@/features/feed/components/feed-list'
import { PostComposer } from '@/features/feed/components/post-composer'
import { getFeedPage } from '@/features/feed/queries'
import { OrganizationPageTabs } from '@/features/organizations/components/organization-page-tabs'
import { PageSection } from '@/features/organizations/components/organization-page-content'
import { getOwnProfile } from '@/features/profiles/queries'
import { createMediaReadUrl } from '@/lib/aws/storage'
import { pluralize } from '@/lib/format'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const user = await requireAwsUser().catch(() => null)
  const group = user ? await communityRepository.getBySlug(user.id, slug).catch(() => null) : null
  if (!group || group.archived) return { title: 'Group' }
  return { title: group.name, description: group.description || undefined }
}

type SearchParams = Promise<{ tab?: string | string[]; q?: string | string[]; requests?: string | string[]; edit?: string | string[] }>

function single(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

async function withAvatars(members: GroupMember[]) {
  return Promise.all(members.map(async (member) => ({
    ...member,
    avatarUrl: member.avatarPath ? await createMediaReadUrl(member.avatarPath).catch(() => null) : null,
  })))
}

function JoinToSee({ what, group }: { what: string; group: { name: string; id: string; visibility: 'public' | 'private'; viewerMembership: { status: 'active' | 'pending' | 'removed'; role: 'member' | 'admin' | 'owner' } | null } }) {
  return (
    <div className="rounded-xl border border-dashed border-mist-200 bg-mist-50/60 px-4 py-8 text-center">
      <Lock aria-hidden="true" className="mx-auto size-6 text-muted" />
      <p className="mt-2 font-semibold text-navy-950">Join to see {what}</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted">
        {group.name} is a private group. Its {what} are visible to members once a group admin approves your request.
      </p>
      <div className="mx-auto mt-4 flex max-w-xs justify-center">
        <GroupMembershipButton groupId={group.id} groupName={group.name} visibility={group.visibility} initialStatus={group.viewerMembership?.status ?? null} role={group.viewerMembership?.role ?? null} appearance="page" />
      </div>
    </div>
  )
}

export default async function CommunityGroupPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: SearchParams }) {
  const { slug } = await params
  const search = (await searchParams) ?? {}
  const user = await requireAwsUser()
  const group = await communityRepository.getBySlug(user.id, slug)
  if (!group || group.archived) notFound()

  const isMember = viewerIsActiveMember(group)
  const isAdmin = viewerAdministersGroup(group)
  const canSee = viewerCanSeeGroupContent(group)
  const requestsRequested = single(search.requests) === '1'
  const tab = requestsRequested ? 'members' : parseGroupPageTab(search.tab, isMember ? 'posts' : 'about')
  const editing = isAdmin && single(search.edit) === '1'
  const memberQuery = single(search.q).trim().slice(0, 100)
  const pagePath = groupHref(group.slug)

  const [admins, profile, feedPage, members, requests] = await Promise.all([
    tab === 'about' ? communityRepository.listMembers(group.id, { adminsOnly: true, limit: 20 }).then(withAvatars).catch((): GroupMember[] => []) : [],
    tab === 'posts' && isMember ? getOwnProfile() : null,
    tab === 'posts' && canSee ? getFeedPage({ groupId: group.id }) : null,
    tab === 'members' && canSee ? communityRepository.listMembers(group.id, { search: memberQuery }).then(withAvatars) : [],
    tab === 'members' && isAdmin && group.visibility === 'private' ? communityRepository.listPendingRequests(group.id).then(withAvatars) : [],
  ])

  const tabs = GROUP_PAGE_TABS.map((entry) => ({ ...entry, href: groupTabHref(group.slug, entry.id) }))
  const visibilityLabel = group.visibility === 'private' ? 'Private group' : 'Public group'
  const VisibilityIcon = group.visibility === 'private' ? Lock : Globe

  return (
    <div className="mx-auto w-full max-w-4xl py-2 sm:py-4 max-md:py-0">
      <MobilePageBar backHref="/community" title={group.name} className="max-md:mb-0" />
      <div className="space-y-4 max-md:space-y-2">
        <section aria-labelledby="group-name" className="rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:shadow-none">
          <GroupCover coverUrl={group.coverUrl} name={group.name} className="h-32 rounded-t-2xl sm:h-44 max-md:h-28 max-md:rounded-none" />
          <div className="px-4 sm:px-6">
            <GroupIconTile icon={group.icon} size="xl" className="relative -mt-10 sm:-mt-12" />
            <div className="mt-3 min-w-0">
              <h1 id="group-name" className="break-words text-2xl font-bold tracking-tight text-navy-950 sm:text-[1.75rem] max-md:text-[22px] max-md:leading-7">{group.name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
                <VisibilityIcon aria-hidden="true" className="size-3.5" />
                <span>{visibilityLabel}</span>
                <span aria-hidden="true">·</span>
                <Link href={groupTabHref(group.slug, 'members')} scroll={false} className="font-semibold text-ocean-700 hover:underline">{pluralize(group.memberCount, 'member')}</Link>
                {group.viewerMembership?.status === 'pending' ? <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">Request pending</span> : null}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap items-start gap-2 max-md:flex-nowrap max-md:items-center">
              <GroupMembershipButton
                groupId={group.id}
                groupName={group.name}
                visibility={group.visibility}
                initialStatus={group.viewerMembership?.status ?? null}
                role={group.viewerMembership?.role ?? null}
                appearance="page"
              />
              <GroupPageMenu groupId={group.id} groupName={group.name} pagePath={pagePath} editHref={isAdmin ? `${groupTabHref(group.slug, 'about')}&edit=1` : null} />
            </div>
            <div className="mt-4 border-t border-mist-100 max-md:-mx-4 max-md:mt-3 max-md:px-1">
              <OrganizationPageTabs tabs={tabs} active={tab} label={`${group.name} sections`} />
            </div>
          </div>
        </section>

        {tab === 'about' ? (
          <>
            {editing ? (
              <PageSection id="edit-group-heading" title="Edit group">
                <EditGroupForm group={group} doneHref={groupTabHref(group.slug, 'about')} />
              </PageSection>
            ) : null}
            <PageSection id="about-heading" title="About">
              {group.description
                ? <p className="whitespace-pre-line text-sm leading-7 text-ink">{group.description}</p>
                : <p className="text-sm text-muted">The admins have not added a description yet.</p>}
            </PageSection>
            <PageSection id="rules-heading" title="Rules">
              {group.rules
                ? <p className="whitespace-pre-line text-sm leading-7 text-ink">{group.rules}</p>
                : <p className="text-sm text-muted">Keep it professional and useful. The admins have not written specific rules yet.</p>}
            </PageSection>
            <PageSection id="admins-heading" title="Admins">
              {admins.length ? (
                <GroupMembersList groupId={group.id} members={admins} viewerId={user.id} canManage={false} />
              ) : <p className="text-sm text-muted">This group has no active admins yet.</p>}
            </PageSection>
          </>
        ) : null}

        {tab === 'posts' ? (
          !canSee ? (
            <PageSection id="posts-heading" title="Posts"><JoinToSee what="posts" group={group} /></PageSection>
          ) : (
            <div className="space-y-4 max-md:space-y-2">
              {isMember && profile ? (
                <PostComposer profile={profile} group={{ id: group.id, name: group.name }} />
              ) : !isMember ? (
                <div className="rounded-2xl border border-mist-100 bg-white px-4 py-3 text-sm text-muted shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-none">
                  <ShieldCheck aria-hidden="true" className="mr-1.5 inline size-4 text-ocean-700" />
                  Join {group.name} to post here. Members see group posts in their Home feed too.
                </div>
              ) : null}
              {feedPage && feedPage.posts.length ? (
                <FeedList key={`group:${group.id}:${feedPage.posts.map((post) => `${post.id}:${post.updatedAt}`).join('|')}`} initialPage={feedPage} scope={{ groupId: group.id }} />
              ) : (
                <div className="rounded-2xl border border-dashed border-mist-200 bg-white px-5 py-10 text-center shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-none">
                  <p className="font-semibold text-navy-950">No posts in {group.name} yet</p>
                  <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted">{isMember ? 'Start the first discussion: a question, a lesson from the fleet or something the group should know.' : 'Join the group to start the first discussion.'}</p>
                </div>
              )}
            </div>
          )
        ) : null}

        {tab === 'members' ? (
          !canSee ? (
            <PageSection id="members-heading" title="Members"><JoinToSee what="members" group={group} /></PageSection>
          ) : (
            <>
              {isAdmin && group.visibility === 'private' ? (
                <PageSection id="join-requests-heading" title={requests.length ? `Join requests (${requests.length})` : 'Join requests'} className={requestsRequested ? 'ring-2 ring-ocean-200' : ''}>
                  <JoinRequestsPanel groupId={group.id} requests={requests} />
                </PageSection>
              ) : null}
              <PageSection
                id="members-heading"
                title={`Members (${group.memberCount})`}
                action={(
                  <form action={pagePath} method="get" role="search" className="relative">
                    <input type="hidden" name="tab" value="members" />
                    <label htmlFor="member-search" className="sr-only">Search members</label>
                    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                    <input id="member-search" name="q" type="search" defaultValue={memberQuery} maxLength={100} placeholder="Search members" className="min-h-9 w-56 max-w-full rounded-lg border border-mist-200 bg-white pl-9 pr-3 text-sm text-ink outline-none focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100" />
                  </form>
                )}
              >
                {members.length
                  ? <GroupMembersList groupId={group.id} members={members} viewerId={user.id} canManage={isAdmin} />
                  : <p className="text-sm text-muted">{memberQuery ? `No members match “${memberQuery}”.` : 'No members yet.'}</p>}
              </PageSection>
            </>
          )
        ) : null}
      </div>
    </div>
  )
}
