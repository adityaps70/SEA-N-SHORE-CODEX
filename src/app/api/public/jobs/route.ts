import { NextResponse } from 'next/server'
import { jobsRepository } from '@/features/jobs/repository'
import { mapPublicJobsFeed } from '@/features/jobs/public-feed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public, read-only maritime vacancies for trusted publishing partners.
 * Do NOT include profile, recruiter contact or applicant data here.
 * The repository already enforces publication, deletion and plan visibility.
 */
export async function GET() {
  try {
    const published = await jobsRepository.listPublishedJobs(80)
    return NextResponse.json(
      { jobs: mapPublicJobsFeed(published) },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=900, stale-while-revalidate=120' } },
    )
  } catch (error) {
    console.error('[public_jobs_feed_unavailable]', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json(
      { error: 'temporarily_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
