import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planAccountDeletion } from '../plan'
import { DeleteAccountPanel } from './delete-account-panel'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DeleteAccountPanel', () => {
  it('explains what is deleted and what is anonymized before final confirmation', async () => {
    const user = userEvent.setup()
    render(<DeleteAccountPanel />)

    await user.click(screen.getByRole('button', { name: 'Delete my account' }))

    expect(screen.getByText(/profile details, posts, comments, applications, connections/i)).toBeVisible()
    expect(screen.getByText(/messages you sent are removed from active conversation history/i)).toBeVisible()
    expect(screen.getByText(/published learning content.*may be retained in anonymized form/i)).toBeVisible()
    expect(screen.getByText(/audit and safety records.*anonymized/i)).toBeVisible()
  })

  it('requires both password re-authentication and exact DELETE confirmation', async () => {
    const user = userEvent.setup()
    render(<DeleteAccountPanel />)
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))

    const finalButton = screen.getByRole('button', { name: 'Permanently delete account' })
    expect(finalButton).toBeDisabled()

    await user.type(screen.getByLabelText('Current password'), 'CorrectPassword123')
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'delete')
    expect(finalButton).toBeDisabled()

    await user.clear(screen.getByLabelText('Type DELETE to confirm'))
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    expect(finalButton).toBeEnabled()
  })

  it('submits the deletion request and leaves the authenticated app after success', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      redirectTo: '/account-deleted',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    render(<DeleteAccountPanel />)
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    await user.type(screen.getByLabelText('Current password'), 'CorrectPassword123')
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(screen.getByRole('button', { name: 'Permanently delete account' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/account/delete', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
    })))
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({
      password: 'CorrectPassword123',
      confirmation: 'DELETE',
    })
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/account-deleted'))
  })

  it('shows safe API errors without losing the confirmation form', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false,
      error: 'Your password could not be verified. Please try again.',
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }))

    render(<DeleteAccountPanel />)
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    await user.type(screen.getByLabelText('Current password'), 'WrongPassword123')
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(screen.getByRole('button', { name: 'Permanently delete account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Your password could not be verified. Please try again.')
    expect(screen.getByRole('button', { name: 'Permanently delete account' })).toBeEnabled()
  })

  it('shows exactly what will be deleted and what stays, per organization, from the member’s data', async () => {
    const user = userEvent.setup()
    const plan = planAccountDeletion({
      posts: 12,
      comments: 3,
      reactions: 40,
      personalJobs: 2,
      personalEvents: 1,
      personalCourses: 1,
      personalCoursesWithLearners: 1,
      upcomingEventsWithRegistrations: 1,
      paidTicketsToRefund: 2,
      organizations: [
        { companyId: 'c1', name: 'Blue Fleet', slug: 'blue-fleet', role: 'owner', otherActiveManagers: 2, jobs: 4, events: 0, courses: 0 },
        { companyId: 'c2', name: 'Harbour Academy', slug: 'harbour-academy', role: 'administrator', otherActiveManagers: 0, jobs: 3, events: 1, courses: 2 },
      ],
      unpaidEarnings: [{ currency: 'INR', amountMinor: 125000 }],
      autoRenewPlans: [{ planLabel: 'Creator Pro', subjectName: null }],
    })
    render(<DeleteAccountPanel plan={plan} />)
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))

    expect(screen.getByText('Your 12 posts, 3 comments and 40 reactions')).toBeVisible()
    expect(screen.getByText('2 jobs you posted personally')).toBeVisible()
    expect(screen.getByText('People who already enrolled in your course keep access to it')).toBeVisible()
    expect(screen.getByText(/1 upcoming event with registrations will be cancelled and attendees told; 2 paid tickets will be refunded in full/)).toBeVisible()
    expect(screen.getByText('Blue Fleet')).toBeVisible()
    expect(screen.getByText('Stays — managed by 2 others')).toBeVisible()
    expect(screen.getByText('Harbour Academy')).toBeVisible()
    expect(screen.getByText('Page stays; its 3 jobs, 1 event and 2 courses will be removed')).toBeVisible()
    expect(screen.getByText(/₹1,250 in earnings that hasn’t been paid out yet/)).toBeVisible()
    expect(screen.getByText(/Auto-renew for Creator Pro will be turned off/)).toBeVisible()
    // The general explanation is replaced by the real plan.
    expect(screen.queryByText(/may be retained in anonymized form so other learners/)).not.toBeInTheDocument()

    // DELETE is still required.
    const finalButton = screen.getByRole('button', { name: 'Permanently delete account' })
    await user.type(screen.getByLabelText('Current password'), 'CorrectPassword123')
    expect(finalButton).toBeDisabled()
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    expect(finalButton).toBeEnabled()
  })

  it('lets a mobile-only member confirm with a texted code instead of a password', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, message: 'We sent a 6-digit code to +91 98765 43210.' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, redirectTo: '/account-deleted' }), { status: 200 }))
    render(<DeleteAccountPanel reauth={{ method: 'phone_code', phoneNumber: '+919876543210' }} />)
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))

    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Text me a code' }))
    expect(await screen.findByText('We sent a 6-digit code to +91 98765 43210.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/account/delete/code')

    const finalButton = screen.getByRole('button', { name: 'Permanently delete account' })
    await user.type(screen.getByLabelText('Code texted to +91 98765 43210'), '123456')
    expect(finalButton).toBeDisabled()
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(finalButton)
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/account-deleted'))
    expect(JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body))).toEqual({ code: '123456', confirmation: 'DELETE' })
  })

  it('asks a Google member to sign in again unless they signed in within 10 minutes', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<DeleteAccountPanel reauth={{ method: 'recent_sign_in', fresh: false }} />)
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    expect(screen.getByRole('link', { name: 'Sign in with Google again' })).toHaveAttribute('href', '/auth/google/start')
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    expect(screen.getByRole('button', { name: 'Permanently delete account' })).toBeDisabled()
    unmount()

    render(<DeleteAccountPanel reauth={{ method: 'recent_sign_in', fresh: true }} />)
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    expect(screen.getByRole('button', { name: 'Permanently delete account' })).toBeEnabled()
  })
})
