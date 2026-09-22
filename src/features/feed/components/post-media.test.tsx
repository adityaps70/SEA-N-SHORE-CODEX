import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FeedMedia } from '../types'
import { PostMedia } from './post-media'

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

  it('renders a PDF as a paged document carousel with previous and next controls', () => {
    render(<PostMedia media={pdfMedia} authorName="Member A" />)

    expect(screen.getByText('SIRE-2-readiness-guide.pdf')).toBeInTheDocument()
    expect(screen.getByText('1 / 12')).toBeInTheDocument()
    const frame = screen.getByTitle('SIRE-2-readiness-guide.pdf page 1')
    expect(frame).toHaveAttribute('src', expect.stringContaining('#page=1'))
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    expect(screen.getByText('2 / 12')).toBeInTheDocument()
    expect(screen.getByTitle('SIRE-2-readiness-guide.pdf page 2')).toHaveAttribute('src', expect.stringContaining('#page=2'))
  })

  it('uses author-aware fallback labels when media has no description', () => {
    const { container, rerender } = render(<PostMedia media={{ ...imageMedia, altText: null }} authorName="Member A" />)
    expect(screen.getByRole('img', { name: "Image attached to Member A's post" })).toBeInTheDocument()

    rerender(<PostMedia media={{ ...videoMedia, altText: null, mimeType: 'video/webm' }} authorName="Member A" />)
    expect(container.querySelector('video')).toHaveAttribute('aria-label', "Video attached to Member A's post")
  })
})
