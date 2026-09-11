import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BadgeCheck, BriefcaseBusiness, Building2, ShieldCheck, UserRoundCheck } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { hiringRepository, type HiringRole } from '@/features/jobs/hiring-repository'

const ROLE_LABELS: Record<HiringRole, string> = {
  owner: 'Owner',
  administrator: 'Administrator',
  recruiter: 'Recruiter',
}

export default async function HiringCompanyPage() {
  const user = await requireAwsUser()
  const company = await hiringRepository.getAuthorizedCompany(user.id)
  if (!company) notFound()

  const publicJobsHref = `/jobs?q=${encodeURIComponent(company.name)}`

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Hiring trust centre</p>
          <h1 className="mt-2 text-3xl font-bold text-navy-950">{company.name}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Review the employer identity and hiring access Sea N Shore uses across structured maritime vacancies and candidate workflows.
          </p>
        </div>
        <Link
          href={publicJobsHref}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white transition hover:bg-navy-900"
        >
          <BriefcaseBusiness aria-hidden="true" className="size-4" />
          View public jobs
        </Link>
      </div>

      <HiringSubnav active="company" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-4">
              <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white">
                <Building2 aria-hidden="true" className="size-6" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Employer identity</p>
                <h2 className="mt-1 text-2xl font-bold text-navy-950">{company.name}</h2>
                <p className="mt-1 text-sm text-muted">Sea N Shore company workspace · /{company.slug}</p>
              </div>
            </div>

            <div className={company.verified ? 'inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800' : 'inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900'}>
              {company.verified ? <BadgeCheck aria-hidden="true" className="size-4" /> : <ShieldCheck aria-hidden="true" className="size-4" />}
              {company.verified ? 'Verified Maritime Employer' : 'Verification pending'}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-mist-100 bg-mist-50 p-4 sm:p-5">
            <div className="flex gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-700" />
              <div>
                <h3 className="font-bold text-navy-950">Platform-controlled trust signal</h3>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Verification is controlled by Sea N Shore. Company hiring members can see the current status here, but cannot award, remove or modify the verified badge themselves.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-mist-100 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Company status</p>
              <p className="mt-2 font-bold text-navy-950">{company.verified ? 'Verified' : 'Pending review'}</p>
            </div>
            <div className="rounded-2xl border border-mist-100 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Your hiring role</p>
              <p className="mt-2 font-bold text-navy-950">{ROLE_LABELS[company.role]}</p>
            </div>
            <div className="rounded-2xl border border-mist-100 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Public jobs</p>
              <p className="mt-2 font-bold text-navy-950">Company-linked discovery</p>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-teal-50 text-teal-700">
                <UserRoundCheck aria-hidden="true" className="size-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Hiring access</p>
                <h2 className="font-bold text-navy-950">{ROLE_LABELS[company.role]}</h2>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted">
              This workspace is available because your company membership is approved for hiring. Vacancy, applicant and recruiter-note access stays scoped to this employer.
            </p>
          </section>

          <section className="rounded-[1.5rem] border border-mist-100 bg-navy-950 p-5 text-white shadow-[var(--shadow-card)] sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/60">Public presence</p>
            <h2 className="mt-2 text-xl font-bold">See what candidates see.</h2>
            <p className="mt-2 text-sm leading-6 text-white/70">
              Open the Jobs discovery view filtered to {company.name} to review the employer-facing vacancy experience.
            </p>
            <Link
              href={`/jobs?q=${encodeURIComponent(company.name)}`}
              className="mt-5 inline-flex min-h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-bold text-navy-950 transition hover:bg-mist-50"
            >
              View public jobs
            </Link>
          </section>
        </aside>
      </div>
    </main>
  )
}
