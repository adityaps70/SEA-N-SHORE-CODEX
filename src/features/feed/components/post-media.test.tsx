import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { imageConfigDefault } from 'next/dist/shared/lib/image-config'
import { ImageConfigContext } from 'next/dist/shared/lib/image-config-context.shared-runtime'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import nextConfig from '../../../../next.config'
import type { FeedMedia, FeedPhotoTag } from '../types'
import { PostMedia } from './post-media'

/** Renders under the real `images` settings of next.config.ts, as the app does. */
function renderWithImageConfig(ui: ReactNode) {
  return render(
    <ImageConfigContext.Provider value={{ ...imageConfigDefault, ...nextConfig.images } as typeof imageConfigDefault}>
      {ui}
    </ImageConfigContext.Provider>,
  )
}

const mocks = vi.hoisted(() => ({
  renderPdfPage: vi.fn(async () => ({ width: 842, height: 595 })),
  removeMyPhotoTag: vi.fn<(input: { postId: string; mediaId: string; profileId?: string }) => Promise<{ ok: true } | { ok: false; error: string }>>(async () => ({ ok: true })),
}))

vi.mock('../pdf-page-renderer', () => ({
  renderPdfPage: mocks.renderPdfPage,
}))

vi.mock('../photo-tag-actions', () => ({ removeMyPhotoTag: mocks.removeMyPhotoTag }))

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
  mocks.removeMyPhotoTag.mockResolvedValue({ ok: true })
})

afterEach(() => cleanup())

const BUCKET_URL = 'https://sea-n-shore-staging-310356785722-media.s3.ap-south-1.amazonaws.com/member/post/photo.jpg?X-Amz-Signature=abc'

describe('PostMedia', () => {
  it('serves media-bucket photos resized through the image optimizer at quality 90, sized to the post column', () => {
    renderWithImageConfig(<PostMedia media={{ ...imageMedia, signedUrl: BUCKET_URL }} authorName="Member A" />)

    const image = screen.getByRole('img', { name: 'Portrait of a vessel deck inspection' })
    expect(image.getAttribute('src')).toMatch(/^\/_next\/image\?url=https%3A%2F%2Fsea-n-shore-staging-310356785722-media/)
    expect(image.getAttribute('srcset')).toContain('&w=640&q=90 640w')
    expect(image.getAttribute('srcset')).not.toContain('q=75')
    expect(image).toHaveAttribute('sizes', '(max-width: 768px) 100vw, 640px')
    expect(image).toHaveAttribute('loading', 'lazy')
  })

  it('asks for quality 90 for grid photos and the lightbox too', () => {
    const gallery = [0, 1].map((index) => ({
      ...imageMedia,
      storagePath: `member/post/photo-${index}.jpg`,
      signedUrl: BUCKET_URL.replace('photo.jpg', `photo-${index}.jpg`),
      altText: `Photo ${index}`,
      position: index,
    }))
    renderWithImageConfig(<PostMedia media={gallery} authorName="Member A" />)

    for (const name of ['Photo 0', 'Photo 1']) {
      expect(screen.getByRole('img', { name }).getAttribute('srcset')).toContain('q=90')
    }

    fireEvent.click(screen.getByRole('button', { name: 'Open photo 1 of 2' }))

    const dialog = screen.getByRole('dialog', { name: 'Photo 1 of 2' })
    expect(within(dialog).getByRole('img', { name: 'Photo 0' }).getAttribute('srcset')).toContain('q=90')
    expect(within(dialog).getByRole('img', { name: 'Photo 0' }).getAttribute('src')).toContain('q=90')
  })

  it('loads the first photo of the lead post eagerly with high priority and later photos lazily', () => {
    const gallery = [0, 1, 2].map((index) => ({
      ...imageMedia,
      storagePath: `member/post/photo-${index}.jpg`,
      signedUrl: `https://media.example/photo-${index}.jpg`,
      altText: `Photo ${index}`,
      position: index,
    }))
    render(<PostMedia media={gallery} authorName="Member A" loading="eager" fetchPriority="high" />)

    expect(screen.getByRole('img', { name: 'Photo 0' })).toHaveAttribute('loading', 'eager')
    expect(screen.getByRole('img', { name: 'Photo 0' })).toHaveAttribute('fetchpriority', 'high')
    expect(screen.getByRole('img', { name: 'Photo 1' })).toHaveAttribute('loading', 'lazy')
    expect(screen.getByRole('img', { name: 'Photo 1' })).not.toHaveAttribute('fetchpriority')
    expect(screen.getByRole('img', { name: 'Photo 2' })).toHaveAttribute('loading', 'lazy')
  })

  it('keeps photos below the first screen lazy by default', () => {
    render(<PostMedia media={imageMedia} authorName="Member A" />)

    const image = screen.getByRole('img', { name: 'Portrait of a vessel deck inspection' })
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).not.toHaveAttribute('fetchpriority')
  })

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

describe('PostMedia edge to edge on phones', () => {
  const photo: FeedMedia = { storagePath: 'p/1.webp', mimeType: 'image/webp', altText: 'Deck drill', signedUrl: 'https://signed.example/1.webp' }

  it('bleeds a single photo, galleries and video to the screen edges only when flush', () => {
    const { rerender, container } = render(<PostMedia media={photo} authorName="Rinki" flush />)
    const single = screen.getByRole('button')
    expect(single).toHaveClass('max-sm:-mx-4', 'sm:max-md:-mx-5', 'max-md:rounded-none', 'max-md:border-x-0', 'max-sm:w-[calc(100%+2rem)]', 'rounded-2xl')

    rerender(<PostMedia media={[photo, { ...photo, storagePath: 'p/2.webp' }]} authorName="Rinki" flush />)
    expect(container.querySelector('.grid')).toHaveClass('max-sm:-mx-4', 'max-md:rounded-none')

    rerender(<PostMedia media={{ ...photo, mimeType: 'video/mp4', signedUrl: 'https://signed.example/v.mp4' }} authorName="Rinki" flush />)
    expect(container.querySelector('video')?.parentElement).toHaveClass('max-sm:-mx-4', 'max-md:rounded-none')

    rerender(<PostMedia media={photo} authorName="Rinki" />)
    expect(screen.getByRole('button')).not.toHaveClass('max-sm:-mx-4')
  })
})

describe('PostMedia lightbox: people tagged in photos (round 9B)', () => {
  const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const mediaOne = '66666666-6666-4666-8666-666666666666'
  const mediaTwo = '77777777-7777-4777-8777-777777777777'
  const photos: FeedMedia[] = [
    { id: mediaOne, storagePath: 'p/1.jpg', mimeType: 'image/jpeg', altText: 'Deck one', signedUrl: 'https://media.example/1.jpg', position: 0 },
    { id: mediaTwo, storagePath: 'p/2.jpg', mimeType: 'image/jpeg', altText: 'Deck two', signedUrl: 'https://media.example/2.jpg', position: 1 },
  ]
  const priya: FeedPhotoTag = { mediaId: mediaOne, profileId: '22222222-2222-4222-8222-222222222222', slug: 'priya-nair', fullName: 'Priya Nair', avatarUrl: null }
  const arjun: FeedPhotoTag = { mediaId: mediaOne, profileId: '33333333-3333-4333-8333-333333333333', slug: 'arjun-mehta', fullName: 'Arjun Mehta', avatarUrl: null }
  const lee: FeedPhotoTag = { mediaId: mediaTwo, profileId: '44444444-4444-4444-8444-444444444444', slug: 'officer-lee', fullName: 'Officer Lee', avatarUrl: null }

  it('opens the lightbox for a single photo too (it used to set the index and render nothing)', () => {
    render(<PostMedia media={{ ...photos[0]!, id: mediaOne }} authorName="Member A" postId={postId} photoTags={[priya]} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Deck one' }))
    const dialog = screen.getByRole('dialog', { name: 'Photo 1 of 1' })
    expect(within(dialog).getByRole('img', { name: 'Deck one' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Previous photo' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'People in this photo (1)' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close photo viewer' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a people button with the count for the current photo that toggles the tagged list', () => {
    render(<PostMedia media={photos} authorName="Member A" postId={postId} photoTags={[priya, arjun, lee]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open photo 1 of 2' }))
    const dialog = screen.getByRole('dialog', { name: 'Photo 1 of 2' })

    const people = within(dialog).getByRole('button', { name: 'People in this photo (2)' })
    expect(people.querySelector('svg.lucide-users-round')).toBeInTheDocument()
    expect(people).toHaveAttribute('aria-expanded', 'false')
    expect(within(dialog).queryByRole('region', { name: 'People in this photo' })).not.toBeInTheDocument()

    fireEvent.click(people)
    const panel = within(dialog).getByRole('region', { name: 'People in this photo' })
    expect(within(panel).getByRole('link', { name: 'Priya Nair' })).toHaveAttribute('href', '/people/priya-nair')
    expect(within(panel).getByRole('link', { name: 'Arjun Mehta' })).toHaveAttribute('href', '/people/arjun-mehta')
    expect(within(panel).queryByText('Officer Lee')).not.toBeInTheDocument()
    expect(within(panel).getAllByRole('button', { name: /Remove my tag/ })).toHaveLength(2)

    // Moving to the next photo updates the count; the panel follows the photo.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next photo' }))
    expect(within(dialog).getByRole('button', { name: 'People in this photo (1)' })).toBeInTheDocument()
    expect(within(within(dialog).getByRole('region', { name: 'People in this photo' })).getByRole('link', { name: 'Officer Lee' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'People in this photo (1)' }))
    expect(within(dialog).queryByRole('region', { name: 'People in this photo' })).not.toBeInTheDocument()
  })

  it('removes the viewer’s own tag through the server and hides the row, or explains a refusal inline', async () => {
    mocks.removeMyPhotoTag
      .mockResolvedValueOnce({ ok: false, error: 'You can only remove your own tag.' })
      .mockResolvedValueOnce({ ok: true })
    render(<PostMedia media={photos} authorName="Member A" postId={postId} photoTags={[priya, arjun]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open photo 1 of 2' }))
    const dialog = screen.getByRole('dialog', { name: 'Photo 1 of 2' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'People in this photo (2)' }))
    const panel = within(dialog).getByRole('region', { name: 'People in this photo' })

    fireEvent.click(within(panel).getByRole('button', { name: 'Remove my tag (Arjun Mehta)' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('You can only remove your own tag.')
    expect(mocks.removeMyPhotoTag).toHaveBeenCalledWith({ postId, mediaId: mediaOne, profileId: arjun.profileId })
    expect(within(panel).getByRole('link', { name: 'Arjun Mehta' })).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: 'Remove my tag (Priya Nair)' }))
    await waitFor(() => expect(within(panel).queryByRole('link', { name: 'Priya Nair' })).not.toBeInTheDocument())
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'People in this photo (1)' })).toBeInTheDocument()
  })

  it('hides the people button when the post has no photo tags', () => {
    render(<PostMedia media={photos} authorName="Member A" postId={postId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open photo 1 of 2' }))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /People in this photo/ })).not.toBeInTheDocument()
  })
})
