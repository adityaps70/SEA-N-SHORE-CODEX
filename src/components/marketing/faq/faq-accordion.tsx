import Link from 'next/link'
import { ArrowRight, Plus } from 'lucide-react'
import type { FaqItem } from './faq-data'

/**
 * Accessible FAQ accordion built on <details>/<summary>: keyboard and screen-reader
 * support come from the browser, it works without JavaScript and in-page search can
 * open a closed answer. Used on the landing page and on /help.
 */
export function FaqAccordion({ items, idPrefix = 'faq' }: { items: FaqItem[]; idPrefix?: string }) {
  return (
    <div className="grid gap-3 max-md:gap-2" data-faq-list="">
      {items.map((item) => (
        <details
          key={item.id}
          id={`${idPrefix}-${item.id}`}
          className="group scroll-mt-28 rounded-2xl border border-mist-200 bg-white shadow-[0_12px_32px_-28px_rgb(7_27_45/0.5)] transition-colors open:border-ocean-200 open:bg-ocean-50/40 hover:border-ocean-200"
        >
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left text-base font-bold max-md:min-h-12 max-md:gap-3 max-md:px-4 max-md:py-3 max-md:text-[15px] text-navy-950 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-500 sm:text-[17px] [&::-webkit-details-marker]:hidden">
            <span>{item.question}</span>
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full border border-mist-200 bg-white text-ocean-700 transition-transform duration-300 group-open:rotate-45 group-open:border-ocean-200"
            >
              <Plus className="size-4" />
            </span>
          </summary>
          <p className="px-5 pb-5 text-[15px] leading-7 text-navy-800 max-md:px-4 max-md:pb-4 max-md:text-base max-md:leading-6">{item.answer}</p>
          {item.link ? (
            <p className="-mt-2 px-5 pb-5 max-md:px-4 max-md:pb-4">
              <Link href={item.link.href} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-bold text-ocean-700 hover:text-navy-950 hover:underline">
                {item.link.label}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </p>
          ) : null}
        </details>
      ))}
    </div>
  )
}
