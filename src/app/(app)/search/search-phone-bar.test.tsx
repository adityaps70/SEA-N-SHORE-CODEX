import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchPhoneBar } from './search-phone-bar'

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
}

afterEach(() => cleanup())

describe('SearchPhoneBar', () => {
  it('is a back arrow plus the search input, focused on phones when empty', () => {
    mockMatchMedia(true)
    render(<SearchPhoneBar query="" chip="all" />)
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/home')
    const input = screen.getByRole('searchbox', { name: 'Search Sea N Shore' })
    expect(input).toHaveFocus()
  })

  it('does not steal focus on desktop, keeps the query and the selected chip', () => {
    mockMatchMedia(false)
    const { container } = render(<SearchPhoneBar query="sire" chip="jobs" />)
    const input = screen.getByRole('searchbox', { name: 'Search Sea N Shore' })
    expect(input).toHaveValue('sire')
    expect(input).not.toHaveFocus()
    expect(container.querySelector('input[type="hidden"][name="type"]')).toHaveValue('jobs')
  })
})
