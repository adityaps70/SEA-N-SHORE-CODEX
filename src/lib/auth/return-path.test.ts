import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { arrivedAtReturnPath, authHrefWithReturn, RETURN_PATH_COOKIE, returnPathCookieOptions, returnPathForRequest, safeReturnPath } from './return-path'

describe('safeReturnPath (round F)', () => {
  it('accepts same-site relative paths, with their query', () => {
    expect(safeReturnPath('/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe('/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(safeReturnPath('/jobs?type=deck&page=2')).toBe('/jobs?type=deck&page=2')
    expect(safeReturnPath('/people/captain-rhea#about')).toBe('/people/captain-rhea#about')
  })

  it.each([
    ['protocol-relative', '//evil.com'],
    ['protocol-relative with path', '//evil.com/posts/1'],
    ['absolute https', 'https://other-site.example/posts/1'],
    ['absolute http', 'http://evil.com'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['backslash trick', '/\\evil.com'],
    ['encoded slash', '/%2F%2Fevil.com'],
    ['encoded backslash', '/%5Cevil.com'],
    ['encoded dot', '/%2e%2e/admin'],
    ['dot segment', '/posts/../admin'],
    ['double slash inside', '/posts//x'],
    ['whitespace', '/posts/ x'],
    ['tab', '/posts/\tx'],
    ['newline', '/posts/\nx'],
    ['userinfo', '/@evil.com'],
    ['the auth pages', '/auth/sign-in'],
    ['an API route', '/api/public/jobs'],
    ['Next internals', '/_next/static/x.js'],
    ['relative', 'posts/1'],
    ['empty', ''],
  ])('refuses %s', (_label, value) => {
    expect(safeReturnPath(value)).toBeNull()
  })

  it('refuses anything that is not a string or is too long', () => {
    expect(safeReturnPath(undefined)).toBeNull()
    expect(safeReturnPath(['/posts/1'])).toBeNull()
    expect(safeReturnPath(`/${'a'.repeat(600)}`)).toBeNull()
  })
})

describe('return path links and cookie', () => {
  it('adds ?next= to sign-in and sign-up links only when it is safe', () => {
    expect(authHrefWithReturn('/auth/sign-in', '/posts/1')).toBe('/auth/sign-in?next=%2Fposts%2F1')
    expect(authHrefWithReturn('/auth/sign-up', '//evil.com')).toBe('/auth/sign-up')
    expect(authHrefWithReturn('/auth/sign-in', null)).toBe('/auth/sign-in')
  })

  it('takes the page from a GET request without Next\'s _rsc parameter, and nothing from other methods', () => {
    expect(returnPathForRequest(new NextRequest('https://seanshore.in/posts/1?_rsc=x&photo=2'))).toBe('/posts/1?photo=2')
    expect(returnPathForRequest(new NextRequest('https://seanshore.in/posts/1', { method: 'POST' }))).toBeNull()
  })

  it('is an httpOnly, lax cookie for 30 minutes, secure on an https site', () => {
    expect(returnPathCookieOptions('https://seanshore.in')).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 1800 })
    expect(returnPathCookieOptions('http://localhost:3000').secure).toBe(false)
  })

  it('knows when the member has arrived at the remembered page', () => {
    const arrived = new NextRequest('https://seanshore.in/posts/1', { headers: { cookie: `${RETURN_PATH_COOKIE}=/posts/1` } })
    const elsewhere = new NextRequest('https://seanshore.in/home', { headers: { cookie: `${RETURN_PATH_COOKIE}=/posts/1` } })
    expect(arrivedAtReturnPath(arrived)).toBe(true)
    expect(arrivedAtReturnPath(elsewhere)).toBe(false)
  })
})
