const audiences = ['Seafarers', 'Shore Professionals', 'Recruiters & Crewing Teams', 'Maritime Companies']

export function CommunityProofStrip() {
  return (
    <section className="border-y border-mist-100 bg-white" aria-label="Sea N Shore community">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <p className="max-w-xl text-sm font-semibold text-navy-950">One professional ecosystem for maritime people across sea and shore.</p>
        <div className="flex flex-wrap gap-2">
          {audiences.map((item) => <span key={item} className="rounded-full border border-mist-100 bg-mist-50 px-3 py-1.5 text-xs font-semibold text-ocean-800">{item}</span>)}
        </div>
      </div>
    </section>
  )
}
