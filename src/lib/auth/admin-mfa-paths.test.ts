import { describe, expect, it } from 'vitest'
import { adminMfaSetupHref, adminReturnPathForRequest, safeAdminReturnPath } from './admin-mfa-paths'

function request(url: string, method = 'GET') {
  const parsed = new URL(url)
  return { method, nextUrl: { pathname: parsed.pathname, searchParams: parsed.searchParams } }
}

describe('admin MFA gate paths (Round 14, 2.11)', () => {
  it('accepts admin console paths only', () => {
    for (const path of ['/admin', '/admin/users', '/admin/users/abc?tab=audit', '/admin?x=1']) {
      expect(safeAdminReturnPath(path)).toBe(path)
    }
    for (const path of [
      null, 42, '', '/', '/home', '/administrator', 'admin', 'https://evil.example/admin', '//evil.example/admin',
      '/admin//evil', '/admin/\\evil', '/admin/%2F%2Fevil', '/admin/../settings', '/admin/./x', '/admin/%2e%2e/x', `/admin/${'x'.repeat(600)}`,
    ]) {
      expect(safeAdminReturnPath(path)).toBeNull()
    }
  })

  it('links to the setup page with the reason and a safe return path', () => {
    expect(adminMfaSetupHref('/admin/users?q=ana')).toBe('/settings/security?required=admin&next=%2Fadmin%2Fusers%3Fq%3Dana')
    expect(adminMfaSetupHref('/home')).toBe('/settings/security?required=admin')
    expect(adminMfaSetupHref(null)).toBe('/settings/security?required=admin')
  })

  it('derives the return path from admin GET/HEAD requests without Next internals', () => {
    expect(adminReturnPathForRequest(request('https://seanshore.in/admin/users?q=ana&_rsc=abc'))).toBe('/admin/users?q=ana')
    expect(adminReturnPathForRequest(request('https://seanshore.in/admin', 'HEAD'))).toBe('/admin')
    expect(adminReturnPathForRequest(request('https://seanshore.in/admin/users', 'POST'))).toBeNull()
    expect(adminReturnPathForRequest(request('https://seanshore.in/home'))).toBeNull()
    expect(adminReturnPathForRequest(request('https://seanshore.in/administrator'))).toBeNull()
  })
})
