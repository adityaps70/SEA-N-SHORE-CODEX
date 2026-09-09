import { Search, UserRoundSearch } from 'lucide-react'
import { LandingSectionHeading } from './landing-section-heading'

const roles = ['Master Mariners', 'Chief Engineers', 'Marine Superintendents', 'Technical Superintendents', 'Crewing Managers', 'DPA / CSO', 'Maritime Trainers', 'Recruiters']

export function ProfessionalDiscoveryShowcase() {
  return (
    <section className="border-y border-mist-100 bg-white py-16 sm:py-20" aria-labelledby="professional-discovery-title">
      <div className="mx-auto grid w-full max-w-7xl gap-9 px-4 sm:px-6 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
        <LandingSectionHeading eyebrow="Professional discovery" title="Find the people you need across maritime" body="Sea N Shore is designed around maritime roles and professional context, so discovery starts with the language the industry already uses." />
        <div className="rounded-[1.75rem] border border-mist-100 bg-mist-50 p-5 sm:p-6">
          <div className="flex min-h-12 items-center gap-3 rounded-xl border border-mist-100 bg-white px-4 text-sm text-muted"><Search aria-hidden="true" className="size-4 text-ocean-700" />Search maritime professionals</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {roles.map((role) => <div key={role} className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-sm font-semibold text-navy-950"><UserRoundSearch aria-hidden="true" className="size-4 text-teal-500" />{role}</div>)}
          </div>
        </div>
      </div>
    </section>
  )
}
