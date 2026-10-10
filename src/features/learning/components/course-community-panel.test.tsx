import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ link: vi.fn(), open: vi.fn() }))
vi.mock('../course-community-actions', () => ({ linkCourseCommunity: mocks.link, openCourseDiscussion: mocks.open }))

import { CourseCommunityPanel } from './course-community-panel'
import { CourseDiscussButton } from './course-discuss-button'

const courseId = '33333333-3333-4333-8333-333333333333'
const deck = { id: '44444444-4444-4444-8444-444444444444', name: 'Fixture Deck Circle', slug: 'fixture-deck-circle', visibility: 'private' as const }
const bridge = { id: '55555555-5555-4555-8555-555555555555', name: 'Fixture Bridge Room', slug: 'fixture-bridge-room', visibility: 'public' as const }

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('CourseCommunityPanel (learning round C)', () => {
  it('links the live course to a community the trainer runs, and back to none', async () => {
    mocks.link.mockImplementation(async (_course: string, groupId: string | null) => ({ ok: true, groupId }))
    render(<CourseCommunityPanel link={{ liveCourseId: courseId, current: null, options: [deck, bridge] }} />)

    const select = screen.getByLabelText('Community')
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(['None', 'Fixture Deck Circle (private)', 'Fixture Bridge Room'])
    expect(screen.getByRole('button', { name: 'Save community' })).toBeDisabled()
    fireEvent.change(select, { target: { value: deck.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Save community' }))
    await waitFor(() => expect(mocks.link).toHaveBeenCalledWith(courseId, deck.id))
    expect(await screen.findByText(/Community linked/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fixture Deck Circle' })).toHaveAttribute('href', '/community/fixture-deck-circle')

    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save community' }))
    await waitFor(() => expect(mocks.link).toHaveBeenLastCalledWith(courseId, null))
    expect(await screen.findByText('The course is no longer linked to a community.')).toBeInTheDocument()
  })

  it('shows the server’s refusal and a way to start a community when the trainer runs none', async () => {
    mocks.link.mockResolvedValue({ ok: false, error: 'You can link only a community where you are an owner or admin, and that is not archived.' })
    const { unmount } = render(<CourseCommunityPanel link={{ liveCourseId: courseId, current: null, options: [bridge] }} />)
    fireEvent.change(screen.getByLabelText('Community'), { target: { value: bridge.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Save community' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('owner or admin')
    unmount()

    render(<CourseCommunityPanel link={{ liveCourseId: courseId, current: null, options: [] }} />)
    expect(screen.queryByLabelText('Community')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start one' })).toHaveAttribute('href', '/community/new')
  })

  it('keeps showing a linked community the trainer no longer runs', () => {
    render(<CourseCommunityPanel link={{ liveCourseId: courseId, current: { ...bridge, archived: false }, options: [deck] }} />)
    expect(screen.getByLabelText('Community')).toHaveValue(bridge.id)
    expect(screen.getByRole('option', { name: 'Fixture Bridge Room (you no longer run it)' })).toBeDisabled()
  })
})

describe('CourseDiscussButton (learning round C)', () => {
  it('opens the discussion through the server and shows a plain message when it can’t', async () => {
    mocks.open.mockResolvedValue({ ok: false, error: 'A community admin removed you from this course’s community, so it can’t add you back. Contact the trainer if you think this is a mistake.' })
    render(<CourseDiscussButton courseId={courseId} communityName="Fixture Deck Circle" />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask the trainer / Discuss' }))
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(courseId))
    expect(await screen.findByRole('alert')).toHaveTextContent('A community admin removed you')
  })
})
