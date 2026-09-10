import { notFound } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { HiringJobForm } from '@/features/jobs/components/hiring-job-form'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { hiringRepository } from '@/features/jobs/hiring-repository'

export default async function EditHiringJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const user = await requireAwsUser()
  const company = await hiringRepository.getAuthorizedCompany(user.id)
  if (!company) notFound()

  const job = await hiringRepository.getEditableJob(user.id, company.id, jobId)
  if (!job) notFound()

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">{company.name}</p>
        <h1 className="mt-2 text-3xl font-bold text-navy-950">Edit vacancy</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Update the structured role requirements without changing the verified employer identity attached to this vacancy.</p>
      </div>
      <HiringSubnav active="jobs" />
      <HiringJobForm mode="edit" jobId={jobId} initial={job} />
    </main>
  )
}
