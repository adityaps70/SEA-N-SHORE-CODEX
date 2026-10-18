import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NameCaseSuggestion } from './name-case-suggestion'

function Form({ initial = '' }: { initial?: string }) {
  return (
    <form>
      <label htmlFor="full-name">Full name</label>
      <input id="full-name" name="fullName" defaultValue={initial} />
      <NameCaseSuggestion inputId="full-name" />
    </form>
  )
}

describe('NameCaseSuggestion (Round H, H7)', () => {
  afterEach(() => cleanup())

  it('offers the fixed name for an ALL CAPS name and applies it on request', () => {
    render(<Form initial="PLACEHOLDER MEMBER" />)
    expect(screen.getByText(/Did you mean/)).toHaveTextContent('Did you mean Placeholder Member?')
    fireEvent.click(screen.getByRole('button', { name: 'Use Placeholder Member' }))
    expect(screen.getByLabelText('Full name')).toHaveValue('Placeholder Member')
    expect(screen.queryByText(/Did you mean/)).not.toBeInTheDocument()
  })

  it('suggests after the member leaves an all-lowercase name, and not for a mixed-case one', () => {
    render(<Form />)
    const input = screen.getByLabelText('Full name')
    fireEvent.input(input, { target: { value: 'placeholder member' } })
    expect(screen.queryByText(/Did you mean/)).not.toBeInTheDocument()
    fireEvent.blur(input)
    expect(screen.getByRole('button', { name: 'Use Placeholder Member' })).toBeInTheDocument()
    fireEvent.input(input, { target: { value: 'Placeholder Member' } })
    expect(screen.queryByText(/Did you mean/)).not.toBeInTheDocument()
  })
})
