import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../admin-actions', () => ({
  grantCountryAdminAction: vi.fn(async (state: unknown) => state),
  updateCountryAdminAction: vi.fn(async (state: unknown) => state),
  removeCountryAdminAction: vi.fn(async (state: unknown) => state),
}))

const { EditCountryAdminForm, GrantCountryAdminForm } = await import('./country-admin-forms')

afterEach(() => cleanup())

/** Round GP Part E: sections are chosen with View and Act tickboxes when adding a country admin, and later. */
describe('country admin section tickboxes', () => {
  it('ticks Organizations (act) only on the Add form', () => {
    render(<GrantCountryAdminForm />)
    expect(screen.getByRole('checkbox', { name: 'Organizations: view' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Organizations: act' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Overview: view' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Members by country: view' })).not.toBeChecked()
    // View-only sections have no Act tickbox.
    expect(screen.queryByRole('checkbox', { name: 'Overview: act' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Members by country: act' })).not.toBeInTheDocument()
  })

  it('ticks View with Act, and clears Act when View is cleared', () => {
    render(<EditCountryAdminForm profileId="11111111-1111-4111-8111-111111111111" name="Placeholder Partner" countries={['PH']} permissions={{ members: 'view' }} />)
    const view = screen.getByRole('checkbox', { name: 'Organizations: view' })
    const act = screen.getByRole('checkbox', { name: 'Organizations: act' })
    expect(view).not.toBeChecked()
    fireEvent.click(act)
    expect(view).toBeChecked()
    expect(act).toBeChecked()
    fireEvent.click(view)
    expect(act).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Members by country: view' })).toBeChecked()
  })

  it('names the tickboxes for the form', () => {
    const { container } = render(<GrantCountryAdminForm />)
    expect(container.querySelector('input[name="act_organizations"]')).not.toBeNull()
    expect(container.querySelector('input[name="view_members"]')).not.toBeNull()
    expect(container.querySelector('input[name="act_members"]')).toBeNull()
  })
})
