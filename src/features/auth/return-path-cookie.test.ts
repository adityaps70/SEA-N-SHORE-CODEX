import { beforeEach, describe, expect, it, vi } from 'vitest'

const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => name === 'sns_return_to' && cookieValue.value ? { value: cookieValue.value } : undefined }),
}))

const { homeOrReturnPath } = await import('./return-path-cookie')

describe('homeOrReturnPath (round F: the end of onboarding)', () => {
  beforeEach(() => { cookieValue.value = undefined })

  it('goes Home without a remembered page', async () => {
    await expect(homeOrReturnPath()).resolves.toBe('/home')
  })

  it('goes to the page the new member signed up from', async () => {
    cookieValue.value = '/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await expect(homeOrReturnPath()).resolves.toBe('/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })

  it('checks the remembered page again and refuses another site', async () => {
    cookieValue.value = '//evil.com'
    await expect(homeOrReturnPath()).resolves.toBe('/home')
  })
})
