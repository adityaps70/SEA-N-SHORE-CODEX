import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('renders the fallback instead of a broken image', () => {
    render(
      <MediaImage src={BUCKET_URL} alt="Member A profile photo" width={44} height={44} sizes="44px" fallback={<span>MA</span>} />,
    )

    fireEvent.error(screen.getByRole('img', { name: 'Member A profile photo' }))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('MA')).toBeInTheDocument()
  })
})
