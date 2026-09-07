import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Wordmark } from './wordmark'

describe('Wordmark', () => {
  it('renders the official Sea and Shore logo', () => {
    render(<Wordmark />)

    expect(screen.getByRole('img', { name: /sea and shore global shipping community/i })).toBeInTheDocument()
  })
})
