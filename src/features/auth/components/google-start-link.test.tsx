import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthMethodLinks } from './auth-method-links'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

function homeScreenApp(on: boolean) {
  Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: on })
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: on ? IPHONE : 'jsdom' })
}

afterEach(() => {
  cleanup()
  homeScreenApp(false)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Continue with Google in the iPhone Home Screen app (Round I, I3)', () => {
  it('stays the plain Google link in a browser', () => {
    homeScreenApp(false)
    render(<AuthMethodLinks intent="sign-in" placement="above" />)
    const link = screen.getByRole('link', { name: /Continue with Google/ })
    expect(link).toHaveAttribute('href', '/auth/google/start?intent=sign-in')
    expect(link).not.toHaveAttribute('aria-expanded')
    expect(fireEvent.click(link)).toBe(true)
  })

  it('explains the Safari window, shows the code and the Google link, and keeps "Continue with email" in reach', async () => {
    homeScreenApp(true)
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Response.json({ status: 'started', authorizeUrl: 'https://auth.example.test/oauth2/authorize?state=s', pairCode: '482 193', expiresInSeconds: 600 })
      }
      return Response.json({ status: 'confirm' })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <>
        <input name="email" aria-label="Email" />
        <AuthMethodLinks intent="sign-in" placement="above" />
      </>,
    )

    const google = screen.getByRole('link', { name: /Continue with Google/ })
    await act(async () => {
      expect(fireEvent.click(google)).toBe(false)
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/app-handoff', expect.objectContaining({ method: 'POST', body: JSON.stringify({ intent: 'sign-in' }) }))
    expect(screen.getByRole('heading', { name: 'Google sign-in in the Home Screen app' })).toHaveFocus()
    expect(screen.getByText(/Google opens in a separate Safari window/)).toBeInTheDocument()
    expect(screen.getByText('Code: 4 8 2 1 9 3')).toHaveClass('sr-only')
    expect(screen.getByText('482 193')).toHaveAttribute('aria-hidden', 'true')
    const open = screen.getByRole('link', { name: 'Open Google sign-in' })
    expect(open).toHaveAttribute('href', 'https://auth.example.test/oauth2/authorize?state=s')
    expect(open).toHaveAttribute('target', '_blank')

    await act(async () => {
      fireEvent.click(open)
      await vi.advanceTimersByTimeAsync(2600)
    })
    expect(screen.getByText(/Google is done. Enter the code in the Safari window/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue with email' }))
    expect(screen.queryByRole('heading', { name: 'Google sign-in in the Home Screen app' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveFocus()
  })

  it('offers email when Google cannot finish in the app', async () => {
    homeScreenApp(true)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'unavailable' }, { status: 503 })))
    render(<AuthMethodLinks intent="sign-up" placement="above" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('link', { name: /Continue with Google/ }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in cannot finish inside the Home Screen app right now.')
    expect(screen.getByRole('button', { name: 'Continue with email' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try Google again' })).toBeInTheDocument()
  })
})
