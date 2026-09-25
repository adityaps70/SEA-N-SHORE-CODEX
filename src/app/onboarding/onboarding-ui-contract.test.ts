import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync('src/app/onboarding/page.tsx', 'utf8')
const form = readFileSync('src/features/profiles/components/onboarding-form.tsx', 'utf8')
const persona = readFileSync('src/features/profiles/persona.ts', 'utf8')

describe('onboarding UI contract', () => {
  it('uses the Sea N Shore wordmark and removes the decorative route squiggle', () => {
    expect(page).toContain('<Wordmark compact />')
    expect(page).not.toContain('RouteLine')
  })

  it('keeps onboarding compact and visually aligned with the current app shell', () => {
    expect(page).toContain('max-w-5xl')
    expect(page).toContain('rounded-[1.75rem]')
    expect(page).toContain('Build your maritime presence')
  })

  it('keeps the onboarding journey mobile-first without horizontal multi-column pressure', () => {
    expect(page).toContain('px-4 py-4 sm:px-6 sm:py-6')
    expect(page).toContain('p-5 shadow-')
    expect(page).toContain('sm:p-7 lg:p-8')
    expect(form).toContain('grid gap-3 sm:grid-cols-2 lg:grid-cols-4')
    expect(form).toContain('grid gap-5 sm:grid-cols-2')
    expect(form).toContain('w-full sm:w-auto')
    expect(form).not.toContain('min-w-[')
  })

  it('uses human personas instead of Professional / Organisation as competing account identities', () => {
    expect(form).toContain('Which best describes you?')
    expect(form).toContain('Seafarer')
    expect(form).toContain('Shore Professional')
    expect(form).toContain('Recruiter / HR')
    expect(form).toContain('Trainer / Instructor')
    expect(form).toContain('Student / Cadet')
    expect(form).toContain('Seafarer Family')
    expect(form).toContain('Maritime Enthusiast')
    expect(form).not.toContain('I’m joining as')
    expect(form).not.toContain('IdentityRootButton')
  })

  it('asks what the member wants to do and supports dynamic persona fields', () => {
    expect(form).toContain('What are you here to do?')
    expect(persona).toContain('Find jobs')
    expect(persona).toContain('Hire people')
    expect(persona).toContain('Teach')
    expect(persona).toContain('Host events')
    expect(form).toContain("persona === 'seafarer'")
    expect(form).toContain("persona === 'seafarer_family'")
  })
})
