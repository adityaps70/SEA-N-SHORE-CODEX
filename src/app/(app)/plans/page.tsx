import Link from 'next/link'
import { Building2, Check, Crown, UserRound } from 'lucide-react'

const freeFeatures = [
  'Profile',
  'Feed / community',
  'Connections / followers',
  'Messaging',
  'Search',
  'Apply for jobs',
  'Join events',
  'Enroll in courses',
  'Follow organizations',
]

const creatorFeatures = [
  'Everything in Member',
  'Post Jobs',
  'Create Events',
  'Create Courses / LMS',
]

const organizationFeatures = [
  'Organization page',
  'Jobs',
  'Events',
  'LMS',
  'Multiple admins',
  'Applicant management',
  'Student management',
  'Analytics',
  'Branding',
  'Team permissions',
  'Company verification',
]

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 grid gap-2.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm leading-6 text-navy-900">
          <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-teal-700" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export default function PlansPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Sea N Shore plans</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-navy-950 sm:text-5xl">
          Simple access for members, creators and maritime organizations
        </h1>
        <p className="mt-4 text-base leading-7 text-muted">
          Everyone can participate in the community for free. Paid plans unlock creator tools; trust-sensitive publishing still requires the relevant verification.
        </p>
      </header>

      <section className="grid gap-5 lg:grid-cols-3">
        <article className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)]">
          <span className="grid size-11 place-items-center rounded-xl bg-mist-50 text-ocean-700">
            <UserRound aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-muted">For everyone</p>
          <h2 className="mt-1 text-2xl font-bold text-navy-950">Sea N Shore Member</h2>
          <p className="mt-2 text-3xl font-bold text-navy-950">FREE</p>
          <FeatureList items={freeFeatures} />
        </article>

        <article className="rounded-[1.75rem] border border-teal-200 bg-white p-6 shadow-[var(--shadow-card)] ring-1 ring-teal-100">
          <span className="grid size-11 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <Crown aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Independent creators</p>
          <h2 className="mt-1 text-2xl font-bold text-navy-950">Creator Pro</h2>
          <p className="mt-2 text-sm leading-6 text-muted">For recruiters, consultants, trainers, coaches and event organizers.</p>
          <FeatureList items={creatorFeatures} />
          <Link
            href="/settings/billing?plan=creator_pro"
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
          >
            Get Creator Pro
          </Link>
        </article>

        <article className="rounded-[1.75rem] border border-mist-100 bg-navy-950 p-6 text-white shadow-[var(--shadow-card)]">
          <span className="grid size-11 place-items-center rounded-xl bg-white/10 text-teal-200">
            <Building2 aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-teal-200">Companies & institutions</p>
          <h2 className="mt-1 text-2xl font-bold">Organization Pro</h2>
          <p className="mt-2 text-sm leading-6 text-white/70">
            For shipping companies, manning agencies, training institutes, colleges, survey companies, service companies and associations.
          </p>
          <div className="[&_li]:text-white/85 [&_svg]:text-teal-200">
            <FeatureList items={organizationFeatures} />
          </div>
          <Link
            href="/organizations"
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-navy-950 transition hover:bg-mist-50"
          >
            Create or manage organization
          </Link>
        </article>
      </section>

      <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 sm:p-6">
        <h2 className="font-bold text-amber-950">Verification and payment are separate</h2>
        <p className="mt-2 text-sm leading-6 text-amber-900">
          A paid plan unlocks the commercial capability. Sea N Shore verification determines whether a person or organization is trusted to use that capability. Paying never bypasses recruiter, trainer, event-host or company verification.
        </p>
      </section>
    </main>
  )
}
