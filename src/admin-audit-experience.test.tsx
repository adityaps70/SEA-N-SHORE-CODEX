import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('platform admin audit experience', () => {
  it('exposes audit history from the admin navigation', () => {
    const layout = source('src/app/(app)/admin/layout.tsx')
    expect(layout).toContain('/admin/audit')
    expect(layout).toContain('Audit')
  })

  it('renders a filterable administrator audit log with actor, action, target and metadata', () => {
    const page = source('src/app/(app)/admin/audit/page.tsx')
    expect(page).toContain('listAuditEvents')
    expect(page).toContain('Audit log')
    expect(page).toContain('All activity')
    expect(page).toContain('Posts')
    expect(page).toContain('Comments')
    expect(page).toContain('Jobs')
    expect(page).toContain('Events')
    expect(page).toContain('Organizations')
    expect(page).toContain('actor.fullName')
    expect(page).toContain('event.action')
    expect(page).toContain('event.createdAt')
  })
})
