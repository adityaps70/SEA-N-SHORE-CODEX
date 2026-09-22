import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedMedia } from '../types'
import { PostMedia } from './post-media'

const mocks = vi.hoisted(() => ({
  renderPdfPage: vi.fn(async () => ({ width: 842, height: 595 })),
}))

vi.mock('../pdf-page-renderer', () => ({
  renderPdfPage: mocks.renderPdfPage,
}))

const imageMedia: FeedMedia = {
  storagePath: 'member/post/photo.jpg',
  mimeType: 'image/jpeg',
  altText: 'Portrait of a vessel deck inspection',
  signedUrl: 'https://media.example/photo.jpg',
}

const videoMedia: FeedMedia = {
  storagePath: 'member/post/bridge.mp4',
  mimeType: 'video/mp4',
  altText: 'Bridge resource management demonstration',
  signedUrl: 'https://media.example/bridge.mp4',
}

const pdfMedia: FeedMedia = {
  storagePath: 'member/post/readiness.pdf',
  mimeType: 'application/pdf',
  altText: null,
  signedUrl: 'https://media.example/readiness.pdf',
  fileName: 'SIRE-2-readiness-guide.pdf',
  pageCount: 12,
  position: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.renderPdfPage.mockResolvedValue({ width: 842, height: 595 })
})

afterEach(() => cleanup())

describe('PostMedia', () => {
  it('renders portrait images at full post width with natural height and no viewport-height cap', () => {
    const { container } = render(<PostMedia media={imageMedia} authorName="Member A" />)

    const image = screen.getByRole('img', { name: 'Portrait of a vessel deck inspection' })
    expect(image).toHaveAttribute('src', imageMedia.signedUrl)
    expect(image).toHaveClass('h-auto')
    expect(image).toHaveClass('w-full')
    expect(image).toHaveClass('object-contain')
    expect(image).not.toHaveClass('max-h-[80vh]')
    expect(container.innerHTML).not.toContain('aspect-[16/9]')
    expect(container.innerHTML).not.toContain('object-cover')
  })

  it('renders a muted inline video with native controls ready for visibility-driven autoplay', () => {
    const { container } = render(<PostMedia media={videoMedia} authorName="Member A" />)

    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute('src', videoMedia.signedUrl)
    expect(video).toHaveAttribute('controls')
    expect(video?.muted).toBe(true)
    expect(video).toHaveAttribute('playsinline')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video).toHaveAttribute('aria-label', 'Bridge resource management demonstration')
    expect(screen.getByText('Your browser does not support this video.')).toBeInTheDocument()
  })

  it('renders multiple photos in a LinkedIn-style gallery and exposes the overflow count', () => {
    const photos: FeedMedia[] = Array.from({ length: 6 }, (_, index) => ({
      ...imageMedia,
      storagePath: `member/post/photo-${index + 1}.jpg`,
      signedUrl: `https://media.example/photo-${index + 1}.jpg`,
      altText: `Deck inspection photo ${index + 1}`,
      position: index,
    }))

    render(<PostMedia media={photos} authorName="Member A" />)

    expect(screen.getAllByRole('img')).toHaveLength(4)
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View all 6 photos' })).toBeInTheDocument()
  })

  it('renders the whole document page as an adaptive canvas carousel with no internal PDF viewer', async () => {
    const { container } = render(<PostMedia media={pdfMedia} authorName="Member A" />)

    expect(screen.queryByText('SIRE-2-readiness-guide.pdf')).not.toBeInTheDocument()
    expect(screen.queryByText(/PDF/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /open pdf/i })).not.toBeInTheDocument()
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByText('SIRE-2-readiness-guide · 12 pages')).toBeInTheDocument()
    expect(screen.getByText('1 / 12')).toBeInTheDocument()

    const page = screen.getByRole('img', { name: 'Document page 1 of 12' })
    expect(page.tagName).toBe('CANVAS')
    await waitFor(() => expect(mocks.renderPdfPage).toHaveBeenCalledWith(
      page,
      pdfMedia.signedUrl,
      1,
    ))
    await waitFor(() => expect(screen.getByTestId('document-page-stage')).toHaveStyle({
      aspectRatio: '842 / 595',
    }))
    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))

    expect(screen.getByText('2 / 12')).toBeInTheDocument()
    await waitFor(() => expect(mocks.renderPdfPage).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      pdfMedia.signedUrl,
      2,
    ))
  })

  it('changes document pages with horizontal swipe only and keeps vertical gestures for the feed', async () => {
    render(<PostMedia media={pdfMedia} authorName="Member A" />)
    const stage = screen.getByTestId('document-page-stage')

    fireEvent.touchStart(stage, { touches: [{ clientX: 280, clientY: 200 }] })
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 120, clientY: 210 }] })
    expect(screen.getByText('2 / 12')).toBeInTheDocument()

    fireEvent.touchStart(stage, { touches: [{ clientX: 120, clientY: 200 }] })
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 280, clientY: 205 }] })
    expect(screen.getByText('1 / 12')).toBeInTheDocument()

    fireEvent.touchStart(stage, { touches: [{ clientX: 200, clientY: 100 }] })
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 205, clientY: 260 }] })
    expect(screen.getByText('1 / 12')).toBeInTheDocument()
  })

  it('uses author-aware fallback labels when media has no description', () => {
    const { container, rerender } = render(<PostMedia media={{ ...imageMedia, altText: null }} authorName="Member A" />)
    expect(screen.getByRole('img', { name: "Image attached to Member A's post" })).toBeInTheDocument()

    rerender(<PostMedia media={{ ...videoMedia, altText: null, mimeType: 'video/webm' }} authorName="Member A" />)
    expect(container.querySelector('video')).toHaveAttribute('aria-label', "Video attached to Member A's post")
  })
})
