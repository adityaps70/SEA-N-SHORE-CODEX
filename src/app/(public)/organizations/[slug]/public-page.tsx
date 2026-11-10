import Link from 'next/link'
import { notFound } from 'next/navigation'
import { UserWebsiteLink } from '@/components/ui/user-website-link'
import { JobCard } from '@/features/jobs/components/job-card'
import { jobsRepository } from '@/features/jobs/repository'
import { marketplaceRepository } from '@/features/learning/marketplace-repository'
import { siteOrigin } from '@/features/learning/course-seo'
import { VerifiedMark } from '@/features/organizations/components/organization-card'
import { OrganizationCover, OrganizationLogo } from '@/features/organizations/components/organization-logo'
import { LoadError, OrganizationCourseCard, PageSection } from '@/features/organizations/components/organization-page-content'
import {
  companySizeLabel,
  followerLabel,
  formatCount,
  organizationCoverUrl,
  organizationTagline,
  websiteLabel,
} from '@/features/organizations/organization-page-profile'
import { organizationJsonLd, organizationPath } from '@/features/organizations/organization-seo'
import { isWellbeingType, organizationTypeHasField } from '@/features/organizations/organization-types'
import { organizationWorkspaceRepository } from '@/features/organizations/workspace-repository'
import { authHrefWithReturn } from '@/lib/auth/return-path'
import { jsonLd } from '@/lib/seo/meta'
import { Fact, Operations, SupportOffered } from './signed-in-page'

type Settled<T> = { ok: true; value: T } | { ok: false }

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise }
  } catch {
    return { ok: false }
  }
}

const LIST_LIMIT = 30

/**
 * Round ARCH (Phase 2): the organization page for signed-out visitors and search engines. It is cached at
 * CloudFront (src/lib/http/public-page-cache.ts), so it reads nothing about a viewer: no follow state, no
 * requests or memberships, no saved or applied jobs, no people's names, no contact person, no posts or events
 * and no viewer-ranked suggestions. Only claimed organizations that members may see listed are shown;
 * unclaimed (imported), pending, suspended and rejected organizations are not found (getPublicBySlug).
 */
export async function PublicOrganizationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const workspace = await organizationWorkspaceRepository.getPublicBySlug(slug)
  if (!workspace) notFound()

  const [peopleCount, followerCount, jobs, courses] = await Promise.all([
    settle(organizationWorkspaceRepository.countPeople(workspace.id)),
    settle(organizationWorkspaceRepository.countFollowers(workspace.id)),
    settle(jobsRepository.listPublishedJobsForCompany(workspace.id, LIST_LIMIT)),
    settle(marketplaceRepository.listPublishedCoursesForCompany(workspace.id, LIST_LIMIT)),
  ])

  const details = workspace.details
  const wellbeing = isWellbeingType(workspace.organizationType)
  const showFleet = organizationTypeHasField(workspace.organizationType, 'fleetSummary') || organizationTypeHasField(workspace.organizationType, 'vesselTypes')
  const hasOperations = Boolean((showFleet && (workspace.fleetSummary || workspace.vesselTypes.length)) || typeof details.fleetSize === 'number')
  const hasSupport = Boolean(wellbeing && (details.servicesOffered?.length || details.languages?.length || typeof details.helpline24x7 === 'boolean' || details.accreditation))
  const tagline = organizationTagline(workspace)
  const headquarters = workspace.officeLocations[0] ?? null
  const size = companySizeLabel(workspace.companySize)
  const typeLabel = workspace.companyType ?? 'Organization'
  const metaParts = [typeLabel, headquarters, followerCount.ok ? followerLabel(followerCount.value) : null, size]
    .filter((part): part is string => Boolean(part))
  const signInHref = authHrefWithReturn('/auth/sign-in', organizationPath(workspace.slug))
  const signUpHref = authHrefWithReturn('/auth/sign-up', organizationPath(workspace.slug))

  return (
    <div className="mx-auto w-full max-w-page-wide py-2 sm:py-4 max-md:py-0">
      {/* Round H (H5): schema.org Organization data (public page fields only). */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(organizationJsonLd(workspace, siteOrigin())) }} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start max-md:gap-2">
        <div className="min-w-0 space-y-4 max-md:space-y-2">
          <section aria-labelledby="organization-name" className="rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:shadow-none">
            <OrganizationCover coverUrl={organizationCoverUrl(workspace)} name={workspace.name} className="h-32 rounded-t-2xl sm:h-48 max-md:h-28 max-md:rounded-none" />
            <div className="px-4 pb-4 sm:px-6 sm:pb-6">
              <OrganizationLogo company={workspace} size="xl" className="relative -mt-10 sm:-mt-14" />
              <div className="mt-3 min-w-0">
                <h1 id="organization-name" className="flex flex-wrap items-center gap-x-2 gap-y-1 break-words text-2xl font-bold tracking-tight text-navy-950 sm:text-[1.75rem] max-md:text-[22px] max-md:leading-7">
                  {workspace.name}
                  {workspace.verified ? <VerifiedMark className="size-6" /> : null}
                </h1>
                {tagline ? <p className="mt-1 max-w-3xl text-base leading-6 text-ink max-md:text-[15px] max-md:leading-5">{tagline}</p> : null}
                <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted max-md:mt-1 max-md:text-[13px]">
                  {metaParts.map((part, index) => (
                    <span key={`${part}-${index}`} className="whitespace-nowrap">
                      <span>{part}</span>
                      {index < metaParts.length - 1 ? <span aria-hidden="true"> ·</span> : null}
                    </span>
                  ))}
                </p>
                {peopleCount.ok && peopleCount.value > 0 ? (
                  <p className="mt-2 text-sm font-semibold text-navy-950">
                    {formatCount(peopleCount.value)} {peopleCount.value === 1 ? 'person works here' : 'people work here'}
                  </p>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={signInHref} className="inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900">
                  Sign in to follow {workspace.name}
                </Link>
                <Link href={signUpHref} className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 hover:border-ocean-300 hover:bg-ocean-50">
                  Join Sea N Shore
                </Link>
              </div>
            </div>
          </section>

          <PageSection id="about-heading" title="About">
            {workspace.description
              ? <p className="mb-5 max-w-3xl whitespace-pre-line text-sm leading-7 text-ink">{workspace.description}</p>
              : <p className="mb-5 text-sm text-muted">{workspace.name} has not added a description yet.</p>}
            <dl className="space-y-3">
              {workspace.website ? (
                <Fact label="Website">
                  <UserWebsiteLink href={workspace.website} className="font-semibold text-ocean-700 hover:underline">{websiteLabel(workspace.website)}</UserWebsiteLink>
                </Fact>
              ) : null}
              <Fact label="Industry">{typeLabel}</Fact>
              {size ? <Fact label="Company size">{size}</Fact> : null}
              {headquarters ? <Fact label="Headquarters">{headquarters}</Fact> : null}
              {workspace.officeLocations.length > 1 ? <Fact label="Locations">{workspace.officeLocations.join(' · ')}</Fact> : null}
              {workspace.specialties.length ? <Fact label="Specialities">{workspace.specialties.join(', ')}</Fact> : null}
              {workspace.verified ? (
                <Fact label="Verification">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800"><VerifiedMark /> Verified by Sea N Shore</span>
                </Fact>
              ) : null}
            </dl>
          </PageSection>

          {hasSupport ? <SupportOffered workspace={workspace} /> : null}
          {hasOperations ? <Operations workspace={workspace} /> : null}

          {!jobs.ok || jobs.value.length ? (
            <PageSection id="jobs-heading" title={jobs.ok ? `Open jobs (${jobs.value.length})` : 'Open jobs'}>
              {!jobs.ok ? <LoadError what="Jobs" /> : (
                <ul className="grid gap-4 md:grid-cols-2">
                  {jobs.value.map((job) => <li key={job.id} className="min-w-0"><JobCard job={job} signedOut /></li>)}
                </ul>
              )}
            </PageSection>
          ) : null}

          {!courses.ok || courses.value.length ? (
            <PageSection id="courses-heading" title="Courses">
              {!courses.ok ? <LoadError what="Courses" /> : (
                <ul className="grid gap-4 md:grid-cols-2">
                  {courses.value.map((course) => <li key={course.id} className="min-w-0"><OrganizationCourseCard course={course} /></li>)}
                </ul>
              )}
            </PageSection>
          ) : null}
        </div>

        <aside aria-label="Join" className="min-w-0 space-y-4 max-md:space-y-2">
          <section aria-labelledby="join-heading" className="rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-none">
            <h2 id="join-heading" className="font-bold text-navy-950">See more on Sea N Shore</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Sign in to follow {workspace.name}, see its posts, events and people, and apply to its jobs.
            </p>
            <Link href={signInHref} className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900">
              Sign in
            </Link>
          </section>
        </aside>
      </div>
    </div>
  )
}
