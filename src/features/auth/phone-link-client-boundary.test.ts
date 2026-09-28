import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// phone-link.ts pulls in Cognito and the database (pg). Client components must import
// the client-safe pieces from phone-link-shared.ts, or the production build fails.
const CLIENT_FILES = [
  'src/features/auth/components/account-phone-panel.tsx',
  'src/features/account-deletion/components/delete-account-panel.tsx',
]

describe('phone link client boundary', () => {
  it.each(CLIENT_FILES)('%s imports only the client-safe phone link module', (file) => {
    const code = readFileSync(file, 'utf8')
    expect(code.startsWith("'use client'")).toBe(true)
    expect(code).not.toMatch(/from ['"](@\/features\/auth|\.\.?)\/phone-link['"]/)
    expect(code).not.toMatch(/phone-link-repository|phone-auth-admin|@\/lib\/db/)
  })

  it('keeps the shared module free of server-only imports', () => {
    const code = readFileSync('src/features/auth/phone-link-shared.ts', 'utf8')
    expect(code).not.toMatch(/^import /m)
  })
})
