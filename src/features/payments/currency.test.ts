import { describe, expect, it } from 'vitest'
import { formatMajorMoney, formatMoney } from './currency'

describe('formatMoney, the site-wide money format (Round H, H7)', () => {
  it('drops zero paise and shows both digits otherwise', () => {
    expect(formatMoney(9900, 'INR')).toBe('₹99')
    expect(formatMoney(9950, 'INR')).toBe('₹99.50')
    expect(formatMoney(9905, 'INR')).toBe('₹99.05')
    expect(formatMoney(5, 'INR')).toBe('₹0.05')
    expect(formatMoney(0, 'INR')).toBe('₹0')
  })

  it('uses Indian grouping for INR', () => {
    expect(formatMoney(12345600, 'INR')).toBe('₹1,23,456')
    expect(formatMoney(12345678, 'INR')).toBe('₹1,23,456.78')
    expect(formatMoney(1000000000, 'INR')).toBe('₹1,00,00,000')
  })

  it('formats USD and other currencies with en-US grouping', () => {
    expect(formatMoney(2000, 'USD')).toBe('$20')
    expect(formatMoney(2550, 'USD')).toBe('$25.50')
    expect(formatMoney(12345600, 'USD')).toBe('$123,456')
    expect(formatMoney(150050, 'EUR')).toBe('€1,500.50')
    expect(formatMoney(99900, 'gbp')).toBe('£999')
    expect(formatMoney(500, 'JPY')).toBe('¥500')
  })

  it('falls back to INR for a missing or invalid code, and keeps the sign', () => {
    expect(formatMoney(9900, '')).toBe('₹99')
    expect(formatMoney(9900, null)).toBe('₹99')
    expect(formatMoney(9900, 'rupees')).toBe('₹99')
    expect(formatMoney(-9950, 'INR')).toBe('-₹99.50')
  })

  it('formats whole major units the same way', () => {
    expect(formatMajorMoney(123456, 'INR')).toBe('₹1,23,456')
    expect(formatMajorMoney(240, 'USD')).toBe('$240')
    expect(formatMajorMoney(99.5, 'INR')).toBe('₹99.50')
  })
})
