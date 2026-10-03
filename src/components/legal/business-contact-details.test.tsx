import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BUSINESS } from '@/config/business'
import { BusinessContactDetails } from './business-contact-details'

afterEach(() => cleanup())

describe('BusinessContactDetails', () => {
  it('shows the operator, the city line, email, phone and hours while the address is not known', () => {
    render(<BusinessContactDetails />)
    expect(screen.getByText('Beaufort Marine Services LLP')).toBeVisible()
    expect(screen.getByText('Navi Mumbai, Maharashtra, India')).toBeVisible()
    expect(screen.getByText('Location')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'info@beaufortmarine.in' })).toHaveAttribute('href', 'mailto:info@beaufortmarine.in')
    expect(screen.getByRole('link', { name: '+91 85914 63321' })).toHaveAttribute('href', 'tel:+918591463321')
    expect(screen.getByText('Monday to Saturday, 10:00–18:00 IST')).toBeVisible()
    expect(screen.queryByText(/LLPIN|GSTIN/)).not.toBeInTheDocument()
  })

  it('shows the registered address and registration numbers once they are filled in', () => {
    render(
      <BusinessContactDetails
        business={{ ...BUSINESS, registeredAddress: 'Office 12, CBD Belapur, Navi Mumbai 400614', llpin: 'AAA-0000', gstin: '27AAAAA0000A1Z5' }}
      />,
    )
    expect(screen.getByText('Office 12, CBD Belapur, Navi Mumbai 400614')).toBeVisible()
    expect(screen.getByText('Registered address')).toBeInTheDocument()
    expect(screen.queryByText('Navi Mumbai, Maharashtra, India')).not.toBeInTheDocument()
    expect(screen.getByText('LLPIN: AAA-0000 · GSTIN: 27AAAAA0000A1Z5')).toBeVisible()
  })

  it('leaves out contact rows that are empty', () => {
    render(<BusinessContactDetails business={{ ...BUSINESS, phone: { display: '', tel: '' }, supportHours: '' }} />)
    expect(screen.queryByText('Phone')).not.toBeInTheDocument()
    expect(screen.queryByText('Support hours')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'info@beaufortmarine.in' })).toBeVisible()
  })
})
