import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('event publish-as experience', () => {
  it('builds personal and organization publisher choices on the create page', () => {
    const page = source('src/app/(app)/events/create/page.tsx')

    expect(page).toContain('getAccessContext')
    expect(page).toContain('getOwnProfileFromAurora')
    expect(page).toContain('listUserOrganizations')
    expect(page).toContain('buildEventPublisherOptions')
    expect(page).toContain('publisherOptions')
  })

  it('shows Publish as with separate verification and upgrade blockers', () => {
    const form = source('src/features/events/components/event-form.tsx')

    expect(form).toContain('Publish as')
    expect(form).toContain('publisherOptions')
    expect(form).toContain('verification_required')
    expect(form).toContain('upgrade_required')
    expect(form).toContain('/plans')
    expect(form).toContain('publisherType')
  })

  it('shows the selected publisher on public event surfaces', () => {
    const card = source('src/features/events/components/event-card.tsx')
    const detail = source('src/app/(app)/events/[eventId]/page.tsx')

    expect(card).toContain('event.publisherName')
    expect(detail).toContain('event.publisherName')
    expect(detail).toContain("event.publisherType === 'personal'")
  })
})
