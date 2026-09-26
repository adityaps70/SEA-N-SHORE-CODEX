import type { Metadata } from 'next'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getAccessContext } from '@/features/access/server'
import { HiringJobForm } from '@/features/jobs/components/hiring-job-form'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { hiringRepository } from '@/features/jobs/hiring-repository'
import { buildHiringPublisherOptions } from '@/features/jobs/publishers'

export const metadata: Metadata = { title: 'Post a job' }

export default async function NewHiringJobPage() {
  const user = await requireAwsUser()
  const [access, personal, companies] = await Promise.all([
    getAccessContext(user.id),
    hiringRepository.getPersonalPublisher(user.id),
    hiringRepository.listAuthorizedCompanies(user.id),
  ])

  if (!personal) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-[2rem] border border-mist-100 bg-white p-8 text-center shadow-[var(--shadow-card)]">
          <h1 className="text-3xl font-bold text-navy-950">Complete your profile first</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">
            Sea N Shore needs an active personal profile before a job can be published.
          </p>
        </section>
      </main>
    )
  }

  const publisherOptions = buildHiringPublisherOptions(access, personal, companies)

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Sea N Shore Hiring</p>
        <h1 className="mt-2 text-3xl font-bold text-navy-950">Post a maritime job</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Choose who is publishing, then build a structured vacancy for the right maritime professionals.
        </p>
      </div>
      <HiringSubnav active="jobs" />
      <HiringJobForm mode="create" publisherOptions={publisherOptions} />
    </main>
  )
}
