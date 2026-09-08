import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Wordmark } from './wordmark'

describe('Wordmark', () => {
  it('renders the current Sea N Shore brand lockup without the legacy image asset', () => {
    render(<Wordmark />)

    expect(screen.getByRole('link', { name: /sea n shore home/i })).toBeInTheDocument()
    expect(screen.getByText('Sea N Shore')).toBeInTheDocument()
    expect(screen.getByText('Global maritime network')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
