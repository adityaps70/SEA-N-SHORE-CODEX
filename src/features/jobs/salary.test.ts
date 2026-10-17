import { describe, expect, it } from 'vitest'
import { formatSalaryRange } from './salary'

const salary = (salaryMin: number | null, salaryMax: number | null, salaryCurrency: string | null, salaryPeriod: 'day' | 'month' | 'year' | null) =>
  formatSalaryRange({ salaryMin, salaryMax, salaryCurrency, salaryPeriod })

describe('formatSalaryRange (Round H, H7)', () => {
  it('shows annual INR of a lakh or more in LPA, with decimals when needed', () => {
    expect(salary(3_900_000, 5_000_000, 'INR', 'year')).toBe('₹39–50 LPA')
    expect(salary(450_000, 600_000, 'INR', 'year')).toBe('₹4.5–6 LPA')
    expect(salary(1_234_567, null, 'INR', 'year')).toBe('From ₹12.35 LPA')
    expect(salary(450_000, 450_001, 'INR', 'year')).toBe('₹4.5 LPA')
  })

  it('uses Indian grouping for monthly, daily and sub-lakh INR amounts', () => {
    expect(salary(39_000, 50_000, 'INR', 'month')).toBe('₹39,000–50,000/month')
    expect(salary(39_000, 39_000, 'INR', 'month')).toBe('₹39,000/month')
    expect(salary(3_900_000, null, 'INR', 'month')).toBe('From ₹39,00,000/month')
    expect(salary(90_000, null, 'INR', 'year')).toBe('From ₹90,000/year')
    expect(salary(2_500, 3_000, 'inr', 'day')).toBe('₹2,500–3,000/day')
  })

  it('formats USD and other currencies with the symbol once', () => {
    expect(salary(240, 240, 'USD', 'day')).toBe('$240/day')
    expect(salary(6_000, 8_000, 'USD', 'month')).toBe('$6,000–8,000/month')
    expect(salary(5_500, 7_250.5, 'EUR', 'month')).toBe('€5,500–7,250.50/month')
    expect(salary(9_000, 12_000, 'AED', 'month')).toBe('AED\u00a09,000–12,000/month')
  })

  it('handles min only, max only, min equal to max and no salary', () => {
    expect(salary(7_000, null, 'USD', 'month')).toBe('From $7,000/month')
    expect(salary(null, 9_000, 'USD', 'month')).toBe('Up to $9,000/month')
    expect(salary(240, 240, 'USD', 'day')).toBe('$240/day')
    expect(salary(null, null, 'USD', 'month')).toBeNull()
  })

  it('orders a reversed range, defaults a blank currency to USD and keeps unknown currency text', () => {
    expect(salary(8_000, 6_000, 'USD', null)).toBe('$6,000–8,000')
    expect(salary(6_000, 8_000, null, 'month')).toBe('$6,000–8,000/month')
    expect(salary(39_000, null, 'Rs', 'month')).toBe('From ₹39,000/month')
    expect(salary(1_000, 2_000, 'Credits', 'month')).toBe('Credits 1,000–2,000/month')
  })
})
