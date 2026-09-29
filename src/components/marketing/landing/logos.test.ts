import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLOBAL_PARTNERS, HIRING_COMPANIES, MORE_HIRING_PARTNERS, PARENT_GROUP_LOGO, PARTNERS } from './logos'

const all = [PARENT_GROUP_LOGO, ...PARTNERS, ...GLOBAL_PARTNERS, ...HIRING_COMPANIES, ...MORE_HIRING_PARTNERS]

describe('landing logos', () => {
  it('ships every logo file it lists', () => {
    for (const logo of all) expect(existsSync(resolve(process.cwd(), 'public', logo.file.replace(/^\//, ''))), logo.file).toBe(true)
  })

  it('links only to verified https websites, one per company, and leaves unverified logos unlinked', () => {
    const linked = all.filter((logo) => logo.href)
    for (const logo of linked) expect(logo.href, logo.name).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/?[^\s]*$/)
    expect(new Set(linked.map((logo) => logo.href)).size).toBe(linked.length)
    const byName = (name: string) => all.find((logo) => logo.name === name)
    expect(byName('Wallem')?.href).toBe('https://www.wallem.com/')
    expect(byName('Beaufort Marine Services LLP')?.href).toBe('https://www.beaufortmarine.in/')
    expect(byName('Khyaal')?.href).toBe('https://www.khyaal.com/')
    expect(byName('Cleanship')?.href).toBe('https://cleanship.co/')
    // No working official site could be verified for these at the time; they stay unlinked.
    for (const name of ['Jataj Shipping Lines', 'Medallion', 'MariVet', 'K.R. Marine Services', 'MTCPL — Voice of Sea', 'OceanMate', 'Divulge', 'ibhar', 'Hiring partner']) {
      expect(byName(name)?.href, name).toBeUndefined()
    }
  })
})
