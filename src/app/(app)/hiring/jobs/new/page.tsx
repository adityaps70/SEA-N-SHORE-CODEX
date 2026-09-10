import Link from 'next/link'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { HiringJobForm } from '@/features/jobs/components/hiring-job-form'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { hiringRepository } from '@/features/jobs/hiring-repository'

export default async function NewHiringJobPage() {
  const user = await requireAwsUser()
  const company = await hiringRepository.getAuthorizedCompany(user.id)

  if (!company) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-[2rem] border border-mist-100 bg-white p-8 text-center shadow-[var(--shadow-card)]">
          <h1 className="text-3xl font-bold text-navy-950">Hiring access required</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted">Only approved company owners, administrators and recruiters can post jobs.</p>
          <Link href="/jobs" className="mt-5 inline-flex rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white">Back to Jobs</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">{company.name}</p>
        <h1 className="mt-2 text-3xl font-bold text-navy-950">Post a maritime job</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Build a structured vacancy so Sea N Shore can surface the role to professionals whose rank, experience, vessel background and documents fit.</p>
      </div>
      <HiringSubnav active="jobs" />
      <HiringJobForm mode="create" companyId={company.id} />
    </main>
  )
}
