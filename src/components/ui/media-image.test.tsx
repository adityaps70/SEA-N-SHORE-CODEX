import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MediaImage } from './media-image'

afterEach(cleanup)

const BUCKET_URL = 'https://sea-n-shore-staging-310356785722-media.s3.ap-south-1.amazonaws.com/profiles/a/avatar.webp?X-Amz-Signature=abc'

describe('MediaImage', () => {
  it('serves media-bucket photos through the image optimizer at the rendered size', () => {
    render(<MediaImage src={BUCKET_URL} alt="Member A profile photo" width={44} height={44} sizes="44px" />)

    const image = screen.getByRole('img', { name: 'Member A profile photo' })
    expect(image.getAttribute('src')).toMatch(/^\/_next\/image\?url=https%3A%2F%2Fsea-n-shore-staging-310356785722-media/)
    expect(image.getAttribute('srcset')).toContain('&w=48&q=75 48w')
    expect(image.getAttribute('srcset')).toContain('&w=96&q=75 96w')
    expect(image).toHaveAttribute('sizes', '44px')
    expect(image).toHaveAttribute('loading', 'lazy')
  })

  it('fills a positioned box when asked to', () => {
    render(
      <span className="relative size-11 overflow-hidden rounded-full">
        <MediaImage src={BUCKET_URL} alt="" fill sizes="44px" className="object-cover" />
      </span>,
    )

    const image = document.querySelector('img')!
    expect(image.style.position).toBe('absolute')
    expect(image).toHaveClass('object-cover')
    expect(image.getAttribute('src')).toMatch(/^\/_next\/image\?url=/)
  })

  it.each([
    ['another https host', 'https://media.example/avatar.webp'],
    ['a first-party API route', '/api/company-logo/22222222-2222-4222-8222-222222222222'],
    ['the message attachment route', '/api/messages/attachments/44444444-4444-4444-8444-444444444444'],
    ['a blob: preview', 'blob:https://seanshore.example/9a2b'],
    ['a data: URL', 'data:image/gif;base64,R0lGODlhAQABAAAAACw='],
  ])('shows %s as it is, like a plain <img>', (_label, src) => {
    render(<MediaImage src={src} alt="photo" width={48} height={48} sizes="48px" />)

    const image = screen.getByRole('img', { name: 'photo' })
    expect(image).toHaveAttribute('src', src)
    expect(image).not.toHaveAttribute('srcset')
  })

  it('loads eagerly with high priority when asked to', () => {
    render(<MediaImage src={BUCKET_URL} alt="Lead photo" width={640} height={480} sizes="100vw" loading="eager" fetchPriority="high" />)

    const image = screen.getByRole('img', { name: 'Lead photo' })
    expect(image).toHaveAttribute('loading', 'eager')
    expect(image).toHaveAttribute('fetchpriority', 'high')
  })

  it('shows the initials underneath a filling photo until it has loaded, then fades the photo in', async () => {
    render(
      <span className="relative grid size-11 place-items-center overflow-hidden rounded-full bg-mist-100">
        <MediaImage src={BUCKET_URL} alt="Member A profile photo" fill sizes="44px" className="object-cover" fallback={<span>MA</span>} />
      </span>,
    )

    const initials = screen.getByText('MA')
    expect(initials.closest('[aria-hidden="true"]')).not.toBeNull()
    const image = screen.getByRole('img', { name: 'Member A profile photo' })
    expect(image).toHaveClass('opacity-0', 'motion-safe:transition-opacity', 'object-cover')

    // next/image reports the load after the image has decoded, so the fade completes a tick later.
    fireEvent.load(image)

    await waitFor(() => expect(image).toHaveClass('opacity-100'))
    expect(image).not.toHaveClass('opacity-0')
    expect(screen.getByText('MA')).toBeInTheDocument()
  })

  it('fades a fixed-size photo in without duplicating its fallback beside it', async () => {
    render(
      <MediaImage src={BUCKET_URL} alt="Member A profile photo" width={48} height={48} sizes="48px" className="size-12 rounded-full" fallback={<span>MA</span>} />,
    )

    expect(screen.queryByText('MA')).not.toBeInTheDocument()
    const image = screen.getByRole('img', { name: 'Member A profile photo' })
    expect(image).toHaveClass('opacity-0')
    fireEvent.load(image)
    await waitFor(() => expect(image).toHaveClass('opacity-100'))
  })

  it('renders the fallback instead of a broken image', () => {
    render(
      <MediaImage src={BUCKET_URL} alt="Member A profile photo" width={44} height={44} sizes="44px" fallback={<span>MA</span>} />,
    )

    fireEvent.error(screen.getByRole('img', { name: 'Member A profile photo' }))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('MA')).toBeInTheDocument()
  })

  it('keeps the initials when a filling photo fails to load', () => {
    render(
      <span className="relative grid size-11 place-items-center overflow-hidden rounded-full bg-mist-100">
        <MediaImage src={BUCKET_URL} alt="Member A profile photo" fill sizes="44px" fallback={<span>MA</span>} />
      </span>,
    )

    fireEvent.error(screen.getByRole('img', { name: 'Member A profile photo' }))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getAllByText('MA')).toHaveLength(1)
  })
})

describe('MediaImage avatar framing', () => {
  it('frames a person photo face-first: covering the box, anchored at the upper middle', () => {
    render(<MediaImage src={BUCKET_URL} alt="Member A profile photo" width={44} height={44} sizes="44px" className="size-11 rounded-full" avatar />)

    const image = screen.getByRole('img', { name: 'Member A profile photo' })
    expect(image).toHaveClass('object-cover', 'object-[50%_25%]', 'size-11', 'rounded-full')
  })

  it('wins over a plain object-cover class from the caller without duplicating it', () => {
    render(<MediaImage src={BUCKET_URL} alt="Member A profile photo" width={44} height={44} sizes="44px" className="object-cover object-center" avatar />)

    const image = screen.getByRole('img', { name: 'Member A profile photo' })
    expect(image.className.split(/\s+/).filter((token) => token === 'object-cover')).toHaveLength(1)
    expect(image).toHaveClass('object-[50%_25%]')
    expect(image).not.toHaveClass('object-center')
  })

  it('leaves covers, logos and post images unframed', () => {
    render(<MediaImage src={BUCKET_URL} alt="Cover photo" width={640} height={160} sizes="640px" className="object-cover" />)

    const image = screen.getByRole('img', { name: 'Cover photo' })
    expect(image).toHaveClass('object-cover')
    expect(image).not.toHaveClass('object-[50%_25%]')
  })
})
