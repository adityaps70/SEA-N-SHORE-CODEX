import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getLearningMediaReadUrl: vi.fn() }))

vi.mock('../media-actions', () => ({
  createLearningMediaUpload: vi.fn(),
  discardLearningMediaUpload: vi.fn(),
  getLearningMediaReadUrl: mocks.getLearningMediaReadUrl,
}))

import { LearningMediaUploadField } from './learning-media-upload-field'

afterEach(() => cleanup())

const props = {
  courseId: '33333333-3333-4333-8333-333333333333',
  kind: 'course_thumbnail' as const,
  label: 'Course thumbnail',
  inputAriaLabel: 'Course thumbnail file',
  onChange: vi.fn(),
  accept: 'image/jpeg',
  previewType: 'image' as const,
}

describe('LearningMediaUploadField read-only (round E)', () => {
  it('shows the preview with no upload, replace or remove controls', async () => {
    mocks.getLearningMediaReadUrl.mockResolvedValue({ ok: true, url: 'https://signed.example.com/thumb.jpg' })
    render(<LearningMediaUploadField {...props} value="learning/courses/thumb.jpg" readOnly />)
    expect(await screen.findByRole('img', { name: 'Course thumbnail preview' })).toHaveAttribute('src', 'https://signed.example.com/thumb.jpg')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Course thumbnail file')).not.toBeInTheDocument()
  })

  it('says "None." when nothing is attached', async () => {
    render(<LearningMediaUploadField {...props} value={null} readOnly />)
    await waitFor(() => expect(screen.getByText('None.')).toBeInTheDocument())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
