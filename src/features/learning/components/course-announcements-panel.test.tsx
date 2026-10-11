import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn() }))
vi.mock('../course-announcement-actions', () => ({ postCourseAnnouncement: mocks.post }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

import { CourseAnnouncementComposer } from './course-announcement-composer'
import { CourseAnnouncementsPanel } from './course-announcements-panel'

const courseId = '33333333-3333-4333-8333-333333333333'

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('CourseAnnouncementComposer (learning round C)', () => {
  it('sends the title and text and says how many learners it reached', async () => {
    const onPosted = vi.fn()
    mocks.post.mockResolvedValue({ ok: true, announcement: { id: 'a1', courseId, title: 'Live Q&A', body: 'Saturday 10:00.', createdAt: '2026-10-10T10:00:00.000Z', recipientCount: 12 } })
    render(<CourseAnnouncementComposer courseId={courseId} onPosted={onPosted} />)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Live Q&A' } })
    fireEvent.change(screen.getByLabelText('Announcement'), { target: { value: 'Saturday 10:00.' } })
    expect(screen.getByText('8/140 characters')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send to all learners' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(courseId, { title: 'Live Q&A', body: 'Saturday 10:00.' }))
    expect(await screen.findByText('Announcement sent to 12 learners.')).toBeInTheDocument()
    expect(onPosted).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }))
    expect(mocks.refresh).toHaveBeenCalled()
    expect(screen.getByLabelText('Title')).toHaveValue('')
  })

  it('shows the server’s plain messages under each field and keeps what was typed', async () => {
    mocks.post.mockResolvedValue({ ok: false, error: 'Add a title.', fieldErrors: { title: ['Add a title.'], body: ['Write your announcement.'] } })
    render(<CourseAnnouncementComposer courseId={courseId} />)
    fireEvent.change(screen.getByLabelText('Announcement'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to all learners' }))

    expect(await screen.findByText('Add a title.')).toBeInTheDocument()
    expect(screen.getByText('Write your announcement.')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Announcement')).toHaveValue('   ')
  })

  it('shows a refusal such as the daily limit as one message', async () => {
    mocks.post.mockResolvedValue({ ok: false, error: 'You can send up to 3 announcements per course in 24 hours. Please try again later.' })
    render(<CourseAnnouncementComposer courseId={courseId} />)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fourth' } })
    fireEvent.change(screen.getByLabelText('Announcement'), { target: { value: 'Text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to all learners' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 3 announcements per course in 24 hours')
  })
})

describe('CourseAnnouncementsPanel (learning round C)', () => {
  const sent = [
    { id: 'a2', courseId, title: 'Live Q&A', body: 'Saturday.', createdAt: '2026-10-09T10:00:00.000Z', recipientCount: 1 },
    { id: 'a1', courseId, title: 'Welcome', body: 'Hello.', createdAt: '2026-10-01T10:00:00.000Z', recipientCount: 20 },
  ]

  it('lists sent announcements with their recipients and offers the composer while posts remain', () => {
    render(<CourseAnnouncementsPanel data={{ liveCourseId: courseId, announcements: sent, remainingToday: 2 }} />)
    const panel = screen.getByRole('region', { name: 'Announcements' })
    expect(within(panel).getByText(/2 left right now/)).toBeInTheDocument()
    expect(within(panel).getByRole('form', { name: 'New announcement' })).toBeInTheDocument()
    expect(within(panel).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Sent announcements', 'Live Q&A', 'Welcome'])
    expect(within(panel).getByText(/sent to 1 learner$/)).toBeInTheDocument()
    expect(within(panel).getByText(/sent to 20 learners$/)).toBeInTheDocument()
  })

  it('explains the limit instead of the composer once three were sent in a day', () => {
    render(<CourseAnnouncementsPanel data={{ liveCourseId: courseId, announcements: [], remainingToday: 0 }} />)
    expect(screen.queryByRole('form', { name: 'New announcement' })).not.toBeInTheDocument()
    expect(screen.getByText(/You’ve sent 3 announcements in the last 24 hours/)).toBeInTheDocument()
    expect(screen.getByText('Nothing sent yet. Your announcements will be listed here.')).toBeInTheDocument()
  })
})
