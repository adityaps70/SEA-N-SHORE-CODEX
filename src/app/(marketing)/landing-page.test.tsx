import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const files = [
  'src/app/(marketing)/page.tsx',
  'src/components/marketing/maritime-ecosystem-hero.tsx',
  'src/components/marketing/ecosystem-capabilities.tsx',
  'src/components/marketing/maritime-passport-showcase.tsx',
  'src/components/marketing/maritime-audiences.tsx',
  'src/components/marketing/maritime-feed-showcase.tsx',
  'src/components/marketing/professional-discovery-showcase.tsx',
  'src/components/marketing/opportunities-showcase.tsx',
  'src/components/marketing/why-sea-n-shore.tsx',
  'src/components/marketing/ecosystem-journey.tsx',
  'src/components/marketing/final-ecosystem-cta.tsx',
]

const source = files
  .map((file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8'))
  .join('\n')

describe('marketing landing page contract', () => {
  it('positions Sea N Shore as an all-in-one maritime ecosystem', () => {
    expect(source).toContain('The all-in-one professional ecosystem for the maritime industry.')
    expect(source).toContain('Maritime Passport')
    expect(source).toContain('Built for every side of maritime')
    expect(source).toContain('Professional conversations built around the work')
    expect(source).toContain('Find the people you need across maritime')
    expect(source).toContain('Why Sea N Shore exists')
    expect(source).toContain('Your maritime network should move with your career.')
  })

  it('contains the concrete maritime ecosystem capabilities', () => {
    for (const label of [
      'Professional Network',
      'Maritime Feed',
      'Career Visibility',
      'Knowledge & Learning',
      'Opportunities',
      'Onboard / Ashore',
      'CoC & certificates',
      'Career timeline',
      'QR profile',
      'Downloadable CV',
    ]) {
      expect(source).toContain(label)
    }
  })

  it('speaks to all approved maritime audiences and professional discovery roles', () => {
    for (const label of [
      'Seafarers',
      'Shore Professionals',
      'Recruiters & Crewing Teams',
      'Maritime Companies',
      'Master Mariners',
      'Chief Engineers',
      'Marine Superintendents',
      'Technical Superintendents',
      'Crewing Managers',
      'DPA / CSO',
    ]) {
      expect(source).toContain(label)
    }
  })

  it('removes prototype and unfinished-product messaging from the conversion page', () => {
    expect(source).not.toContain('Product preview')
    expect(source).not.toContain('part of the next product phase')
    expect(source).not.toContain('still in development')
  })
})
