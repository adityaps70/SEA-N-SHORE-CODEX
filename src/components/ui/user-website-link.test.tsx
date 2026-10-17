import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UserWebsiteLink } from './user-website-link'

describe('UserWebsiteLink (Round H, H7)', () => {
  afterEach(() => cleanup())

  it('opens a user-entered website in a new tab with nofollow ugc noopener', () => {
    render(<UserWebsiteLink href="example.com">example.com</UserWebsiteLink>)
    const link = screen.getByRole('link', { name: /example\.com\s*\(opens in a new tab\)/ })
    expect(link).toHaveAttribute('href', 'https://example.com/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['nofollow', 'ugc', 'noopener']))
  })

  it('shows unsafe values as plain text', () => {
    render(<UserWebsiteLink href="javascript:alert(1)">bad</UserWebsiteLink>)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('bad')).toBeInTheDocument()
  })
})
