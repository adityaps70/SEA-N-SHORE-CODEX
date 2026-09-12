import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight, Hammer } from 'lucide-react'
import { PremiumPageHero } from '@/components/product/premium-page-hero'
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
      <PremiumPageHero
        eyebrow={eyebrow}
        title={title}
        description={description}
        eyebrowAccessory={(
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.1em] text-slate-100">
            <Hammer aria-hidden="true" className="size-3" />
            In development
          </span>
        )}
      >
        <div className="mt-6 inline-flex max-w-xl items-start gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white/80">
          <ArrowUpRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-teal-200" />
          <span>{note}</span>
        </div>
      </PremiumPageHero>

      <p className="mt-5 text-sm text-muted">
        This section is a product preview. The capabilities below are not yet active workflows.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map(({ title: itemTitle, description: itemDescription, meta, icon: Icon }) => (
          <Card key={itemTitle} className="border border-mist-100 p-6 shadow-none">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-mist-50 text-teal-700">
              <Icon aria-hidden="true" className="size-5" />
            </div>
            {meta ? (
              <p className="mt-5 text-xs font-semibold uppercase tracking-[.14em] text-teal-700">
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
