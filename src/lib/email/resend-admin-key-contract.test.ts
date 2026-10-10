// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The owner's rule for the full-access Resend key (sea-n-shore/resend-admin): it is used only to create the webhook
 * and update domain tracking (scripts/aws/resend-delivery-webhook.py), and to read delivery status and the
 * suppression list (the outbox worker's backfill). Every email is sent with the sending-only key.
 */

const root = process.cwd()

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name) ? [path] : []
  })
}

describe('the Resend admin key boundary', () => {
  it('is loaded only by the delivery backfill, and that module never sends', () => {
    const users = [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'scripts/workers'))]
      .filter((path) => /loadResendAdminApiKey|DEFAULT_RESEND_ADMIN_SECRET_ID|resend-admin/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path))
      .sort()
    expect(users).toEqual(['src/features/email-delivery/backfill.ts', 'src/lib/email/resend.ts'])
    const backfill = readFileSync(join(root, 'src/features/email-delivery/backfill.ts'), 'utf8')
    expect(backfill).not.toMatch(/\.sendEmail\(/)
    expect(backfill).not.toMatch(/\bloadResendApiKey\b/)
  })

  it('is the only key the webhook runner reads; the sending key secret is never named there', () => {
    const runner = readFileSync(join(root, 'scripts/aws/resend-delivery-webhook.py'), 'utf8')
    expect(runner).toContain('ADMIN_KEY_SECRET = "sea-n-shore/resend-admin"')
    expect(runner).not.toMatch(/"sea-n-shore\/resend"/)
  })
})
