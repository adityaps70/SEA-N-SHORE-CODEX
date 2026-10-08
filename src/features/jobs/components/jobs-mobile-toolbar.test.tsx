import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseJobSearchParams } from '../search'

const mocks = vi.hoisted(() => ({ replace: vi.fn(), search: 'mode=for-you&rank=Chief+Officer' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/jobs',
  useSearchParams: () => new URLSearchParams(mocks.search),
}))

import { JobsMobileToolbar } from './jobs-mobile-toolbar'

afterEach(() => cleanup())

function renderToolbar(params: Record<string, string> = { mode: 'for-you', rank: 'Chief Officer' }, resultCount = 42) {
  mocks.search = new URLSearchParams(params).toString()
  return render(<JobsMobileToolbar filters={parseJobSearchParams(params)} resultCount={resultCount} />)
}

describe('JobsMobileToolbar (phones)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a compact search and one chip row with My jobs, every discovery mode and All filters with its count', () => {
    renderToolbar()

    const search = screen.getByRole('search', { name: 'Search jobs' })
    expect(within(search).getByPlaceholderText('Role or company')).toHaveAttribute('name', 'q')
    expect(within(search).getByPlaceholderText('Anywhere')).toHaveAttribute('name', 'region')

    const views = screen.getByRole('navigation', { name: 'Job views' })
    expect(within(views).getByRole('link', { name: 'My jobs' })).toHaveAttribute('href', '/jobs/applications')
    for (const label of ['For You', 'Sea Jobs', 'Shore Jobs', 'Urgent Joining', 'Recently Posted']) {
      expect(within(views).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(within(views).getByRole('link', { name: 'For You' })).toHaveAttribute('aria-current', 'page')
    expect(within(views).getByRole('button', { name: /All filters \(1\)/ })).toBeInTheDocument()
  })

  it('lists active filters as removable chips', () => {
    renderToolbar()
    fireEvent.click(within(screen.getByRole('group', { name: 'Active filters' })).getByRole('button', { name: 'Remove Chief Officer filter' }))
    expect(mocks.replace).toHaveBeenCalledWith('/jobs?mode=for-you', { scroll: false })
  })

  it('opens a full-screen sheet holding every filter, with Reset and Show n results', () => {
    renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: /All filters/ }))

    const sheet = screen.getByRole('dialog', { name: 'All filters' })
    for (const heading of ['Sort by', 'Department and rank', 'Vessel type', 'Joining within', 'Experience and salary', 'Certificates and visas', 'Employer and apply']) {
      expect(within(sheet).getByRole('heading', { name: heading })).toBeInTheDocument()
    }
    for (const sort of ['Recommended', 'Newest', 'Joining soonest', 'Highest salary']) {
      expect(within(sheet).getByRole('button', { name: sort })).toBeInTheDocument()
    }
    expect(within(sheet).getByRole('combobox', { name: 'Rank / position' })).toHaveValue('chief_officer')
    const vessels = within(sheet).getByRole('group', { name: 'Vessel type' })
    expect(within(vessels).queryByRole('button', { name: 'AHTS' })).toBeNull()
    fireEvent.click(within(vessels).getByRole('button', { name: /more$/ }))
    expect(within(vessels).getByRole('button', { name: 'AHTS' })).toBeInTheDocument()
    // Round 12: Department → Rank selects from the shared taxonomy; Rank waits for a department.
    expect(within(sheet).getByRole('combobox', { name: 'Department' })).toHaveValue('deck_officers')
    expect(within(sheet).getByRole('combobox', { name: 'Rank / position' })).toBeEnabled()
    expect(within(sheet).getByLabelText('Experience (years)')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Minimum salary')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Certificate')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Visa')).toBeInTheDocument()
    expect(within(sheet).getByRole('switch', { name: 'Verified employers' })).toBeInTheDocument()
    expect(within(sheet).getByRole('switch', { name: 'Easy Apply only' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Reset' })).toBeEnabled()
    expect(within(sheet).getByRole('button', { name: 'Show 42 results' })).toBeInTheDocument()
  })

  it('applies a filter from the sheet and closes it with Show results', () => {
    renderToolbar({ mode: 'sea' }, 1)
    fireEvent.click(screen.getByRole('button', { name: 'All filters' }))
    const sheet = screen.getByRole('dialog', { name: 'All filters' })

    fireEvent.click(within(sheet).getByRole('button', { name: 'Newest' }))
    expect(mocks.replace).toHaveBeenLastCalledWith('/jobs?mode=sea&sort=recent', { scroll: false })
    fireEvent.click(within(sheet).getByRole('button', { name: '14 days' }))
    expect(mocks.replace).toHaveBeenLastCalledWith('/jobs?mode=sea&joining=14', { scroll: false })
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Easy Apply only' }))
    expect(mocks.replace).toHaveBeenLastCalledWith('/jobs?mode=sea&easyApply=1', { scroll: false })

    fireEvent.click(within(sheet).getByRole('button', { name: 'Show 1 result' }))
    expect(screen.queryByRole('dialog', { name: 'All filters' })).toBeNull()
  })

  it('says vessel type does not apply to shore jobs', () => {
    renderToolbar({ mode: 'shore' })
    fireEvent.click(screen.getByRole('button', { name: 'All filters' }))
    const sheet = screen.getByRole('dialog', { name: 'All filters' })
    expect(within(sheet).getByText('Vessel type does not apply to shore jobs.')).toBeInTheDocument()
    expect(within(sheet).getByRole('heading', { name: 'Department and role' })).toBeInTheDocument()
    const departments = Array.from((within(sheet).getByRole('combobox', { name: 'Department' }) as HTMLSelectElement).options).map((option) => option.value)
    expect(departments).toContain('technical_fleet')
    expect(departments).not.toContain('deck_officers')
  })
})
