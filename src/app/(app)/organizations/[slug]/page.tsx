import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Building2, CircleDashed, ExternalLink, Settings2 } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { canPostAsOrganization, canUseCapability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { canUpgradeOrganization } from '@/features/billing/billing-access'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { EventCard } from '@/features/events/components/event-card'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { JobCard } from '@/features/jobs/components/job-card'
import { jobsRepository } from '@/features/jobs/repository'
import { marketplaceRepository } from '@/features/learning/marketplace-repository'
import { StartConversationButton } from '@/features/messaging/components/start-conversation-button'
import { accessRoleLabel } from '@/features/organizations/access-request-labels'
import { organizationAccessRequestRepository } from '@/features/organizations/access-request-repository'
import { LegacyRequestsHashRedirect } from '@/features/organizations/components/legacy-requests-hash-redirect'
import { StatusChip } from '@/features/organizations/components/organization-access-panel'
import { OrganizationSuggestionRow, VerifiedMark } from '@/features/organizations/components/organization-card'
import { OrganizationFollowButton } from '@/features/organizations/components/organization-follow-button'
import { OrganizationCover, OrganizationLogo } from '@/features/organizations/components/organization-logo'
import { OrganizationPageMenu, OrganizationPageMenuBarButton } from '@/features/organizations/components/organization-page-menu'
import { PhoneDisclosure } from '@/features/organizations/components/phone-disclosure'
import { OrganizationPageTabs } from '@/features/organizations/components/organization-page-tabs'
import {
  EmptyState,
  LoadError,
  OrganizationCourseCard,
  OrganizationPeopleList,
  PageSection,
  SeeAllLink,
  type OrganizationPersonView,
} from '@/features/organizations/components/organization-page-content'
import { OrganizationPostsSlot } from '@/features/organizations/components/organization-posts-slot'
import { RequestAccessForm } from '@/features/organizations/components/request-access-form'
import {
  ORGANIZATION_PAGE_TABS,
  companySizeLabel,
  followerLabel,
  formatCount,
  organizationCoverUrl,
  organizationManageHref,
  organizationPlanBillingHref,
  organizationTabHref,
  organizationTagline,
  parseOrganizationPageTab,
  websiteLabel,
} from '@/features/organizations/organization-page-profile'
import { isWellbeingType, organizationTypeHasField, wellbeingServiceLabel } from '@/features/organizations/organization-types'
import { organizationRepository } from '@/features/organizations/repository'
import { organizationWorkspaceRepository, type OrganizationWorkspace } from '@/features/organizations/workspace-repository'
import { createMediaReadUrl } from '@/lib/aws/storage'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const workspace = await organizationWorkspaceRepository.getBySlug(slug).catch(() => null)
  if (!workspace) return { title: 'Organization' }
  return { title: workspace.name, description: organizationTagline(workspace) ?? undefined }
}

type Settled<T> = { ok: true; value: T } | { ok: false }

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise }
  } catch {
    return { ok: false }
  }
}

/** Roles that manage the page (plain members see their workspace from the side card instead). */
const MANAGING_ROLES = new Set(['owner', 'administrator', 'recruiter', 'lms_manager', 'event_manager', 'content_manager', 'analyst'])

function SupportOffered({ workspace }: { workspace: OrganizationWorkspace }) {
  const details = workspace.details
  return (
    <PageSection id="support-heading" title="Support offered">
      <dl className="grid gap-4 sm:grid-cols-2">
        {details.servicesOffered?.length ? (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Services</dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">{details.servicesOffered.map((service) => <StatusChip key={service} tone="neutral">{wellbeingServiceLabel(service)}</StatusChip>)}</dd>
          </div>
        ) : null}
        {details.languages?.length ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Languages</dt>
            <dd className="mt-1 text-sm text-navy-950">{details.languages.join(', ')}</dd>
          </div>
        ) : null}
        {typeof details.helpline24x7 === 'boolean' ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">24/7 helpline</dt>
            <dd className="mt-1 text-sm text-navy-950">{details.helpline24x7 ? 'Yes, available around the clock' : 'No'}</dd>
          </div>
        ) : null}
        {details.accreditation ? (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Accreditation</dt>
            <dd className="mt-1 text-sm text-navy-950">{details.accreditation}</dd>
          </div>
        ) : null}
      </dl>
    </PageSection>
  )
}

function Operations({ workspace }: { workspace: OrganizationWorkspace }) {
  const details = workspace.details
  return (
    <PageSection id="operations-heading" title="Operations">
      {typeof details.fleetSize === 'number' ? <p className="text-sm text-navy-950"><span className="font-semibold">{details.fleetSize}</span> {details.fleetSize === 1 ? 'vessel' : 'vessels'}</p> : null}
      {workspace.fleetSummary ? <p className="mt-2 whitespace-pre-line text-sm leading-7 text-muted">{workspace.fleetSummary}</p> : null}
      {workspace.vesselTypes.length ? <div className="mt-3 flex flex-wrap gap-1.5">{workspace.vesselTypes.map((type) => <StatusChip key={type} tone="neutral">{type}</StatusChip>)}</div> : null}
    </PageSection>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-sm font-semibold text-navy-950">{label}</dt>
      <dd className="min-w-0 break-words text-sm leading-6 text-ink">{children}</dd>
    </div>
  )
}

export default async function OrganizationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ tab?: string | string[] }>
}) {
  const { slug } = await params
  const tab = parseOrganizationPageTab((await searchParams)?.tab)
  const user = await requireAwsUser()
  const workspace = await organizationWorkspaceRepository.getBySlug(slug)
  if (!workspace) notFound()

  const [access, followState, viewer, myRequests, applicationState] = await Promise.all([
    getAccessContext(user.id),
    organizationWorkspaceRepository.getFollowState(workspace.id, user.id),
    organizationAccessRequestRepository.getViewer(user.id, workspace.id),
    organizationRepository.listUserAccessRequests(user.id),
    organizationRepository.getUserOrganizationState(user.id),
  ])
  const wantsJobs = tab === 'home' || tab === 'jobs'
  const wantsEvents = tab === 'home' || tab === 'events'
  const wantsCourses = tab === 'home' || tab === 'courses'
  const previewLimit = 2
  const [peopleCount, similar, contactProfileId, jobs, events, courses, people] = await Promise.all([
    settle(organizationWorkspaceRepository.countPeople(workspace.id)),
    settle(organizationWorkspaceRepository.listSimilarOrganizations(workspace, user.id, 4)),
    organizationWorkspaceRepository.getContactProfileId(workspace.id).catch(() => null),
    wantsJobs ? settle(jobsRepository.listPublishedJobsForCompany(workspace.id, tab === 'home' ? previewLimit : 30)) : null,
    wantsEvents ? settle(calendarEventRepository.listOrganizationEvents(user.id, workspace.id, tab === 'home' ? previewLimit : 30)) : null,
    wantsCourses ? settle(marketplaceRepository.listPublishedCoursesForCompany(workspace.id, tab === 'home' ? previewLimit : 30)) : null,
    tab === 'people' ? settle(organizationWorkspaceRepository.listPeople(workspace.id, user.id)) : null,
  ])

  const jobIds = jobs?.ok ? jobs.value.map((job) => job.id) : []
  const [savedJobIds, appliedJobIds, peopleWithPhotos] = await Promise.all([
    jobIds.length ? jobsRepository.getSavedJobIds(user.id, jobIds).catch((): string[] => []) : [] as string[],
    jobIds.length ? jobsRepository.getAppliedJobIds(user.id, jobIds).catch((): string[] => []) : [] as string[],
    people?.ok
      ? Promise.all(people.value.map(async (person): Promise<OrganizationPersonView> => ({
          ...person,
          avatarUrl: person.avatarPath ? await createMediaReadUrl(person.avatarPath).catch(() => null) : null,
        })))
      : [],
  ])

  // The owner of an organization that is still being verified has no approved membership yet.
  const ownApplication = applicationState.kind === 'application' && applicationState.company.id === workspace.id && applicationState.status !== 'approved'
    ? applicationState
    : null
  const membership = access.organizationMemberships.find((entry) => entry.companyId === workspace.id)
  const myPendingRequest = myRequests.find((request) => request.company.id === workspace.id && request.status === 'pending')
  const canManagePage = Boolean(viewer) || Boolean(ownApplication) || Boolean(membership && MANAGING_ROLES.has(membership.role))
  const canPost = canPostAsOrganization(access, workspace.id)
  // Owner or administrator of this verified organization on the free plan.
  const canUpgrade = canUpgradeOrganization(access, workspace.id)
  const canPublish = {
    jobs: canUseCapability(access, 'job.publish', { companyId: workspace.id }),
    events: canUseCapability(access, 'event.publish', { companyId: workspace.id }),
    courses: canUseCapability(access, 'course.publish', { companyId: workspace.id }),
  }
  const unclaimed = workspace.unclaimed === true
  const claimHref = `/organizations/${workspace.slug}/claim`
  const joinLink = membership || ownApplication
    ? null
    : unclaimed
      ? { href: claimHref, label: 'Claim this page' }
      : myPendingRequest
      ? { href: '/organizations#your-requests', label: 'See your request' }
      : { href: '#work-here', label: 'Request to join' }

  const details = workspace.details
  const wellbeing = isWellbeingType(workspace.organizationType)
  const showFleet = organizationTypeHasField(workspace.organizationType, 'fleetSummary') || organizationTypeHasField(workspace.organizationType, 'vesselTypes')
  const hasOperations = Boolean((showFleet && (workspace.fleetSummary || workspace.vesselTypes.length)) || typeof details.fleetSize === 'number')
  const hasSupport = Boolean(wellbeing && (details.servicesOffered?.length || details.languages?.length || typeof details.helpline24x7 === 'boolean' || details.accreditation))
  const tagline = organizationTagline(workspace)
  const headquarters = workspace.officeLocations[0] ?? null
  const size = companySizeLabel(workspace.companySize)
  const typeLabel = workspace.companyType ?? 'Organization'
  const metaParts = [typeLabel, headquarters, followerLabel(followState.followerCount), size].filter((part): part is string => Boolean(part))
  const tabs = ORGANIZATION_PAGE_TABS.map((entry) => ({ ...entry, href: organizationTabHref(workspace.slug, entry.id) }))
  const tabHref = (target: (typeof ORGANIZATION_PAGE_TABS)[number]['id']) => organizationTabHref(workspace.slug, target)

  const aboutFacts = (
    <dl className="space-y-3">
      {workspace.website ? (
        <Fact label="Website">
          <a href={workspace.website} target="_blank" rel="noreferrer" className="font-semibold text-ocean-700 hover:underline">{websiteLabel(workspace.website)}</a>
        </Fact>
      ) : null}
      <Fact label="Industry">{typeLabel}</Fact>
      {size ? <Fact label="Company size">{size}</Fact> : null}
      {headquarters ? <Fact label="Headquarters">{headquarters}</Fact> : null}
      {workspace.officeLocations.length > 1 ? <Fact label="Locations">{workspace.officeLocations.join(' · ')}</Fact> : null}
      {workspace.specialties.length ? <Fact label="Specialities">{workspace.specialties.join(', ')}</Fact> : null}
      <Fact label="Verification">
        {workspace.verified
          ? <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800"><VerifiedMark /> Verified by Sea N Shore</span>
          : unclaimed
            ? 'Unclaimed. Someone who works here added this page; nobody manages it yet.'
            : 'Not verified yet. Sea N Shore has not confirmed this organization.'}
      </Fact>
    </dl>
  )

  function jobsGrid(limit?: number) {
    if (!jobs) return null
    if (!jobs.ok) return <LoadError what="Jobs" />
    const list = limit ? jobs.value.slice(0, limit) : jobs.value
    return (
      <ul className="grid gap-4 md:grid-cols-2">
        {list.map((job) => (
          <li key={job.id} className="min-w-0">
            <JobCard job={job} isSaved={savedJobIds.includes(job.id)} alreadyApplied={appliedJobIds.includes(job.id)} />
          </li>
        ))}
      </ul>
    )
  }

  function eventsGrid() {
    if (!events) return null
    if (!events.ok) return <LoadError what="Events" />
    return (
      <ul className="grid gap-4 md:grid-cols-2 max-md:-my-3 max-md:gap-0 max-md:divide-y max-md:divide-mist-100">
        {events.value.map((event) => <li key={event.id} className="min-w-0"><EventCard event={event} /></li>)}
      </ul>
    )
  }

  function coursesGrid() {
    if (!courses) return null
    if (!courses.ok) return <LoadError what="Courses" />
    return (
      <ul className="grid gap-4 md:grid-cols-2">
        {courses.value.map((course) => <li key={course.id} className="min-w-0"><OrganizationCourseCard course={course} /></li>)}
      </ul>
    )
  }

  const manageLinkClass = 'inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 transition hover:border-ocean-300 hover:bg-ocean-50'
  // Phones: header buttons are pills that share the row (Follow + Message, or Manage page + Follow).
  const phonePrimaryClass = 'max-md:min-h-11 max-md:flex-1 max-md:justify-center max-md:rounded-full max-md:border-ocean-700 max-md:bg-ocean-700 max-md:text-[15px] max-md:text-white max-md:hover:bg-ocean-800'
  const phoneOutlineClass = 'max-md:min-h-11 max-md:flex-1 max-md:justify-center max-md:rounded-full max-md:border-ocean-700 max-md:text-[15px] max-md:text-ocean-700'
  const upgradeHref = canUpgrade ? organizationPlanBillingHref(workspace.slug) : null
  const showMessage = Boolean(contactProfileId && contactProfileId !== user.id)

  return (
    <div className="mx-auto w-full max-w-6xl py-2 sm:py-4 max-md:py-0">
      <MobilePageBar
        backHref="/organizations"
        className="max-md:mb-0"
        right={<OrganizationPageMenuBarButton organizationName={workspace.name} />}
      />
      {viewer ? <LegacyRequestsHashRedirect href={organizationManageHref(workspace.slug, 'requests') + '#requests'} /> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start max-md:gap-2">
        <div className="min-w-0 space-y-4 max-md:space-y-2">
          <section aria-labelledby="organization-name" className="rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:shadow-none">
            <OrganizationCover coverUrl={organizationCoverUrl(workspace)} name={workspace.name} className="h-32 rounded-t-2xl sm:h-48 max-md:h-28 max-md:rounded-none" />
            <div className="px-4 sm:px-6">
              <OrganizationLogo company={workspace} size="xl" className="relative -mt-10 sm:-mt-14" />
              <div className="mt-3 min-w-0">
                <h1 id="organization-name" className="flex flex-wrap items-center gap-x-2 gap-y-1 break-words text-2xl font-bold tracking-tight text-navy-950 sm:text-[1.75rem] max-md:text-[22px] max-md:leading-7">
                  {workspace.name}
                  {workspace.verified ? <VerifiedMark className="size-6" /> : null}
                </h1>
                {tagline ? <p className="mt-1 max-w-3xl text-base leading-6 text-ink max-md:text-[15px] max-md:leading-5">{tagline}</p> : null}
                <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted max-md:mt-1 max-md:text-[13px]">
                  {metaParts.map((part, index) => (
                    // The separator trails its item so a wrapped line never starts with "·".
                    <span key={`${part}-${index}`} className="whitespace-nowrap">
                      <span>{part}</span>
                      {index < metaParts.length - 1 ? <span aria-hidden="true"> ·</span> : null}
                    </span>
                  ))}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {peopleCount.ok && peopleCount.value > 0 ? (
                    <Link href={tabHref('people')} scroll={false} className="text-sm font-semibold text-ocean-700 hover:underline">
                      {formatCount(peopleCount.value)} {peopleCount.value === 1 ? 'person works here' : 'people work here'}
                    </Link>
                  ) : null}
                  {workspace.verified ? null : unclaimed
                    ? <StatusChip tone="warning"><CircleDashed aria-hidden="true" className="mr-1 size-3.5" />Unclaimed</StatusChip>
                    : <StatusChip tone="warning">Not verified yet</StatusChip>}
                  {wellbeing && details.helpline24x7 ? <StatusChip tone="info">24/7 helpline</StatusChip> : null}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-start gap-2 max-md:flex-nowrap max-md:items-center">
                {/* Phones: Visit website is in the "…" sheet. */}
                {workspace.website ? (
                  <a
                    href={workspace.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white transition hover:bg-navy-900 max-md:hidden"
                  >
                    Visit website <ExternalLink aria-hidden="true" className="size-4" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : null}
                <OrganizationFollowButton
                  companyId={workspace.id}
                  initialFollowing={followState.following}
                  initialFollowerCount={followState.followerCount}
                  appearance="page"
                  phoneTone={canManagePage ? 'outline' : 'primary'}
                />
                {showMessage && contactProfileId ? (
                  // Phones: Message sits beside Follow for visitors; managers reach the team from Manage page.
                  <div className={`w-auto max-md:min-w-0 max-md:flex-1 ${canManagePage ? 'max-md:hidden' : ''}`}>
                    <StartConversationButton
                      targetProfileId={contactProfileId}
                      className="max-md:min-h-11 max-md:rounded-full max-md:border max-md:border-ocean-700 max-md:bg-white max-md:text-[15px] max-md:text-ocean-700 max-md:hover:bg-ocean-50"
                    />
                  </div>
                ) : null}
                {/* Phones: people who manage the page get Manage page first, then Follow. */}
                {canManagePage ? (
                  <Link href={organizationManageHref(workspace.slug)} className={`${manageLinkClass} gap-2 max-md:order-first ${phonePrimaryClass}`}>
                    <Settings2 aria-hidden="true" className="size-4" /> Manage page
                  </Link>
                ) : null}
                {unclaimed && !ownApplication && !membership ? (
                  <Link href={claimHref} className={`${manageLinkClass} gap-2 ${phoneOutlineClass}`}>
                    Claim this page
                  </Link>
                ) : null}
                {/* Phones: Upgrade to Organization Pro is in the "…" sheet. */}
                {canUpgrade ? (
                  <Link href={organizationPlanBillingHref(workspace.slug)} className="inline-flex min-h-10 cursor-pointer items-center px-1 text-sm font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline max-md:hidden">
                    Upgrade to Organization Pro
                  </Link>
                ) : null}
                <OrganizationPageMenu
                  organizationName={workspace.name}
                  pagePath={`/organizations/${workspace.slug}`}
                  joinLink={joinLink}
                  websiteHref={workspace.website}
                  upgradeHref={upgradeHref}
                />
              </div>

              <div className="mt-4 border-t border-mist-100 max-md:-mx-4 max-md:mt-3 max-md:px-1">
                <OrganizationPageTabs tabs={tabs} active={tab} label={`${workspace.name} page sections`} />
              </div>
            </div>
          </section>

          {tab === 'home' ? (
            <>
              <PageSection id="home-about-heading" title="About" action={<SeeAllLink href={tabHref('about')}>See all details</SeeAllLink>}>
                {workspace.description
                  ? <p className="line-clamp-4 whitespace-pre-line text-sm leading-7 text-ink">{workspace.description}</p>
                  : <p className="text-sm text-muted">{workspace.name} has not added a description yet.</p>}
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <div><dt className="sr-only">Industry</dt><dd className="font-semibold text-navy-950">{typeLabel}</dd></div>
                  {size ? <div><dt className="sr-only">Company size</dt><dd className="text-muted">{size}</dd></div> : null}
                  {headquarters ? <div><dt className="sr-only">Headquarters</dt><dd className="text-muted">Headquarters: {headquarters}</dd></div> : null}
                </dl>
              </PageSection>

              {hasSupport ? <SupportOffered workspace={workspace} /> : null}

              <PageSection id="home-posts-heading" title="Posts" action={<SeeAllLink href={tabHref('posts')}>See all posts</SeeAllLink>}>
                <OrganizationPostsSlot companyId={workspace.id} companySlug={workspace.slug} canPost={canPost} limit={3} />
              </PageSection>

              {jobs && (!jobs.ok || jobs.value.length) ? (
                <PageSection id="home-jobs-heading" title="Open jobs" action={<SeeAllLink href={tabHref('jobs')}>See all jobs</SeeAllLink>}>
                  {jobsGrid(previewLimit)}
                </PageSection>
              ) : null}

              {events && (!events.ok || events.value.length) ? (
                <PageSection id="home-events-heading" title="Upcoming events" action={<SeeAllLink href={tabHref('events')}>See all events</SeeAllLink>}>
                  {eventsGrid()}
                </PageSection>
              ) : null}

              {courses && (!courses.ok || courses.value.length) ? (
                <PageSection id="home-courses-heading" title="Courses" action={<SeeAllLink href={tabHref('courses')}>See all courses</SeeAllLink>}>
                  {coursesGrid()}
                </PageSection>
              ) : null}
            </>
          ) : null}

          {tab === 'about' ? (
            <>
              <PageSection id="about-heading" title="Overview">
                {workspace.description
                  ? <p className="mb-5 max-w-3xl whitespace-pre-line text-sm leading-7 text-ink">{workspace.description}</p>
                  : <p className="mb-5 text-sm text-muted">{workspace.name} has not added a description yet.</p>}
                {aboutFacts}
              </PageSection>
              {hasSupport ? <SupportOffered workspace={workspace} /> : null}
              {hasOperations ? <Operations workspace={workspace} /> : null}
            </>
          ) : null}

          {tab === 'posts' ? (
            <PageSection id="posts-heading" title="Posts">
              <OrganizationPostsSlot companyId={workspace.id} companySlug={workspace.slug} canPost={canPost} />
            </PageSection>
          ) : null}

          {tab === 'jobs' && jobs ? (
            <PageSection id="jobs-heading" title={jobs.ok && jobs.value.length ? `Open jobs (${jobs.value.length})` : 'Open jobs'}>
              {jobs.ok && !jobs.value.length ? (
                <EmptyState action={canPublish.jobs ? <Link href="/hiring" className={manageLinkClass}>Post a job</Link> : null}>
                  {workspace.name} has no open jobs right now. Follow the page to hear when new roles are posted.
                </EmptyState>
              ) : jobsGrid()}
            </PageSection>
          ) : null}

          {tab === 'events' && events ? (
            <PageSection id="events-heading" title="Upcoming events">
              {events.ok && !events.value.length ? (
                <EmptyState action={canPublish.events ? <Link href="/events/hosting" className={manageLinkClass}>Host an event</Link> : null}>
                  {workspace.name} has no upcoming events.
                </EmptyState>
              ) : eventsGrid()}
            </PageSection>
          ) : null}

          {tab === 'courses' && courses ? (
            <PageSection id="courses-heading" title="Courses">
              {courses.ok && !courses.value.length ? (
                <EmptyState action={canPublish.courses ? <Link href="/learn/studio" className={manageLinkClass}>Publish a course</Link> : null}>
                  {workspace.name} has not published any courses yet.
                </EmptyState>
              ) : coursesGrid()}
            </PageSection>
          ) : null}

          {tab === 'people' && people ? (
            <PageSection id="people-heading" title={peopleCount.ok && peopleCount.value ? `People (${formatCount(peopleCount.value)})` : 'People'}>
              {!people.ok ? <LoadError what="People" /> : peopleWithPhotos.length ? (
                <>
                  <p className="mb-3 text-sm text-muted">The team on Sea N Shore and members who list {workspace.name} as their current organization.</p>
                  <OrganizationPeopleList people={peopleWithPhotos} />
                </>
              ) : (
                <EmptyState>Nobody lists {workspace.name} as their organization yet.</EmptyState>
              )}
            </PageSection>
          ) : null}
        </div>

        <aside aria-label="Related" className="min-w-0 space-y-4 max-md:space-y-2">
          {membership ? (
            // Phones: hidden for people who manage the page (it repeats Manage page in the header).
            <section aria-labelledby="member-heading" className={`rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] ${canManagePage ? 'max-md:hidden' : 'max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-none'}`}>
              <h2 id="member-heading" className="font-bold text-navy-950">You are part of {workspace.name}</h2>
              <p className="mt-1 text-sm text-muted">
                {accessRoleLabel(membership.role)} · {membership.plan === 'organization_pro' ? 'Organization Pro' : 'Free plan'}
              </p>
              <Link href={organizationManageHref(workspace.slug)} className={`${manageLinkClass} mt-3 w-full justify-center`}>
                Open workspace tools
              </Link>
            </section>
          ) : ownApplication ? (
            <section aria-labelledby="verification-heading" className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sky-950 max-md:-mx-4 max-md:rounded-none max-md:border-x-0">
              <h2 id="verification-heading" className="font-bold">
                {ownApplication.status === 'pending' ? 'Sea N Shore is verifying this organization'
                  : ownApplication.status === 'suspended' ? 'This organization is suspended'
                    : 'Your organization application needs attention'}
              </h2>
              <p className="mt-1 text-sm leading-6">
                {ownApplication.status === 'pending'
                  ? 'Your workspace tools and the Requests section open once the organization is verified.'
                  : ownApplication.status === 'suspended'
                    ? 'Workspace tools are unavailable until Sea N Shore resolves the review.'
                    : 'Update the application from your Organizations page and resubmit it.'}
              </p>
              <Link href="/organizations#update-application" className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900">Go to your application</Link>
            </section>
          ) : unclaimed ? (
            // Phones: hidden; the header's Claim this page button (and the "…" sheet) do the same.
            <section id="work-here" aria-labelledby="claim-heading" className="scroll-mt-24 rounded-2xl border border-amber-100 bg-amber-50/60 p-4 max-md:hidden">
              <h2 id="claim-heading" className="font-bold text-navy-950">Nobody manages this page yet</h2>
              <p className="mt-1 text-sm leading-6 text-ink">
                Someone who works at {workspace.name} added it so colleagues can list it on their profiles. If you own or manage {workspace.name}, claim the page. Sea N Shore verifies every claim, and the page can post jobs, events, courses and updates once it is verified.
              </p>
              <Link href={claimHref} className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900">
                Claim this page
              </Link>
            </section>
          ) : (
            // Phones: one "Work here? Request access" row that opens the same request flow.
            <section id="work-here" aria-labelledby="join-heading" className="scroll-mt-24 rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:p-0 max-md:shadow-none">
              <PhoneDisclosure
                anchorId="work-here"
                summary={<><Building2 aria-hidden="true" /><span>Work here? <strong className="font-bold">{myPendingRequest ? 'See your request' : 'Request access'}</strong></span></>}
                panelClassName="max-md:px-4 max-md:pb-4"
              >
                <h2 id="join-heading" className="font-bold text-navy-950 max-md:sr-only">Work at {workspace.name}?</h2>
                <p className="mt-1 text-sm leading-6 text-muted max-md:mt-0">
                  Ask to join and choose the role you need. The organization&apos;s owner and administrators decide, and you can follow the status on your Organizations page.
                </p>
                <div className="mt-3">
                  <RequestAccessForm company={{ id: workspace.id, name: workspace.name }} initialState={myPendingRequest ? 'pending' : 'none'} />
                </div>
                {myPendingRequest ? (
                  <p className="mt-2 text-sm">
                    <Link href="/organizations#your-requests" className="font-semibold text-ocean-700 hover:underline">See your request</Link>
                  </p>
                ) : null}
              </PhoneDisclosure>
            </section>
          )}

          {similar.ok && similar.value.length ? (
            // Phones: hidden; Discover on /organizations lists the same suggestions.
            <section aria-labelledby="similar-heading" className="rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] max-md:hidden">
              <h2 id="similar-heading" className="mb-3 font-bold text-navy-950">Pages people also viewed</h2>
              <ul className="divide-y divide-mist-100">
                {similar.value.map((organization) => <OrganizationSuggestionRow key={organization.id} organization={organization} />)}
              </ul>
              <Link href="/organizations#discover" className="mt-3 inline-flex text-sm font-semibold text-ocean-700 hover:underline">Discover more organizations</Link>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
