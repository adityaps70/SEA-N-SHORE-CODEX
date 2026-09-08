import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Wordmark } from './wordmark'

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
})
