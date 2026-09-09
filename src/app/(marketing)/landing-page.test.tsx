import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const pagePath = path.join(process.cwd(), 'src/app/(marketing)/page.tsx')
const source = fs.readFileSync(pagePath, 'utf8')

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

  it('removes prototype and unfinished-product messaging from the conversion page', () => {
    expect(source).not.toContain('Product preview')
    expect(source).not.toContain('part of the next product phase')
    expect(source).not.toContain('still in development')
  })
})
