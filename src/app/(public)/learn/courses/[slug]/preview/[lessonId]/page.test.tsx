import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPreviewLesson: vi.fn(),
  createMediaReadUrl: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@/features/learning/public-course-repository', () => ({ publicCourseRepository: { getPreviewLesson: mocks.getPreviewLesson } }))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: mocks.createMediaReadUrl }))

import CoursePreviewPage, { generateMetadata } from './page'

const lessonId = '66666666-6666-4666-8666-666666666666'
const imagePath = 'learning/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/lesson_image/33333333-3333-4333-8333-333333333333.png'

function preview(lesson: Record<string, unknown> = {}) {
  return {
    course: { id: 'course-1', slug: 'sire-2-readiness', title: 'SIRE 2.0 readiness' },
    lesson: {
      id: lessonId,
      title: 'Why SIRE 2.0 changed',
      lessonType: 'video',
      summary: 'What inspectors now look for.',
      articleBody: null,
      articleFormat: 'plain',
      assetPath: 'learning/courses/sire-2/why.mp4',
      externalUrl: null,
      embedKind: null,
      durationSeconds: 420,
      isDownloadable: false,
      captionPath: null,
      ...lesson,
    },
  }
}

function params(id = lessonId) {
  return { params: Promise.resolve({ slug: 'sire-2-readiness', lessonId: id }) }
}

describe('/learn/courses/[slug]/preview/[lessonId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createMediaReadUrl.mockImplementation(async (path: string) => `https://bucket.example/${path}?signed`)
  })

  it('plays a free-preview video for anyone, with nothing recorded, and an Enrol to continue prompt', async () => {
    mocks.getPreviewLesson.mockResolvedValue(preview())

    const { container } = render(await CoursePreviewPage(params()))

    expect(mocks.getPreviewLesson).toHaveBeenCalledWith('sire-2-readiness', lessonId)
    expect(screen.getByRole('heading', { name: 'Why SIRE 2.0 changed' })).toBeInTheDocument()
    expect(screen.getByText('Free preview')).toBeInTheDocument()
    // A plain video element: no resume beacon, progress or completion controls.
    expect(container.querySelector('video')).toHaveAttribute('src', 'https://bucket.example/learning/courses/sire-2/why.mp4?signed')
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'SIRE 2.0 readiness' })).toHaveAttribute('href', '/learn/courses/sire-2-readiness')
    const enrol = screen.getByRole('region', { name: 'Enrol to continue' })
    expect(enrol).toHaveTextContent('Enrol to continue')
    expect(screen.getByRole('link', { name: 'See enrolment options' })).toHaveAttribute('href', '/learn/courses/sire-2-readiness#course-access')
  })

  it('renders a rich-text article sanitized, with its images signed', async () => {
    mocks.getPreviewLesson.mockResolvedValue(preview({
      lessonType: 'article',
      assetPath: null,
      articleFormat: 'html',
      articleBody: `<h2>Before boarding</h2><p>Check the <strong>plan</strong>.</p><img data-storage-path="${imagePath}"><script>alert(1)</script>`,
    }))

    const { container } = render(await CoursePreviewPage(params()))

    expect(screen.getByRole('heading', { name: 'Before boarding' })).toBeInTheDocument()
    expect(container.querySelector('.lesson-article img')).toHaveAttribute('src', `https://bucket.example/${imagePath}?signed`)
    expect(container.querySelector('script')).toBeNull()
  })

  it('keeps an older plain-text article exactly as written', async () => {
    mocks.getPreviewLesson.mockResolvedValue(preview({ lessonType: 'article', assetPath: null, articleBody: 'Line one\n<b>literal</b>' }))

    render(await CoursePreviewPage(params()))

    expect(screen.getByText(/<b>literal<\/b>/)).toBeInTheDocument()
  })

  it('is a 404 for anything that is not a free preview of a public course, and never looks up a malformed id', async () => {
    mocks.getPreviewLesson.mockResolvedValue(null)
    await expect(CoursePreviewPage(params())).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(generateMetadata(params())).resolves.toEqual({ title: 'Preview not found', robots: { index: false } })

    mocks.getPreviewLesson.mockClear()
    await expect(CoursePreviewPage(params('not-a-uuid'))).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.getPreviewLesson).not.toHaveBeenCalled()
  })

  it('keeps previews out of search results, pointing search engines at the course page', async () => {
    mocks.getPreviewLesson.mockResolvedValue(preview())
    await expect(generateMetadata(params())).resolves.toEqual({
      title: 'Why SIRE 2.0 changed · SIRE 2.0 readiness',
      robots: { index: false, follow: true },
      alternates: { canonical: '/learn/courses/sire-2-readiness' },
    })
  })
})
