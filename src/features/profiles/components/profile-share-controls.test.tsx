import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileShareControls, getPublicProfileUrl } from './profile-share-controls'

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async (value: string) => `data:image/png;base64,QR:${value}`),
  },
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('profile sharing', () => {
  it('builds a canonical public profile URL without duplicate slashes', () => {
    expect(getPublicProfileUrl('captain-example', 'https://seaandshore.in/')).toBe('https://seaandshore.in/people/captain-example')
    expect(getPublicProfileUrl('captain-example', 'https://staging.example.test')).toBe('https://staging.example.test/people/captain-example')
  })

  it('shares the canonical public Maritime Passport URL', async () => {
    const share = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })

    render(<ProfileShareControls slug="captain-example" siteUrl="https://seaandshore.in" />)
    fireEvent.click(screen.getByRole('button', { name: /share profile/i }))

    await waitFor(() => expect(share).toHaveBeenCalledWith({
      title: 'Sea N Shore Maritime Passport',
      url: 'https://seaandshore.in/people/captain-example',
    }))
  })

  it('opens a real QR panel generated for the canonical public profile URL', async () => {
    render(<ProfileShareControls slug="captain-example" siteUrl="https://seaandshore.in" />)
    fireEvent.click(screen.getByRole('button', { name: /qr profile/i }))

    expect(await screen.findByRole('dialog', { name: /share maritime passport/i })).toBeInTheDocument()
    const qr = await screen.findByRole('img', { name: /qr code for captain-example maritime passport/i })
    expect(qr).toHaveAttribute('src', 'data:image/png;base64,QR:https://seaandshore.in/people/captain-example')
    expect(screen.getByText('https://seaandshore.in/people/captain-example')).toBeInTheDocument()
  })
})
