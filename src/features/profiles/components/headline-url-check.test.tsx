import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { HEADLINE_URL_MESSAGE } from '../headline'
import { HeadlineUrlCheck } from './headline-url-check'

describe('HeadlineUrlCheck (Round H, H7)', () => {
  afterEach(() => cleanup())

  it('flags a web address as the whole headline when the member leaves the field, and clears once fixed', () => {
    render(
      <>
        <label htmlFor="headline">Headline</label>
        <input id="headline" name="headline" />
        <HeadlineUrlCheck inputId="headline" />
      </>,
    )
    const input = screen.getByLabelText('Headline') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'https://example.com' } })
    expect(screen.queryByText(HEADLINE_URL_MESSAGE)).not.toBeInTheDocument()
    fireEvent.blur(input)
    expect(screen.getByText(HEADLINE_URL_MESSAGE)).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid')
    expect(input.validationMessage || input.validity.customError).toBeTruthy()
    fireEvent.input(input, { target: { value: 'Second Officer' } })
    expect(screen.queryByText(HEADLINE_URL_MESSAGE)).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-invalid')
  })
})
