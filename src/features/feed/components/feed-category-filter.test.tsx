import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { POST_CATEGORIES, POST_CATEGORY_LABELS } from '../types'
import { FeedCategoryFilter, feedCategoryHref } from './feed-category-filter'

afterEach(() => cleanup())

describe('FeedCategoryFilter', () => {
  it('renders All plus every topic as one horizontally scrolling chip row of links', () => {
    render(<FeedCategoryFilter />)
    const nav = screen.getByRole('navigation', { name: 'Filter maritime feed' })
    expect(nav).toHaveClass('overflow-x-auto')

    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'All',
      'Maritime News',
      'Technical Discussion',
      'Vetting & SIRE 2.0',
      'Career Advice',
      'Safety Lessons',
      'Achievement',
      'Learning',
      'Industry Opinion',
    ])
    expect(links[0]).toHaveAttribute('href', '/home')
    POST_CATEGORIES.forEach((category, index) => {
      expect(links[index + 1]).toHaveAttribute('href', `/home?category=${category}`)
      expect(links[index + 1]).toHaveTextContent(POST_CATEGORY_LABELS[category])
    })
  })

  it('marks All as current without a category', () => {
    render(<FeedCategoryFilter />)
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'All' })).toHaveClass('bg-navy-950', 'text-white')
  })

  it('marks the chosen topic as current with the filled navy chip', () => {
    render(<FeedCategoryFilter category="vetting_sire_2_0" />)
    const chip = screen.getByRole('link', { name: 'Vetting & SIRE 2.0' })
    expect(chip).toHaveAttribute('aria-current', 'page')
    expect(chip).toHaveClass('bg-navy-950', 'text-white', 'max-md:min-h-8')
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current')
  })

  it('builds the filter links', () => {
    expect(feedCategoryHref()).toBe('/home')
    expect(feedCategoryHref('career_advice')).toBe('/home?category=career_advice')
  })
})
