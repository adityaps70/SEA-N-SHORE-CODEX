import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProfileActionState } from '../actions'

const actionMocks = vi.hoisted(() => ({
  completeActivation: vi.fn(async (): Promise<ProfileActionState> => ({ revision: 0 })),
}))

vi.mock('../actions', () => ({
  completeActivation: actionMocks.completeActivation,
}))

const sideMocks = vi.hoisted(() => ({
  checkUsernameAvailability: vi.fn(async (username: string) => ({ username, available: true, current: false })),
}))
vi.mock('../username-actions', () => ({ checkUsernameAvailability: sideMocks.checkUsernameAvailability }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../profile-document-actions', () => ({
  prepareDgProfileUpload: vi.fn(),
  confirmDgProfileUpload: vi.fn(),
  removeDgProfileUpload: vi.fn(),
}))

import { OnboardingForm } from './onboarding-form'

beforeEach(() => {
  actionMocks.completeActivation.mockReset()
  actionMocks.completeActivation.mockResolvedValue({ revision: 0 })
})

afterEach(() => cleanup())

describe('OnboardingForm persona activation', () => {
  it('starts with the human persona choices instead of Professional and Organisation roots', () => {
    render(<OnboardingForm initialFullName="Asha Singh" />)

    for (const label of [
      'Seafarer',
      'Shore Professional',
      'Recruiter / HR',
      'Trainer / Instructor',
      'Student / Cadet',
      'Seafarer Family',
      'Maritime Enthusiast',
      'Other',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /^Professional$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Organisation$/i })).not.toBeInTheDocument()
  })

  it('supports keyboard activation for persona and intent choices with selected state exposed to assistive technology', async () => {
    const user = userEvent.setup()
    render(<OnboardingForm initialFullName="Asha Singh" />)

    const seafarer = screen.getByRole('button', { name: 'Seafarer' })
    seafarer.focus()
    expect(seafarer).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(seafarer).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('What are you here to do?')).toBeInTheDocument()

    const network = screen.getByRole('button', { name: /^Network$/i })
    network.focus()
    expect(network).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(network).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: /Username/i })).toHaveAttribute('aria-describedby', 'username-description')
    expect(screen.getByLabelText('Who can see my contact details?')).toBeInTheDocument()
  })

  it('shows intent choices and relevant seafarer fields after selecting Seafarer', () => {
    render(<OnboardingForm initialFullName="Asha Singh" />)

    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))

    expect(screen.getByText('What are you here to do?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Find jobs/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hire people/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Learn/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Teach/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Attend events/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Host events/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Network$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Community$/i })).toBeInTheDocument()

    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Username/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Location')).toBeInTheDocument()
    expect(screen.getByLabelText('Current or most recent rank')).toBeInTheDocument()
    expect(screen.getByLabelText('Current / last organisation')).toBeInTheDocument()
    expect(screen.queryByLabelText('Professional summary')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sailing experience in years')).not.toBeInTheDocument()
  })

  it('keeps seafarer family onboarding lightweight and removes irrelevant professional fields', () => {
    render(<OnboardingForm initialFullName="Priya Singh" />)

    fireEvent.click(screen.getByRole('button', { name: /^Seafarer Family/i }))

    expect(screen.getByLabelText('Relationship to the maritime community')).toBeInTheDocument()
    expect(screen.queryByLabelText('Current or most recent rank')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Current / last organisation')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Training specialization')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Institute / academy')).not.toBeInTheDocument()
  })

  it('shows trainer and student fields only for those personas', () => {
    const { unmount } = render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: /^Trainer \/ Instructor/i }))

    expect(screen.getByLabelText('Training specialization')).toBeInTheDocument()
    expect(screen.getByLabelText('Organisation / institute')).toBeInTheDocument()
    expect(screen.queryByLabelText('Institute / academy')).not.toBeInTheDocument()

    unmount()
    render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: /^Student \/ Cadet/i }))

    expect(screen.getByLabelText('Institute / academy')).toBeInTheDocument()
    expect(screen.queryByLabelText('Training specialization')).not.toBeInTheDocument()
  })

  it('keeps Complete profile actionable so missing fields produce visible validation instead of a silent disabled button', () => {
    render(<OnboardingForm initialFullName="Asha Singh" />)

    expect(screen.getByRole('button', { name: 'Complete profile' })).toBeEnabled()
  })

  it('shows and focuses a clear persona error summary when the server rejects onboarding', async () => {
    actionMocks.completeActivation.mockResolvedValueOnce({
      revision: 1,
      fieldErrors: {
        persona: ['Choose the option that best describes you.'],
      },
      values: {},
    })
    render(<OnboardingForm initialFullName="Asha Singh" />)

    const form = screen.getByRole('button', { name: 'Complete profile' }).closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Please correct the highlighted information')
    expect(alert).toHaveTextContent('Choose the option that best describes you.')
    await waitFor(() => expect(document.activeElement).toHaveTextContent(/Which best describes you/i))
  })

  it('preserves persona, intent and entered values after server validation fails', async () => {
    actionMocks.completeActivation.mockResolvedValueOnce({
      revision: 1,
      fieldErrors: {
        slug: ['That username is already in use. Choose a different username and try again.'],
      },
      values: {
        persona: 'seafarer',
        profileIntents: JSON.stringify(['find_jobs', 'network']),
        fullName: 'Asha Updated',
        slug: 'asha-singh',
        location: 'Goa',
        currentCompany: 'Oceanic Shipping',
        rank: 'Chief Engineer',
        headline: 'Chief Engineer',
        contactVisibility: 'members',
      },
    })

    render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))
    fireEvent.click(screen.getByRole('button', { name: /Find jobs/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Network$/i }))
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Asha Updated' } })
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Goa' } })
    fireEvent.change(screen.getByLabelText('Current or most recent rank'), { target: { value: 'Chief Engineer' } })
    fireEvent.change(screen.getByLabelText('Current / last organisation'), { target: { value: 'Oceanic Shipping' } })

    const form = screen.getByRole('button', { name: 'Complete profile' }).closest('form')
    fireEvent.submit(form!)

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Full name')).toHaveValue('Asha Updated')
    expect(screen.getByLabelText('Location')).toHaveValue('Goa')
    expect(screen.getByLabelText('Current or most recent rank')).toHaveValue('Chief Engineer')
    expect(screen.getByLabelText('Current / last organisation')).toHaveValue('Oceanic Shipping')
    expect(screen.getByRole('button', { name: /Find jobs/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Network$/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows an unexpected submit failure without clearing entered onboarding information', async () => {
    actionMocks.completeActivation.mockRejectedValueOnce(new Error('network unavailable'))

    render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))
    fireEvent.click(screen.getByRole('button', { name: /Find jobs/i }))
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Asha Updated' } })
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Goa' } })
    fireEvent.change(screen.getByLabelText('Current or most recent rank'), { target: { value: 'Chief Engineer' } })
    fireEvent.change(screen.getByLabelText('Current / last organisation'), { target: { value: 'Oceanic Shipping' } })

    const form = screen.getByRole('button', { name: 'Complete profile' }).closest('form')
    fireEvent.submit(form!)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not submit your profile/i)
    expect(alert).toHaveTextContent(/try again/i)
    expect(screen.getByLabelText('Full name')).toHaveValue('Asha Updated')
    expect(screen.getByLabelText('Location')).toHaveValue('Goa')
    expect(screen.getByLabelText('Current or most recent rank')).toHaveValue('Chief Engineer')
    expect(screen.getByLabelText('Current / last organisation')).toHaveValue('Oceanic Shipping')
    await waitFor(() => expect(document.activeElement).toBe(alert))
  })
})

describe('OnboardingForm username and DG profile', () => {
  const profileId = '11111111-1111-4111-8111-111111111111'

  it('prefills a ready-to-use generated username and tells the member it can change later', async () => {
    render(<OnboardingForm initialFullName="Prakhar Pathak" suggestedUsername="prakhar.pathak" profileId={profileId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))

    const username = screen.getByRole('textbox', { name: /Username/i })
    expect(username).toHaveValue('prakhar.pathak')
    expect(username).not.toHaveAttribute('placeholder', 'capt.saurabh')
    expect(screen.getByText(/Keep it or change it now or later from your profile/)).toBeInTheDocument()
    expect(await screen.findByText('Username is available.')).toBeInTheDocument()
  })

  it('offers the generated handle instead of an error when the typed username cannot be used', async () => {
    render(<OnboardingForm initialFullName="Saurabh Sharma" suggestedUsername="saurabh.sharma" profileId={profileId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))
    const username = screen.getByRole('textbox', { name: /Username/i })

    fireEvent.change(username, { target: { value: 'capt..saurabh' } })

    expect(screen.getByText(/we'll use @saurabh\.sharma and you can change it later/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use @saurabh.sharma' }))
    expect(username).toHaveValue('saurabh.sharma')
  })

  it('submits the generated suggestion with the form so the server knows it was not hand-picked', async () => {
    render(<OnboardingForm initialFullName="Prakhar Pathak" suggestedUsername="prakhar.pathak" profileId={profileId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))
    const form = screen.getByRole('button', { name: 'Complete profile' }).closest('form')!
    fireEvent.submit(form)

    await waitFor(() => expect(actionMocks.completeActivation).toHaveBeenCalled())
    const submitted = (actionMocks.completeActivation.mock.calls[0] as unknown[])[1] as FormData
    expect(submitted.get('usernameSuggestion')).toBe('prakhar.pathak')
    expect(submitted.get('slug')).toBe('prakhar.pathak')
  })

  it('offers the optional, private DG profile upload to seafarers and explains who can see it', () => {
    render(<OnboardingForm initialFullName="Asha Singh" suggestedUsername="asha.singh" profileId={profileId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))

    expect(screen.getByRole('heading', { name: /DG Shipping profile/ })).toBeInTheDocument()
    expect(screen.getByText(/DG Shipping e-governance portal/)).toBeInTheDocument()
    expect(screen.getByText(/only you, Sea N Shore admins, and employers whose jobs you apply to/)).toBeInTheDocument()
    expect(screen.getByText(/skip this and add it later/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add DG profile PDF' })).toBeInTheDocument()
  })

  it('lets a seafarer finish without a DG profile and never sends a file with the form', async () => {
    const { container } = render(<OnboardingForm initialFullName="Asha Singh" suggestedUsername="asha.singh" profileId={profileId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))
    expect(container.querySelector('input[type="file"][name]')).toBeNull()

    fireEvent.submit(screen.getByRole('button', { name: 'Complete profile' }).closest('form')!)

    await waitFor(() => expect(actionMocks.completeActivation).toHaveBeenCalled())
    const submitted = (actionMocks.completeActivation.mock.calls[0] as unknown[])[1] as FormData
    expect([...submitted.values()].some((value) => typeof value !== 'string')).toBe(false)
  })

  it.each(['Shore Professional', 'Recruiter / HR', 'Seafarer Family', 'Student / Cadet'])(
    'does not show the DG profile upload for %s',
    (persona) => {
      render(<OnboardingForm initialFullName="Asha Singh" suggestedUsername="asha.singh" profileId={profileId} />)
      fireEvent.click(screen.getByRole('button', { name: persona }))
      expect(screen.queryByRole('heading', { name: /DG Shipping profile/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add DG profile PDF' })).not.toBeInTheDocument()
    },
  )

  it('shows an existing DG profile as on file when the seafarer returns to onboarding', () => {
    render(
      <OnboardingForm
        initialFullName="Asha Singh"
        suggestedUsername="asha.singh"
        profileId={profileId}
        initialDgProfile={{ kind: 'dg_profile', fileName: 'dg.pdf', sizeBytes: 4096, uploadedAt: '2026-09-20T00:00:00.000Z' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))
    expect(screen.getByText('DG profile on file')).toBeInTheDocument()
    expect(screen.getByText('dg.pdf')).toBeInTheDocument()
  })
})

describe('OnboardingForm current organization', () => {
  it('uses the organization picker and keeps a linked organization after a failed submit', async () => {
    actionMocks.completeActivation.mockResolvedValueOnce({
      revision: 1,
      fieldErrors: { slug: ['That username is already in use. Choose a different username and try again.'] },
      values: {
        persona: 'shore_professional',
        profileIntents: JSON.stringify(['network']),
        fullName: 'Asha Singh',
        slug: 'asha-singh',
        currentCompany: 'Oceanic Ship Management',
        currentCompanyId: '22222222-2222-4222-8222-222222222222',
        contactVisibility: 'members',
      },
    })

    const { container } = render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: 'Shore Professional' }))
    expect(screen.getByRole('combobox', { name: 'Current organisation' })).toBeInTheDocument()

    fireEvent.submit(screen.getByRole('button', { name: 'Complete profile' }).closest('form')!)

    await screen.findByText(/That username is already in use/)
    expect(screen.getByRole('combobox', { name: 'Current organisation' })).toHaveValue('Oceanic Ship Management')
    expect(container.querySelector<HTMLInputElement>('input[name="currentCompanyId"]')).toHaveValue('22222222-2222-4222-8222-222222222222')
  })
})

describe('OnboardingForm organization registration round trip', () => {
  afterEach(() => {
    window.sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('links the organization the member just registered, marked as waiting for verification', () => {
    render(
      <OnboardingForm
        initialFullName="Asha Singh"
        registeredOrganization={{ id: '55555555-5555-4555-8555-555555555555', name: 'Blue Anchor Marine', pending: true }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Shore Professional' }))

    expect(screen.getByRole('combobox', { name: 'Current organisation' })).toHaveValue('Blue Anchor Marine')
    expect(document.querySelector<HTMLInputElement>('input[name="currentCompanyId"]')?.value).toBe('55555555-5555-4555-8555-555555555555')
    expect(screen.getByText('Waiting for Sea N Shore verification')).toBeInTheDocument()
  })

  it('keeps the answers while the member registers their organization and restores them on return', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ query: 'Blue Anchor Marine', organizations: [] }) })))
    const first = render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: 'Shore Professional' }))
    fireEvent.click(screen.getByRole('button', { name: /^Network$/i }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Location' }), { target: { value: 'Kochi, India' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Current organisation' }), { target: { value: 'Blue Anchor Marine' } })

    const owner = await screen.findByRole('link', { name: /I own or manage this organization/ })
    expect(owner).toHaveAttribute('href', '/organizations/register?name=Blue+Anchor+Marine&returnTo=%2Fonboarding')
    fireEvent.click(owner)
    expect(window.sessionStorage.getItem('sns:onboarding-draft')).toContain('Kochi, India')
    first.unmount()

    render(
      <OnboardingForm
        initialFullName="Asha Singh"
        registeredOrganization={{ id: '55555555-5555-4555-8555-555555555555', name: 'Blue Anchor Marine', pending: true }}
      />,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Shore Professional' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByRole('button', { name: /^Network$/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('Kochi, India')
    expect(document.querySelector<HTMLInputElement>('input[name="currentCompanyId"]')?.value).toBe('55555555-5555-4555-8555-555555555555')
    expect(window.sessionStorage.getItem('sns:onboarding-draft')).toBeNull()
  })
})

describe('OnboardingForm on phones (one step at a time below md)', () => {
  function phoneSteps(container: HTMLElement) {
    const persona = screen.getByRole('group', { name: 'Which best describes you?' })
    const intents = screen.queryByRole('group', { name: 'What are you here to do?' })
    const basics = screen.queryByRole('group', { name: 'Your profile basics' })
    const submitRow = screen.getByRole('button', { name: 'Complete profile' }).parentElement as HTMLElement
    const progress = container.querySelector('[data-onboarding-progress]') as HTMLElement
    return { persona, intents, basics, submitRow, progress }
  }

  it('shows a progress bar and moves through the steps with Continue and Back', () => {
    const { container } = render(<OnboardingForm initialFullName="Asha Singh" />)
    let steps = phoneSteps(container)

    expect(steps.progress).toHaveClass('md:hidden')
    const bar = within(steps.progress).getByRole('progressbar', { name: 'Profile setup progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '3')
    expect(within(steps.progress).getByText(/Step 1 of 3/)).toBeInTheDocument()
    expect(within(steps.progress).queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(steps.persona).not.toHaveClass('max-md:hidden')
    expect(steps.submitRow).toHaveClass('max-md:hidden')

    const continueToGoals = within(steps.persona).getByRole('button', { name: 'Continue' })
    expect(continueToGoals).toHaveClass('md:hidden')
    expect(continueToGoals).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))
    expect(continueToGoals).toBeEnabled()
    fireEvent.click(continueToGoals)

    steps = phoneSteps(container)
    expect(within(steps.progress).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
    expect(steps.persona).toHaveClass('max-md:hidden')
    expect(steps.intents).not.toHaveClass('max-md:hidden')
    expect(steps.basics).toHaveClass('max-md:hidden')

    fireEvent.click(within(steps.intents as HTMLElement).getByRole('button', { name: 'Continue' }))
    steps = phoneSteps(container)
    expect(within(steps.progress).getByText(/Step 3 of 3/)).toBeInTheDocument()
    expect(steps.intents).toHaveClass('max-md:hidden')
    expect(steps.basics).not.toHaveClass('max-md:hidden')
    expect(steps.submitRow).not.toHaveClass('max-md:hidden')

    fireEvent.click(within(steps.progress).getByRole('button', { name: 'Back' }))
    steps = phoneSteps(container)
    expect(within(steps.progress).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
    expect(steps.intents).not.toHaveClass('max-md:hidden')
    fireEvent.click(within(steps.progress).getByRole('button', { name: 'Back' }))
    expect(phoneSteps(container).persona).not.toHaveClass('max-md:hidden')
    // Answers survive moving between steps.
    expect(screen.getByRole('button', { name: 'Seafarer' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps every step in the one form so all answers are submitted', async () => {
    const { container } = render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))
    fireEvent.click(screen.getByRole('button', { name: /Find jobs/i }))
    const form = container.querySelector('form') as HTMLFormElement
    const data = new FormData(form)
    expect(data.get('persona')).toBe('seafarer')
    expect(data.get('profileIntents')).toBe(JSON.stringify(['find_jobs']))
    expect(data.get('fullName')).toBe('Asha Singh')
  })

  it('jumps to the step with the first rejected field after a failed submit', async () => {
    actionMocks.completeActivation.mockResolvedValueOnce({
      revision: 1,
      fieldErrors: { slug: ['That username is already in use. Choose a different username and try again.'] },
      values: { persona: 'seafarer', profileIntents: JSON.stringify(['network']), fullName: 'Asha Singh', slug: 'asha', contactVisibility: 'members' },
    })
    const { container } = render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: 'Seafarer' }))
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    await screen.findByText(/That username is already in use/, { selector: 'li, p, span, a' })
    await waitFor(() => expect(within(phoneSteps(container).progress).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3'))
    expect(phoneSteps(container).basics).not.toHaveClass('max-md:hidden')
  })

  it('opens the organization search full screen on phones', () => {
    render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: 'Shore Professional' }))
    const combobox = screen.getByRole('combobox', { name: 'Current organisation' })
    fireEvent.pointerDown(combobox)
    const sheet = combobox.closest('[data-phone-fullscreen="true"]') as HTMLElement
    expect(sheet).not.toBeNull()
    expect(sheet).toHaveClass('max-md:fixed', 'max-md:inset-0')
  })
})
