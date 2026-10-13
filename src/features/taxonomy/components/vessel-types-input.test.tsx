import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VesselTypesInput } from './vessel-types-input'

afterEach(() => cleanup())

function hiddenValue(container: HTMLElement) {
  return (container.querySelector('input[type=hidden][name=vesselTypes]') as HTMLInputElement).value
}

describe('VesselTypesInput', () => {
  it('adds picked or typed types as chips, removes them, and posts one comma list', () => {
    const { container } = render(<VesselTypesInput name="vesselTypes" label="Vessel types" defaultValue="Oil Tanker" inputClassName="" />)
    const input = screen.getByRole('combobox', { name: 'Vessel types' })
    expect(input).toHaveAttribute('list')
    expect(container.querySelector('datalist option[value="LNG Carrier"]')).not.toBeNull()

    fireEvent.change(input, { target: { value: 'LNG Carrier' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'oil tanker' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'Hovercraft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to vessel types' }))
    expect(hiddenValue(container)).toBe('Oil Tanker, LNG Carrier, Hovercraft')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Oil Tanker' }))
    expect(hiddenValue(container)).toBe('LNG Carrier, Hovercraft')
  })
})
