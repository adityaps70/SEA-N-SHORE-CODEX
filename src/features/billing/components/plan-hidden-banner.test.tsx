import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanHiddenBanner } from './plan-hidden-banner'

afterEach(() => cleanup())

describe('PlanHiddenBanner', () => {
  it('tells the owner why the item is hidden and links to Organization Pro for organization items', () => {
    render(<PlanHiddenBanner companyId="55555555-5555-4555-8555-555555555555" />)
    expect(screen.getByRole('note')).toHaveTextContent('Hidden because your plan ended — renew to restore')
    expect(screen.getByRole('link', { name: 'Renew Organization Pro' })).toHaveAttribute(
      'href',
      '/settings/billing/organizations/55555555-5555-4555-8555-555555555555?plan=organization_pro#organization-pro',
    )
  })

  it('links personal items to Creator Pro', () => {
    render(<PlanHiddenBanner companyId={null} />)
    expect(screen.getByRole('link', { name: 'Renew Creator Pro' })).toHaveAttribute('href', '/settings/billing?plan=creator_pro#creator-pro')
  })
})
