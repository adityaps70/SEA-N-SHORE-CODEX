import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}))

import { classifyRouteError, RouteErrorView } from './route-error-view'
import { OAuthErrorNotice, oauthErrorMessage } from './oauth-error-notice'
import { NotFoundView } from './not-found-view'

afterEach(() => cleanup())

describe('RouteErrorView', () => {
  it('explains the failure, offers retry, reload and a way out, and shows a support reference', () => {
    const retry = vi.fn()
    const error = Object.assign(new Error('boom'), { digest: 'abc123' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<RouteErrorView error={error} retry={retry} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong while loading this page.')
    expect(screen.getByText(/Your account and data have not been changed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/home')
    expect(screen.getByRole('link', { name: 'Get help' })).toHaveAttribute('href', '/help')
    expect(screen.getByText('abc123')).toBeInTheDocument()
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
  })

  it('classifies stale deployments and lost connections', () => {
    expect(classifyRouteError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe('stale')
    expect(classifyRouteError(new Error('x'), false)).toBe('offline')
    expect(classifyRouteError(new Error('x'), true)).toBe('general')
  })
})

describe('OAuthErrorNotice', () => {
  it('shows a plain message for Google sign-in failures instead of ignoring them', () => {
    render(<OAuthErrorNotice code="exchange" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in could not be completed')
    expect(oauthErrorMessage('unknown-code')).toMatch(/Google sign-in could not be completed/)
    expect(oauthErrorMessage(undefined)).toBeNull()
  })
})

describe('NotFoundView', () => {
  it('offers next steps', () => {
    render(<NotFoundView title="Gone" body="Moved." primary={{ href: '/home', label: 'Go to Home' }} links={[{ href: '/help', label: 'Get help' }]} />)
    expect(screen.getByRole('heading', { name: 'Gone' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get help' })).toHaveAttribute('href', '/help')
  })
})
