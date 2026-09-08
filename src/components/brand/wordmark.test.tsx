import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Wordmark } from './wordmark'

afterEach(() => cleanup())

describe('Wordmark', () => {
  it('uses the uploaded Sea N Shore master logo asset', () => {
    render(<Wordmark />)

    const link = screen.getByRole('link', { name: /sea n shore home/i })
    expect(link).toBeInTheDocument()

    const logo = screen.getByRole('img', { name: /sea and shore global shipping community/i })
    expect(logo).toHaveAttribute('src', '/brand/sea-and-shore-master-logo.svg')

    expect(screen.queryByText('⚓')).not.toBeInTheDocument()
    expect(screen.queryByText('Global maritime network')).not.toBeInTheDocument()
  })

  it('uses a cropped original-artwork compact lockup', () => {
    render(<Wordmark compact />)

    const logo = screen.getByRole('img', { name: /sea and shore global shipping community/i })
    expect(logo).toHaveAttribute('src', '/brand/sea-n-shore-compact-lockup.webp')
    expect(screen.queryByText('SEA N SHORE')).not.toBeInTheDocument()
    expect(screen.queryByText('Global Shipping Community')).not.toBeInTheDocument()
  })
})
