import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ContactPage from './page'

afterEach(() => cleanup())

describe('/contact', () => {
  it('names the operating business and how to reach it', () => {
    render(<ContactPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Contact us' })).toBeVisible()
    expect(screen.getAllByText(/Beaufort Marine Services LLP/).length).toBeGreaterThan(0)
    expect(screen.getByText('Navi Mumbai, Maharashtra, India')).toBeVisible()
    expect(screen.getAllByRole('link', { name: 'info@beaufortmarine.in' })[0]).toHaveAttribute('href', 'mailto:info@beaufortmarine.in')
    expect(screen.getByRole('link', { name: '+91 85914 63321' })).toHaveAttribute('href', 'tel:+918591463321')
    expect(screen.getAllByText(/Monday to Saturday, 10:00–18:00 IST/).length).toBeGreaterThan(0)
  })

  it('asks for the order ID, gives the reply time and links help, refunds and privacy', () => {
    render(<ContactPage />)
    expect(screen.getByText('order ID')).toBeVisible()
    expect(screen.getByText(/We reply within 2 working days/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help')
    expect(screen.getAllByRole('link', { name: /Refund/ })[0]).toHaveAttribute('href', '/refunds')
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' })[0]).toHaveAttribute('href', '/privacy#your-rights')
    expect(screen.getByRole('heading', { name: 'Grievances and data requests' })).toBeVisible()
  })
})
