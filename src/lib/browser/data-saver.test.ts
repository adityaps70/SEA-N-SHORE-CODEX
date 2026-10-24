// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_SAVER_STORAGE_KEY, autoplayBlockReason, dataSaverActive, setDataSaverChosen } from './data-saver'

function network(value: Record<string, unknown> | undefined) {
  Object.defineProperty(navigator, 'connection', { configurable: true, value })
}

function phone(isPhone: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: isPhone, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
}

beforeEach(() => {
  window.localStorage.clear()
  network(undefined)
  phone(false)
})
afterEach(() => {
  setDataSaverChosen(false)
  vi.unstubAllGlobals()
})

describe('Data saver and autoplay (Round P3)', () => {
  it('lets video autoplay on a desktop or on Wi-Fi', () => {
    expect(autoplayBlockReason()).toBeNull()
    phone(true)
    network({ type: 'wifi', effectiveType: '4g' })
    expect(autoplayBlockReason()).toBeNull()
  })

  it('never autoplays on mobile data, a 2G connection or with the browser data saver', () => {
    phone(true)
    network({ type: 'cellular', effectiveType: '4g' })
    expect(autoplayBlockReason()).toBe('mobile-data')
    network({ type: 'wifi', effectiveType: '2g' })
    expect(autoplayBlockReason()).toBe('slow-network')
    network({ type: 'wifi', effectiveType: '4g', saveData: true })
    expect(autoplayBlockReason()).toBe('data-saver')
    expect(dataSaverActive()).toBe(true)
  })

  it('treats a phone that does not say its network (iPhone Safari) as possibly on mobile data', () => {
    phone(true)
    expect(autoplayBlockReason()).toBe('unknown-phone-network')
  })

  it('remembers the Settings switch on this device and blocks autoplay while it is on', () => {
    setDataSaverChosen(true)
    expect(window.localStorage.getItem(DATA_SAVER_STORAGE_KEY)).toBe('on')
    expect(dataSaverActive()).toBe(true)
    expect(autoplayBlockReason()).toBe('data-saver')
    setDataSaverChosen(false)
    expect(window.localStorage.getItem(DATA_SAVER_STORAGE_KEY)).toBeNull()
    expect(autoplayBlockReason()).toBeNull()
  })
})
