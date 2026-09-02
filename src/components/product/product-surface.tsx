import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight } from 'lucide-react'
import { Card } from '@/components/ui/card'

export type SurfaceItem = {
  title: string
  description: string
  meta?: string
  icon: LucideIcon
}

type ProductSurfaceProps = {
  eyebrow: string
  title: string
  description: string
  note: string
  items: SurfaceItem[]
}

export function ProductSurface({
  eyebrow,
  title,
  description,
  note,
  items,
}: ProductSurfaceProps) {
  return (
    <section className="py-7 sm:py-10">
      <div className="overflow-hidden rounded-[2rem] border border-mist-100 bg-navy-950 px-5 py-8 text-white shadow-[var(--shadow-card)] sm:px-9 sm:py-11">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-sky-200">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-.045em] sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">
            {description}
          </p>
        </div>
        <div className="mt-8 inline-flex max-w-xl items-start gap-2 rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm leading-6 text-slate-200">
          <ArrowUpRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-sky-200" />
          <span>{note}</span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map(({ title: itemTitle, description: itemDescription, meta, icon: Icon }) => (
          <Card key={itemTitle} className="border border-mist-100 p-6 shadow-none transition-transform duration-200 hover:-translate-y-0.5">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-mist-50 text-ocean-700">
              <Icon aria-hidden="true" className="size-5" />
            </div>
            {meta ? (
              <p className="mt-5 text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">
                {meta}
              </p>
            ) : null}
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-navy-950">
              {itemTitle}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted">{itemDescription}</p>
          </Card>
        ))}
      </div>
    </section>
  )
}
