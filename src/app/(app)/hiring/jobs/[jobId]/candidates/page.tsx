import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { UserRoundSearch } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { applicantPhotoUrl } from '@/features/jobs/applicant-media'
import { ApplicantAvatar } from '@/features/jobs/components/applicant-avatar'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { hiringRepository } from '@/features/jobs/hiring-repository'
import { jobMatchDisplay } from '@/features/jobs/match-display'
import { jobsRepository } from '@/features/jobs/repository'
import { ConnectionPrimaryAction } from '@/features/network/components/connection-primary-action'
import { jobCandidateSuggestions } from '@/features/ranking/job-candidates'
import { isRankingEnabled } from '@/features/ranking/switches'

export const metadata: Metadata = { title: 'Suggested candidates' }

/**
 * Round G (G3): members who chose "Let recruiters find me as open to work", best match first.
 * Behind the jobs ranking switch; live jobs only. Contact goes through Connect / Message.
 */
export default async function SuggestedCandidatesPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const user = await requireAwsUser()
  if (!await isRankingEnabled('jobs', user.id).catch(() => false)) notFound()
  const managed = (await hiringRepository.listManagedJobs(user.id)).find((item) => item.id === jobId)
  if (!managed) notFound()
  const job = await jobsRepository.getPublishedJob(jobId)
  const candidates = job ? await jobCandidateSuggestions.list(user.id, job) : []
  const photos = new Map(await Promise.all(candidates.map(async (candidate) => [candidate.id, await applicantPhotoUrl(candidate.avatarPath)] as const)))

  return (
    <div className="mx-auto w-full max-w-page-wide space-y-6 pb-4 pt-0 max-md:space-y-4 md:px-6 md:py-8 lg:px-8">
      <MobilePageBar backHref={`/hiring/jobs/${jobId}/applicants`} title="Suggested candidates" />
      <div className="max-md:hidden">
        <Link href={`/hiring/jobs/${jobId}/applicants`} className="text-sm font-semibold text-ocean-700 hover:underline">Back to applicants</Link>
        <h1 className="mt-3 break-words text-2xl font-bold text-navy-950 sm:text-3xl">Suggested candidates · {managed.title}</h1>
      </div>
      <p className="max-w-3xl text-sm leading-6 text-muted">
        Members who chose to let recruiters find them as open to work, best match first. Only eligible members are listed. Reach them by connecting or, once connected, by message.
      </p>
      <HiringSubnav active="jobs" />

      {!job ? (
        <p className="rounded-2xl border border-dashed border-mist-200 bg-white p-6 text-center text-sm text-muted">Suggested candidates are shown for live jobs only.</p>
      ) : candidates.length ? (
        <ul aria-label="Suggested candidates" className="space-y-3">
          {candidates.map((candidate) => {
            const display = jobMatchDisplay(candidate.match)
            return (
              <li key={candidate.id} className="flex gap-4 rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:flex-col max-md:rounded-2xl max-md:p-4 max-md:shadow-none">
                <div className="flex min-w-0 flex-1 gap-4">
                  <ApplicantAvatar name={candidate.fullName} photoUrl={photos.get(candidate.id) ?? null} />
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-lg font-bold text-navy-950">
                      {candidate.slug ? <Link href={`/people/${candidate.slug}`} className="hover:text-ocean-700 hover:underline">{candidate.fullName}</Link> : candidate.fullName}
                    </h2>
                    {candidate.headline ? <p className="mt-0.5 text-sm text-muted">{candidate.headline}</p> : null}
                    {display ? <p className="mt-1 text-sm font-semibold text-ocean-800">{display.label}</p> : null}
                    {candidate.match.reasons.length ? (
                      <ul aria-label={`Why ${candidate.fullName} matches`} className="mt-2 flex flex-wrap gap-2">
                        {candidate.match.reasons.slice(0, 3).map((reason) => <li key={reason} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900">{reason}</li>)}
                      </ul>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 self-center max-md:self-stretch">
                  <ConnectionPrimaryAction profileId={candidate.id} initialRelationship={candidate.relationship} variant="pill" fullName={candidate.fullName} />
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <section className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center">
          <UserRoundSearch aria-hidden="true" className="mx-auto size-6 text-muted" />
          <h2 className="mt-3 text-lg font-bold text-navy-950">No suggested candidates yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">Nobody who is open to work and eligible for this job has turned on recruiter visibility yet. New members appear here as they opt in.</p>
        </section>
      )}
    </div>
  )
}
