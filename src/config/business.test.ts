import { describe, expect, it } from 'vitest'
import {
  BUSINESS,
  OPERATOR_LINE,
  businessAddressLine,
  businessRegistrations,
  grievanceContact,
  operatorLine,
  telHref,
  type BusinessDetails,
} from './business'

const filled: BusinessDetails = {
  ...BUSINESS,
  registeredAddress: 'Office 12, Sector 15, CBD Belapur, Navi Mumbai, Maharashtra 400614, India',
  llpin: 'AAA-0000',
  gstin: '27AAAAA0000A1Z5',
  grievanceOfficer: { name: 'A. Officer', email: 'grievance@example.in', phone: '+91 90000 00000' },
}

describe('business details (the one source of truth for policy pages and footers)', () => {
  it('holds the facts the payment gateway compares with the KYC business', () => {
    expect(BUSINESS.brandName).toBe('Sea N Shore')
    expect(BUSINESS.brandTagline).toBe('Global Shipping Community')
    expect(BUSINESS.legalName).toBe('Beaufort Marine Services LLP')
    expect([BUSINESS.city, BUSINESS.region, BUSINESS.country]).toEqual(['Navi Mumbai', 'Maharashtra', 'India'])
    expect(BUSINESS.email).toBe('info@beaufortmarine.in')
    expect(BUSINESS.phone).toEqual({ display: '+91 85914 63321', tel: '+918591463321' })
    expect(BUSINESS.supportHours).toBe('Monday to Saturday, 10:00–18:00 IST')
  })

  it('never invents the address or registration numbers that are not known yet', () => {
    expect(BUSINESS.registeredAddress).toBe('')
    expect(BUSINESS.llpin).toBe('')
    expect(BUSINESS.gstin).toBe('')
    expect(businessRegistrations()).toEqual([])
  })

  it('shows the city line while the registered address is empty, and the address once filled', () => {
    expect(businessAddressLine()).toBe('Navi Mumbai, Maharashtra, India')
    expect(businessAddressLine({ ...BUSINESS, registeredAddress: '   ' })).toBe('Navi Mumbai, Maharashtra, India')
    expect(businessAddressLine(filled)).toBe(filled.registeredAddress)
    expect(businessRegistrations(filled)).toEqual([{ label: 'LLPIN', value: 'AAA-0000' }, { label: 'GSTIN', value: '27AAAAA0000A1Z5' }])
  })

  it('falls back to the support email for grievances until an officer is named', () => {
    expect(grievanceContact()).toEqual({ name: '', email: 'info@beaufortmarine.in', phone: '' })
    expect(grievanceContact(filled)).toEqual({ name: 'A. Officer', email: 'grievance@example.in', phone: '+91 90000 00000' })
  })

  it('builds the footer operator line and tel links', () => {
    expect(OPERATOR_LINE).toBe('Sea N Shore is operated by Beaufort Marine Services LLP · Navi Mumbai, India')
    expect(operatorLine(filled)).toBe(OPERATOR_LINE)
    expect(telHref('+91 85914 63321')).toBe('tel:+918591463321')
  })
})
