import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync('src/app/onboarding/page.tsx', 'utf8')
const form = readFileSync('src/features/profiles/components/onboarding-form.tsx', 'utf8')

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
    expect(form).toContain('Find jobs')
    expect(form).toContain('Hire people')
    expect(form).toContain('Teach')
    expect(form).toContain('Host events')
    expect(form).toContain("persona === 'seafarer'")
    expect(form).toContain("persona === 'seafarer_family'")
  })
})
