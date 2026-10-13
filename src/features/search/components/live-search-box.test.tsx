import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  recent: vi.fn(async () => ['chief officer', 'tanker']),
  clear: vi.fn(async () => ({ ok: true })),
  record: vi.fn(async () => undefined),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('../search-actions', () => ({
  getRecentSearchesAction: mocks.recent,
  clearRecentSearchesAction: mocks.clear,
  recordSearchAction: mocks.record,
}))

const { LiveSearchBox } = await import('./live-search-box')

const items = [
  { id: 'p1', kind: 'person', name: 'Sachin Placeholder', subtitle: 'Second Officer', avatarUrl: null, href: '/people/sachin-placeholder' },
  { id: 'o1', kind: 'org', name: 'Placeholder Lines', subtitle: null, avatarUrl: null, href: '/organizations/placeholder-lines' },
]

describe('LiveSearchBox (round G)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ query: 'sach', items }) })))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function typeAndSettle(value: string) {
    const input = screen.getByRole('combobox', { name: 'Search Sea N Shore' })
    fireEvent.change(input, { target: { value } })
    await act(async () => {
      vi.advanceTimersByTime(130)
    })
    await act(async () => {
      await Promise.resolve()
    })
    return input
  }

  it('is an ARIA combobox: results as options, matched letters marked, count announced', async () => {
    render(<LiveSearchBox />)
    const input = await typeAndSettle('sach')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'SachinPerson · Second Officer'.replace('SachinPerson', 'Sachin PlaceholderPerson'),
      'Placeholder LinesOrganization',
      'See all results for “sach”',
    ])
    expect(screen.getByText('Sach').tagName).toBe('MARK')
    expect(screen.getByRole('status')).toHaveTextContent('2 results. Press Enter for all results.')
  })

  it('moves with up/down, opens with Enter and closes with Esc', async () => {
    render(<LiveSearchBox />)
    const input = await typeAndSettle('sach')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const second = screen.getAllByRole('option')[1]!
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', second.id)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.push).toHaveBeenCalledWith('/organizations/placeholder-lines')
    expect(mocks.record).toHaveBeenCalledWith('sach', 2, 'org')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('Enter with nothing selected opens all results', async () => {
    render(<LiveSearchBox />)
    const input = await typeAndSettle('sach')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.push).toHaveBeenCalledWith('/search?q=sach')
  })

  it('shows recent searches when empty, with Clear all', async () => {
    vi.useRealTimers()
    render(<LiveSearchBox />)
    fireEvent.focus(screen.getByRole('combobox', { name: 'Search Sea N Shore' }))
    expect(await screen.findByRole('option', { name: 'chief officer' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await vi.waitFor(() => expect(screen.queryByRole('option', { name: 'chief officer' })).not.toBeInTheDocument())
    expect(mocks.clear).toHaveBeenCalled()
  })
})
