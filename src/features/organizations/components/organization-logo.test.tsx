import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OrganizationLogo } from './organization-logo'

afterEach(() => cleanup())

const company = { id: '33333333-3333-4333-8333-333333333333', name: 'Fixture Lines', logoPath: 'companies/fixture/logo.png' }

describe('OrganizationLogo (round F logo fix)', () => {
  it('loads the logo eagerly from the logo route', () => {
    render(<OrganizationLogo company={company} size="lg" />)
    const logo = screen.getByRole('img', { name: 'Fixture Lines logo' })
    expect(logo.getAttribute('src')).toContain('/api/company-logo/33333333-3333-4333-8333-333333333333?v=')
    expect(logo).toHaveAttribute('loading', 'eager')
  })

  it('shows the initials instead of an empty box when the logo fails to load', () => {
    const { container } = render(<OrganizationLogo company={company} size="lg" />)
    fireEvent.error(screen.getByRole('img', { name: 'Fixture Lines logo' }))
    expect(screen.queryByRole('img', { name: 'Fixture Lines logo' })).not.toBeInTheDocument()
    expect(container).toHaveTextContent('FL')
  })

  it('shows the initials when there is no logo', () => {
    const { container } = render(<OrganizationLogo company={{ ...company, logoPath: null }} size="lg" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container).toHaveTextContent('FL')
  })
})
