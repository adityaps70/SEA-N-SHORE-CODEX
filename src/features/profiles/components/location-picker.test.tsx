import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LocationPicker } from './location-picker'

function renderPicker(defaultValue = '') {
  render(
    <form aria-label="Profile">
      <label htmlFor="loc">Location</label>
      <LocationPicker id="loc" defaultValue={defaultValue} />
    </form>,
  )
  return screen.getByRole('combobox', { name: 'Location' })
}

describe('LocationPicker (Round H, H7)', () => {
  afterEach(() => cleanup())

  it('suggests cities as the member types and stores "City, Country"', () => {
    const input = renderPicker()
    fireEvent.change(input, { target: { value: 'mumb' } })
    expect(input).toHaveAttribute('aria-expanded', 'true')
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Mumbai, India' }))
    expect(input).toHaveValue('Mumbai, India')
    expect(input).toHaveAttribute('name', 'location')
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('works from the keyboard: arrows move, Enter chooses, Escape closes', () => {
    const input = renderPicker()
    fireEvent.change(input, { target: { value: 'piraeus' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const first = screen.getByRole('option', { name: 'Piraeus, Greece' })
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', first.id)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('Piraeus, Greece')

    fireEvent.change(input, { target: { value: 'rott' } })
    expect(input).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('offers "Other" to keep a place that is not in the list', () => {
    const input = renderPicker()
    fireEvent.change(input, { target: { value: 'Andheri East' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: /Other: type your location/ }))
    expect(input).toHaveValue('Andheri East')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    fireEvent.focus(input)
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps a saved free-text location until the member changes it', () => {
    const input = renderPicker('Somewhere at sea')
    expect(input).toHaveValue('Somewhere at sea')
    expect(screen.getByText(/Your saved location is not in the city list/)).toBeInTheDocument()
    fireEvent.focus(input)
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })
})
