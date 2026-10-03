import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ startDirectConversationAction: vi.fn(), push: vi.fn() }))

vi.mock('@/features/messaging/actions', () => ({ startDirectConversationAction: mocks.startDirectConversationAction }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }))

import { ApplicantMoreMenu } from './applicant-more-menu'
import { MessageApplicantButton } from './message-applicant-button'

afterEach(() => cleanup())

describe('messaging an applicant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startDirectConversationAction.mockResolvedValue({ ok: true, conversationId: 'conv-1' })
  })

  it('opens the existing conversation flow for a connected applicant', async () => {
    render(<MessageApplicantButton targetProfileId="candidate-1" candidateName="Arjun Kapoor" canMessage />)
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    await waitFor(() => expect(mocks.startDirectConversationAction).toHaveBeenCalledWith('candidate-1'))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/messages/conv-1'))
  })

  it('follows the connections-only rule and says why Message is unavailable', () => {
    render(<MessageApplicantButton targetProfileId="candidate-1" candidateName="Arjun Kapoor" canMessage={false} />)
    const button = screen.getByRole('button', { name: 'Message' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(/Connect with Arjun Kapoor to message them/)
  })

  it('puts profile, Message applicant, CV, DG profile and all applicants in the phone "…" sheet', async () => {
    render(
      <ApplicantMoreMenu
        candidateName="Arjun Kapoor"
        profileHref="/people/arjun"
        message={{ targetProfileId: 'candidate-1', canMessage: true }}
        cvHref="/api/jobs/applications/app-1/cv"
        dgProfileHref="/api/profile-documents/candidate-1/dg"
        applicantsHref="/hiring/jobs/job-1/applicants"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More applicant actions' }))
    const menu = screen.getByRole('menu', { name: 'Actions for Arjun Kapoor' })
    expect(within(menu).getByRole('menuitem', { name: 'View Maritime Profile' })).toHaveAttribute('href', '/people/arjun')
    expect(within(menu).getByRole('menuitem', { name: 'Open CV (PDF)' })).toHaveAttribute('href', '/api/jobs/applications/app-1/cv')
    expect(within(menu).getByRole('menuitem', { name: 'Open DG profile (PDF)' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'All applicants' })).toHaveAttribute('href', '/hiring/jobs/job-1/applicants')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Message applicant' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/messages/conv-1'))
  })

  it('disables Message applicant in the sheet until they are connected', () => {
    render(<ApplicantMoreMenu candidateName="Arjun Kapoor" profileHref={null} message={{ targetProfileId: 'candidate-1', canMessage: false }} cvHref={null} dgProfileHref={null} applicantsHref="/hiring/jobs/job-1/applicants" />)
    fireEvent.click(screen.getByRole('button', { name: 'More applicant actions' }))
    expect(screen.getByRole('menuitem', { name: /Message applicant/ })).toBeDisabled()
    expect(screen.getByText(/Messages are open to accepted connections only/)).toBeInTheDocument()
  })
})
