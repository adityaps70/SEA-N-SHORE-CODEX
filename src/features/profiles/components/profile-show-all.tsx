'use client'

import { ArrowRight } from 'lucide-react'
import { Children, isValidElement, useState, type ElementType, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Phones only (below md): show the first `limit` entries of a profile section, then a
 * "Show all n …" row that expands the list in place. On md and wider every entry shows and the
 * button is hidden, so desktop is unchanged.
 */
export function PhoneShowAll({
  children,
  limit = 2,
  noun,
  as: Wrapper = 'div',
  itemAs: Item = 'div',
  className,
  itemClassName,
  labelledBy,
  placement = 'section-end',
}: {
  children: ReactNode
  limit?: number
  /** Plural label for the button, e.g. "experience" → "Show all 6 experience". */
  noun: string
  as?: ElementType
  itemAs?: ElementType
  className?: string
  itemClassName?: string
  labelledBy?: string
  /** `section-end`: a full-width row at the bottom of a ProfileSection; `inline`: inside the section. */
  placement?: 'section-end' | 'inline'
}) {
  const [expanded, setExpanded] = useState(false)
  const items = Children.toArray(children)
  const hiddenCount = items.length - limit
  const collapsible = hiddenCount > 0

  return (
    <>
      <Wrapper className={className} aria-labelledby={labelledBy}>
        {items.map((item, index) => (
          <Item
            key={isValidElement(item) && item.key != null ? item.key : index}
            data-phone-overflow={collapsible && !expanded && index >= limit ? 'hidden' : undefined}
            className={cn(itemClassName, collapsible && !expanded && index >= limit ? 'max-md:hidden' : null)}
          >
            {item}
          </Item>
        ))}
      </Wrapper>
      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            'flex min-h-12 cursor-pointer items-center justify-center gap-1.5 text-[15px] font-semibold text-navy-700 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500 md:hidden',
            placement === 'section-end'
              ? '-mx-4 mt-4 -mb-5 w-[calc(100%+2rem)] border-t border-mist-100'
              : 'mt-2 w-full rounded-xl border border-mist-100',
          )}
        >
          {expanded ? 'Show less' : `Show all ${items.length} ${noun}`}
          {expanded ? null : <ArrowRight aria-hidden="true" className="size-4" />}
        </button>
      ) : null}
    </>
  )
}
