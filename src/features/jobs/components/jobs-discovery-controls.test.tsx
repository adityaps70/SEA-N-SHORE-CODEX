import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeJobFilters } from '../filter-state'
import { parseJobSearchParams } from '../search'

const mocks = vi.hoisted(() => ({ replace: vi.fn(), search: '' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/jobs',
  useSearchParams: () => new URLSearchParams(mocks.search),
}))

import { JobsDiscoveryControls } from './jobs-discovery-controls'
import { JobsMobileToolbar } from './jobs-mobile-toolbar'

afterEach(() => cleanup())

// Hotfix P5: visa is no longer a job filter. An old link with ?visa= still opens and simply ignores it.
describe('job filters without visa (hotfix P5)', () => {
  const oldLink = { mode: 'sea', certificate: 'ECDIS', visa: 'US C1/D' }

  it('the desktop filter panel has no visa control, and an old visa link shows no visa chip', () => {
    mocks.search = new URLSearchParams(oldLink).toString()
    render(<JobsDiscoveryControls filters={parseJobSearchParams(oldLink)} resultCount={3} />)
    expect(screen.getByLabelText('Certificate')).toBeInTheDocument()
    expect(screen.queryByLabelText('Visa')).toBeNull()
    expect(screen.queryByRole('option', { name: 'Any visa' })).toBeNull()
    expect(screen.queryByText('US C1/D')).toBeNull()
  })

  it('the phone toolbar counts the same filters with or without the old visa parameter', () => {
    mocks.search = new URLSearchParams(oldLink).toString()
    render(<JobsMobileToolbar filters={parseJobSearchParams(oldLink)} resultCount={3} />)
    expect(screen.getByRole('button', { name: /All filters \(1\)/ })).toBeInTheDocument()
    expect(screen.queryByText('US C1/D')).toBeNull()
  })

  it('active filter chips never include visa', () => {
    expect(activeJobFilters(parseJobSearchParams(oldLink))).toEqual(activeJobFilters(parseJobSearchParams({ mode: 'sea', certificate: 'ECDIS' })))
    expect(activeJobFilters(parseJobSearchParams(oldLink)).map((item) => item.key)).not.toContain('visa')
  })
})
