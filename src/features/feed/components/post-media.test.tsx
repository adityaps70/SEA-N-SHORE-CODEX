import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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

  it('renders a video inline with native controls and no autoplay', () => {
    const { container } = render(<PostMedia media={videoMedia} authorName="Member A" />)

    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute('src', videoMedia.signedUrl)
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video).toHaveAttribute('aria-label', 'Bridge resource management demonstration')
    expect(video).not.toHaveAttribute('autoplay')
    expect(screen.getByText('Your browser does not support this video.')).toBeInTheDocument()
  })

  it('uses author-aware fallback labels when media has no description', () => {
    const { container, rerender } = render(<PostMedia media={{ ...imageMedia, altText: null }} authorName="Member A" />)
    expect(screen.getByRole('img', { name: "Image attached to Member A's post" })).toBeInTheDocument()

    rerender(<PostMedia media={{ ...videoMedia, altText: null, mimeType: 'video/webm' }} authorName="Member A" />)
    expect(container.querySelector('video')).toHaveAttribute('aria-label', "Video attached to Member A's post")
  })
})
