import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getUserOrganizationState: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { getUserOrganizationState: mocks.getUserOrganizationState },
}))
vi.mock('@/features/organizations/components/organization-application-form', () => ({
  OrganizationApplicationForm: (props: { mode: string; prefillName?: string; returnTo?: string | null }) => (
    <form aria-label="Register a new organization" data-mode={props.mode} data-name={props.prefillName ?? ''} data-return={props.returnTo ?? ''} />
  ),
}))

import RegisterOrganizationPage from './page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.getUserOrganizationState.mockResolvedValue({ kind: 'none' })
})
afterEach(() => cleanup())

describe('/organizations/register', () => {
  it('prefills the name and returns to onboarding afterwards', async () => {
    render(await RegisterOrganizationPage({ searchParams: Promise.resolve({ name: ' Blue Anchor Marine ', returnTo: '/onboarding' }) }))

    expect(screen.getByRole('heading', { level: 1, name: 'Register Blue Anchor Marine' })).toBeInTheDocument()
    const form = screen.getByRole('form', { name: 'Register a new organization' })
    expect(form).toHaveAttribute('data-mode', 'create')
    expect(form).toHaveAttribute('data-name', 'Blue Anchor Marine')
    expect(form).toHaveAttribute('data-return', '/onboarding')
    expect(screen.getByRole('link', { name: /Back to setting up your profile/ })).toHaveAttribute('href', '/onboarding')
  })

  it('ignores unknown return addresses', async () => {
    render(await RegisterOrganizationPage({ searchParams: Promise.resolve({ returnTo: 'https://evil.example' }) }))

    expect(screen.getByRole('form', { name: 'Register a new organization' })).toHaveAttribute('data-return', '')
    expect(screen.getByRole('link', { name: /Back to Organizations/ })).toHaveAttribute('href', '/organizations')
  })

  it('explains when another organization is still being reviewed', async () => {
    mocks.getUserOrganizationState.mockResolvedValue({
      kind: 'application', status: 'pending', applicationId: 'a', company: { id: 'c', slug: 'c', name: 'Harbour Minds', verified: false },
    })
    render(await RegisterOrganizationPage({ searchParams: Promise.resolve({ name: 'Blue Anchor' }) }))

    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sea N Shore is still reviewing Harbour Minds' })).toBeInTheDocument()
  })
})
