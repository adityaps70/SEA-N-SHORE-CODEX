import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))

import { MarketingChrome } from './marketing-chrome'

afterEach(() => cleanup())

function renderChrome() {
  return render(
    <MarketingChrome header={<header>Public header</header>} footer={<footer>Public footer</footer>}>
      <main>Page</main>
    </MarketingChrome>,
  )
}

describe('MarketingChrome', () => {
  it('lets the landing page draw its own header and footer', () => {
    navigation.pathname = '/'
    renderChrome()
    expect(screen.getByText('Page')).toBeInTheDocument()
    expect(screen.queryByText('Public header')).not.toBeInTheDocument()
    expect(screen.queryByText('Public footer')).not.toBeInTheDocument()
  })

  it('wraps every other marketing page in the shared public header and footer', () => {
    navigation.pathname = '/pricing'
    renderChrome()
    expect(screen.getByText('Public header')).toBeInTheDocument()
    expect(screen.getByText('Page')).toBeInTheDocument()
    expect(screen.getByText('Public footer')).toBeInTheDocument()
  })
})
