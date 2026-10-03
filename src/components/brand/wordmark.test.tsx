import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BRAND_ASSETS } from './brand-assets'
import { Wordmark } from './wordmark'

afterEach(() => cleanup())

describe('Wordmark', () => {
  it('uses the stacked Sea N Shore ship logo by default', () => {
    render(<Wordmark />)

    const link = screen.getByRole('link', { name: /sea n shore home/i })
    expect(link).toHaveAttribute('href', '/')

    const logo = screen.getByRole('img', { name: 'Sea N Shore' })
    expect(logo).toHaveAttribute('src', '/brand/sea-n-shore-stacked.webp')
    expect(logo).toHaveAttribute('width', String(BRAND_ASSETS.stacked.width))
    expect(logo).toHaveAttribute('height', String(BRAND_ASSETS.stacked.height))
  })

  it('uses the horizontal lockup in compact headers', () => {
    render(<Wordmark compact />)

    const logo = screen.getByRole('img', { name: 'Sea N Shore' })
    expect(logo).toHaveAttribute('src', '/brand/sea-n-shore-lockup.webp')
  })

  it('never points at the retired logo artwork', () => {
    const { container } = render(<><Wordmark /><Wordmark compact /></>)
    const sources = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))
    for (const src of sources) {
      expect(src).not.toMatch(/sea-and-shore-|compact-lockup|master-crop|sea-n-shore-symbol/)
    }
  })
})
