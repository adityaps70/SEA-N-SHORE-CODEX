import { describe, expect, it } from 'vitest'
import { allows, countryAdminHome, DEFAULT_COUNTRY_ADMIN_PERMISSIONS, normalisePermissions } from './sections'

/** Round GP Part E: country admin sections, "view" and "act". */
describe('country admin sections', () => {
  it('treats act as including view, and nothing as no access', () => {
    expect(allows({ organizations: 'act' }, 'organizations', 'view')).toBe(true)
    expect(allows({ organizations: 'act' }, 'organizations', 'act')).toBe(true)
    expect(allows({ organizations: 'view' }, 'organizations', 'act')).toBe(false)
    expect(allows({}, 'organizations')).toBe(false)
  })

  it('starts a new country admin with Organizations (act) only', () => {
    expect(DEFAULT_COUNTRY_ADMIN_PERMISSIONS).toEqual({ organizations: 'act' })
  })

  it('cleans permissions: known sections only, view-only sections never act, nothing left is null', () => {
    expect(normalisePermissions({ organizations: 'act', members: 'act', overview: 'act', bogus: 'act', learning: 'nope' }))
      .toEqual({ organizations: 'act', members: 'view', overview: 'view' })
    expect(normalisePermissions({})).toBeNull()
  })

  it('lands a country admin on their Overview, or else their first section', () => {
    expect(countryAdminHome({ overview: 'view', organizations: 'act' })).toBe('/admin')
    expect(countryAdminHome({ members: 'view' })).toBe('/admin/countries')
    expect(countryAdminHome({ communities: 'act' })).toBeNull()
  })
})
