import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MaritimeEcosystemHero } from './maritime-ecosystem-hero'

const routeLinePath = 'M3 17C15 17 15 6 29 6c13 0 11 12 25 12'

describe('MaritimeEcosystemHero', () => {
  it('removes only the hero route-line decorations while preserving the eyebrow footprint', () => {
    const { container, getByText } = render(
      <MaritimeEcosystemHero
        primary={{ href: '/register', label: 'Join Sea N Shore' }}
        secondary={{ href: '/login', label: 'Sign in' }}
      />,
    )

    expect(container.querySelectorAll(`path[d="${routeLinePath}"]`)).toHaveLength(0)

    const eyebrow = getByText(/Built for maritime, end to end/i).closest('p')
    const spacer = eyebrow?.querySelector('span[aria-hidden="true"]')

    expect(spacer).not.toBeNull()
    expect(spacer).toHaveClass('h-6', 'w-16')
  })
})
