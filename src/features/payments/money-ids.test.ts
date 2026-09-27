import { describe, expect, it } from 'vitest'
import { decimalAmountToMinor, minorToDecimalAmount } from './currency'
import { normalizeCheckoutPhone } from './customer-contact'
import {
  gatewayCustomerId,
  gatewayOrderId,
  isGatewayOrderId,
  orderUuidFromGatewayOrderId,
  purposeOfGatewayOrderId,
  refundIdFor,
} from './order-ids'

const uuid = '0f7e5b1c-1111-4111-8111-111111111111'

describe('amount conversion for gateways', () => {
  it('turns paise into the exact decimal amount without floating-point drift', () => {
    expect(minorToDecimalAmount(49900)).toBe(499)
    expect(minorToDecimalAmount(49950)).toBe(499.5)
    expect(minorToDecimalAmount(1015)).toBe(10.15)
    expect(minorToDecimalAmount(1)).toBe(0.01)
    expect(minorToDecimalAmount(100000000)).toBe(1000000)
    expect(JSON.stringify({ amount: minorToDecimalAmount(1015) })).toBe('{"amount":10.15}')
    expect(() => minorToDecimalAmount(10.5)).toThrow()
    expect(() => minorToDecimalAmount(-1)).toThrow()
  })

  it('turns gateway amounts back into paise exactly, and refuses anything unclean', () => {
    expect(decimalAmountToMinor(10.15)).toBe(1015)
    expect(decimalAmountToMinor(0.29)).toBe(29)
    expect(decimalAmountToMinor(499.5)).toBe(49950)
    expect(decimalAmountToMinor('499.50')).toBe(49950)
    expect(decimalAmountToMinor('1')).toBe(100)
    expect(decimalAmountToMinor(10.155)).toBeNull()
    expect(decimalAmountToMinor('10.155')).toBeNull()
    expect(decimalAmountToMinor(-1)).toBeNull()
    expect(decimalAmountToMinor('1e3')).toBeNull()
    expect(decimalAmountToMinor(null)).toBeNull()
    for (let paise = 0; paise < 3000; paise += 7) {
      expect(decimalAmountToMinor(minorToDecimalAmount(paise))).toBe(paise)
    }
  })
})

describe('gateway order ids', () => {
  it('prefixes our order uuid by purpose and stays inside Cashfree’s limits', () => {
    const id = gatewayOrderId('event', uuid)
    expect(id).toBe('evt_0f7e5b1c111141118111111111111111')
    expect(id).toHaveLength(36)
    expect(isGatewayOrderId(id)).toBe(true)
    expect(gatewayOrderId('course', uuid).startsWith('crs_')).toBe(true)
    expect(gatewayOrderId('plan', uuid).startsWith('pln_')).toBe(true)
    expect(() => gatewayOrderId('event', 'not-a-uuid')).toThrow()
  })

  it('reads the purpose and the order uuid back', () => {
    expect(purposeOfGatewayOrderId('evt_0f7e5b1c111141118111111111111111')).toBe('event')
    expect(purposeOfGatewayOrderId('crs_0f7e5b1c111141118111111111111111')).toBe('course')
    expect(purposeOfGatewayOrderId('order_Abc123')).toBeNull()
    expect(orderUuidFromGatewayOrderId('evt_0f7e5b1c111141118111111111111111')).toBe(uuid)
    expect(orderUuidFromGatewayOrderId('evt_short')).toBeNull()
    expect(isGatewayOrderId('evt_../../x')).toBe(false)
  })

  it('builds alphanumeric refund and customer ids', () => {
    expect(refundIdFor(uuid, 1)).toBe('rf0f7e5b1c1111411181111111111111111')
    expect(refundIdFor(uuid, 12)).toMatch(/^[A-Za-z0-9]{3,40}$/)
    expect(() => refundIdFor(uuid, 0)).toThrow()
    expect(gatewayCustomerId('11111111-1111-4111-8111-111111111111')).toBe('11111111111141118111111111111111')
  })
})

describe('checkout mobile numbers', () => {
  it('accepts Indian mobiles in the ways people type them', () => {
    expect(normalizeCheckoutPhone('98765 43210')).toBe('+919876543210')
    expect(normalizeCheckoutPhone('098765-43210')).toBe('+919876543210')
    expect(normalizeCheckoutPhone('+91 98765 43210')).toBe('+919876543210')
    expect(normalizeCheckoutPhone('919876543210')).toBe('+919876543210')
  })

  it('accepts international numbers with a country code', () => {
    expect(normalizeCheckoutPhone('+44 7700 900123')).toBe('+447700900123')
    expect(normalizeCheckoutPhone('0044 7700 900123')).toBe('+447700900123')
  })

  it('refuses numbers that cannot be a mobile', () => {
    expect(normalizeCheckoutPhone('12345')).toBeNull()
    expect(normalizeCheckoutPhone('5876543210')).toBeNull()
    expect(normalizeCheckoutPhone('+91 12345 67890')).toBeNull()
    expect(normalizeCheckoutPhone('call me')).toBeNull()
    expect(normalizeCheckoutPhone('')).toBeNull()
    expect(normalizeCheckoutPhone(null)).toBeNull()
  })
})
