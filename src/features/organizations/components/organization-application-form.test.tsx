import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  submitOrganizationApplication: vi.fn(),
  resubmitOrganizationApplication: vi.fn(),
  submitOrganizationClaim: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}))

vi.mock('../unclaimed-organization-actions', () => ({
  submitOrganizationClaim: mocks.submitOrganizationClaim,
}))

vi.mock('../actions', () => ({
  submitOrganizationApplication: mocks.submitOrganizationApplication,
  resubmitOrganizationApplication: mocks.resubmitOrganizationApplication,
}))

import { OrganizationApplicationForm } from './organization-application-form'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => cleanup())

function chooseType(value: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Organization type' }), { target: { value } })
}

function submitForm() {
  const form = screen.getByRole('button', { name: 'Submit for verification' }).closest('form')
  expect(form).not.toBeNull()
  fireEvent.submit(form!)
}

describe('OrganizationApplicationForm onboarding errors', () => {
  it('shows a field-level corrective error, keeps entered data, and focuses the invalid field', async () => {
    mocks.submitOrganizationApplication.mockResolvedValueOnce({
      ok: false,
      error: 'Please correct the highlighted information and try again.',
      fieldErrors: {
        officialEmail: ['Enter a valid work email address, for example name@company.com.'],
      },
    })

    render(<OrganizationApplicationForm mode="create" />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Organization name' }), {
      target: { value: 'Oceanic Shipping' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: /Official work email/i }), {
      target: { value: 'not-an-email' },
    })
    submitForm()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Please correct the highlighted information')
    expect(screen.getByRole('textbox', { name: /Official work email/i })).toHaveAccessibleDescription(/Enter a valid work email address, for example name@company.com./)
    expect(screen.getByRole('textbox', { name: 'Organization name' })).toHaveValue('Oceanic Shipping')
    expect(screen.getByRole('textbox', { name: /Official work email/i })).toHaveValue('not-an-email')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Official work email/i })))
  })

  it('turns an unexpected submit rejection into a visible retry message without clearing the form', async () => {
    mocks.submitOrganizationApplication.mockRejectedValueOnce(new Error('network unavailable'))
    render(<OrganizationApplicationForm mode="create" />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Organization name' }), {
      target: { value: 'Oceanic Shipping' },
    })
    submitForm()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/check your connection and try again/i)
    expect(screen.getByRole('textbox', { name: 'Organization name' })).toHaveValue('Oceanic Shipping')
  })
})

describe('OrganizationApplicationForm type-dependent fields', () => {
  it('offers grouped organization types beyond maritime companies', () => {
    render(<OrganizationApplicationForm mode="create" />)
    const select = screen.getByRole('combobox', { name: 'Organization type' })
    const groups = within(select).getAllByRole('group').map((group) => group.getAttribute('label'))
    expect(groups).toEqual([
      'Shipping & maritime',
      'Wellbeing & support',
      'Education & training',
      'Public sector & associations',
      'Technology & other',
    ])
    expect(within(select).getByRole('option', { name: 'Mental-health & wellbeing provider' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Trade union' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Manning / crewing agency' })).toBeInTheDocument()
  })

  it('shows maritime fields only for maritime types and the recruitment licence only for crewing agencies', () => {
    render(<OrganizationApplicationForm mode="create" />)
    expect(screen.queryByRole('textbox', { name: /Vessel types/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Recruitment licence/ })).not.toBeInTheDocument()

    chooseType('manning_agency')
    expect(screen.getByRole('textbox', { name: /Recruitment licence/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Vessel types/ })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Number of vessels/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('verification-checks')).toHaveTextContent('RPSL licence (India) or MLC 2006')

    chooseType('ship_manager')
    expect(screen.getByRole('textbox', { name: /Number of vessels/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Fleet summary/ })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Recruitment licence/ })).not.toBeInTheDocument()

    chooseType('union')
    expect(screen.queryByRole('textbox', { name: /Vessel types/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Services offered/ })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Union registration number/ })).toBeInTheDocument()
  })

  it('shows wellbeing fields for mental-health providers and submits their answers', async () => {
    mocks.submitOrganizationApplication.mockResolvedValueOnce({ ok: true, applicationId: 'application-1' })
    render(<OrganizationApplicationForm mode="create" />)
    chooseType('mental_health_provider')

    expect(screen.queryByRole('textbox', { name: /Vessel types/ })).not.toBeInTheDocument()
    const services = screen.getByRole('group', { name: /Services offered/ })
    fireEvent.click(within(services).getByRole('checkbox', { name: 'Counselling & therapy' }))
    fireEvent.click(within(services).getByRole('checkbox', { name: 'Crisis support' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Yes, 24/7' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Languages/ }), { target: { value: 'English, Hindi, english' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Professional accreditation or registration/ }), { target: { value: 'BACP organisational member' } })
    expect(screen.getByTestId('verification-checks')).toHaveTextContent('safeguarding and confidentiality policy')

    submitForm()
    await waitFor(() => expect(mocks.submitOrganizationApplication).toHaveBeenCalledTimes(1))
    expect(mocks.submitOrganizationApplication.mock.calls[0]?.[0]).toMatchObject({
      organizationType: 'mental_health_provider',
      servicesOffered: ['counselling', 'crisis_support'],
      helpline24x7: true,
      languages: ['English', 'Hindi'],
      accreditation: 'BACP organisational member',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Organization submitted')
  })

  it('asks for a description when the type is Other', () => {
    render(<OrganizationApplicationForm mode="create" />)
    expect(screen.queryByRole('textbox', { name: 'Describe the type' })).not.toBeInTheDocument()
    chooseType('other')
    expect(screen.getByRole('textbox', { name: 'Describe the type' })).toBeRequired()
  })

  it('pre-selects the stored type and details when an application is resubmitted', () => {
    render(
      <OrganizationApplicationForm
        mode="resubmit"
        applicationId="22222222-2222-4222-8222-222222222222"
        initial={{
          organizationName: 'Harbour Minds',
          organizationType: 'counselling_service',
          organizationTypeOther: null,
          website: null,
          officialEmail: 'care@harbourminds.org',
          officeLocation: 'Manila',
          description: 'Counselling for seafarers and their families.',
          fleetSummary: null,
          vesselTypes: [],
          servicesOffered: ['family_support'],
          languages: ['Tagalog'],
          helpline24x7: false,
          accreditation: 'PRC registered',
          applicantRole: 'Lead Counsellor',
          registrationReference: null,
          supportingNotes: null,
        }}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Organization type' })).toHaveValue('counselling_service')
    expect(screen.getByRole('checkbox', { name: 'Support for families' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: /Languages/ })).toHaveValue('Tagalog')
  })

  it('returns to onboarding with the new organization after registering from the picker', async () => {
    mocks.submitOrganizationApplication.mockResolvedValueOnce({ ok: true, applicationId: 'application-1', companyId: '55555555-5555-4555-8555-555555555555' })
    render(<OrganizationApplicationForm mode="create" prefillName="Blue Anchor Marine" returnTo="/onboarding" />)
    expect(screen.getByRole('textbox', { name: 'Organization name' })).toHaveValue('Blue Anchor Marine')
    chooseType('union')

    submitForm()

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/onboarding?registered=55555555-5555-4555-8555-555555555555'))
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('claims an unclaimed page through the same verification form', async () => {
    mocks.submitOrganizationClaim.mockResolvedValueOnce({ ok: true, applicationId: 'application-2' })
    render(
      <OrganizationApplicationForm
        mode="claim"
        companyId="66666666-6666-4666-8666-666666666666"
        initial={{
          organizationName: 'Harbour Crew Services',
          organizationType: 'manning_agency',
          organizationTypeOther: null,
          website: null,
          officialEmail: '',
          officeLocation: 'Kochi, India',
          description: '',
          fleetSummary: null,
          vesselTypes: [],
          applicantRole: '',
          registrationReference: null,
          supportingNotes: null,
        }}
      />,
    )
    expect(screen.getByRole('form', { name: 'Claim organization page' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Organization name' })).toHaveValue('Harbour Crew Services')
    expect(screen.getByRole('textbox', { name: 'Office location' })).toHaveValue('Kochi, India')
    expect(screen.getByRole('combobox', { name: 'Organization type' })).toHaveValue('manning_agency')

    fireEvent.submit(screen.getByRole('button', { name: 'Send claim for verification' }).closest('form')!)

    await waitFor(() => expect(mocks.submitOrganizationClaim).toHaveBeenCalledTimes(1))
    expect(mocks.submitOrganizationClaim.mock.calls[0]?.[0]).toBe('66666666-6666-4666-8666-666666666666')
    expect(mocks.submitOrganizationClaim.mock.calls[0]?.[1]).toMatchObject({ organizationName: 'Harbour Crew Services' })
    expect(mocks.submitOrganizationApplication).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('Claim sent')
  })
})
