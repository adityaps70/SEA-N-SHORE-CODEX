import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LegacyTestLinkPage from './page'

describe('/email/legacy/test-link', () => {
  it('says it is a test link and offers nothing to claim or unsubscribe', () => {
    render(<LegacyTestLinkPage />)
    expect(screen.getByRole('heading', { name: 'This is a test link' })).toBeInTheDocument()
    expect(screen.getByText(/Nothing was claimed and nothing was changed/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
