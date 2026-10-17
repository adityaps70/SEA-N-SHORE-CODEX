import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TimeZoneCombobox } from './time-zone-combobox'

function Harness({ initial = 'Asia/Kolkata' }: { initial?: string }) {
  const [zone, setZone] = useState(initial)
  return (
    <>
      <TimeZoneCombobox value={zone} onChange={setZone} />
      <p data-testid="stored">{zone}</p>
    </>
  )
}

describe('TimeZoneCombobox (Round H, H7)', () => {
  afterEach(() => cleanup())

  it('shows the friendly label and stores the IANA name of the chosen zone', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox', { name: 'Time zone' })
    expect((input as HTMLInputElement).value).toMatch(/^Kolkata, India \(UTC\+5:30\)$/)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'dubai' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Dubai, United Arab Emirates/ }))
    expect(screen.getByTestId('stored')).toHaveTextContent('Asia/Dubai')
    expect((input as HTMLInputElement).value).toMatch(/^Dubai, United Arab Emirates/)
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('works from the keyboard and restores the label on Escape', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox', { name: 'Time zone' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'singapore' } })
    expect(input).toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('stored')).toHaveTextContent('Asia/Singapore')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'tokyo' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByTestId('stored')).toHaveTextContent('Asia/Singapore')
    expect((input as HTMLInputElement).value).toMatch(/^Singapore/)
  })

  it('says so when nothing matches', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox', { name: 'Time zone' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'atlantis' } })
    expect(screen.getByRole('status')).toHaveTextContent('No time zone matches')
  })
})
