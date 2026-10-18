import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { AccountQuery } from './types'

/**
 * Round H (H3): 2FA backup codes.
 *
 * - 10 codes of 10 characters from an alphabet without look-alikes (no 0/O, 1/I/L), shown as XXXXX-XXXXX: about
 *   49 bits each, drawn with crypto.randomInt.
 * - Stored only as HMAC-SHA-256(server key, per-code random salt + code). Why not a slow hash (scrypt/bcrypt)?
 *   The codes are long random strings, not human passwords, so there is no small dictionary to try; the key never
 *   lives in the database, so a database copy alone cannot be checked against any guess; and a sign-in attempt
 *   has to compare up to 10 codes, which a slow hash would make expensive for the web server. The per-code salt
 *   keeps equal codes from producing equal hashes and makes any offline attempt per code, never per table.
 * - Shown once; regenerating deletes the previous batch. A code is used once: used_at is set by a single
 *   conditional UPDATE, so two simultaneous sign-ins with the same code cannot both succeed.
 */

export const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const BACKUP_CODE_LENGTH = 10
export const BACKUP_CODE_COUNT = 10

export function generateBackupCode(random: (max: number) => number = randomInt) {
  let code = ''
  for (let index = 0; index < BACKUP_CODE_LENGTH; index += 1) code += BACKUP_CODE_ALPHABET[random(BACKUP_CODE_ALPHABET.length)]
  return code
}

/** XXXXX-XXXXX, the way the member sees it. */
export function formatBackupCode(code: string) {
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

/** Upper-cased with spaces and hyphens removed; null unless it can be a backup code. */
export function normalizeBackupCode(value: unknown) {
  const code = String(value ?? '').toUpperCase().replace(/[\s-]/g, '')
  if (code.length !== BACKUP_CODE_LENGTH) return null
  for (const character of code) if (!BACKUP_CODE_ALPHABET.includes(character)) return null
  return code
}

export function hashBackupCode(key: Buffer, salt: string, code: string) {
  return createHmac('sha256', key).update(`mfa-backup-code:${salt}:${code}`).digest('hex')
}

function matches(key: Buffer, row: { salt: string; hash: string }, code: string) {
  const expected = Buffer.from(hashBackupCode(key, row.salt, code), 'hex')
  const actual = Buffer.from(row.hash, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export type BackupCodeStatus = { remaining: number; createdAt: string | null }

export function createBackupCodeRepository(input: { query: AccountQuery }) {
  const { query } = input

  return {
    async status(profileId: string): Promise<BackupCodeStatus> {
      const rows = await query(
        `select count(*) filter (where used_at is null)::int as remaining, max(created_at) as created_at
         from public.mfa_backup_codes where profile_id = $1`,
        [profileId],
      )
      const createdAt = rows[0]?.created_at
      return {
        remaining: Number(rows[0]?.remaining ?? 0),
        createdAt: createdAt ? (createdAt instanceof Date ? createdAt : new Date(String(createdAt))).toISOString() : null,
      }
    },

    /**
     * Replaces the member's codes with a new batch and returns the plain codes (to show once). Run inside a
     * transaction so the old batch is gone exactly when the new one exists.
     */
    async replaceBatch(profileId: string, key: Buffer, random?: (max: number) => number): Promise<{ codes: string[]; replaced: boolean }> {
      const removed = await query(`delete from public.mfa_backup_codes where profile_id = $1 returning id`, [profileId])
      const batchId = randomUUID()
      const codes = new Set<string>()
      while (codes.size < BACKUP_CODE_COUNT) codes.add(generateBackupCode(random))
      for (const code of codes) {
        const salt = randomBytes(16).toString('hex')
        await query(
          `insert into public.mfa_backup_codes (profile_id, batch_id, code_salt, code_hash) values ($1, $2, $3, $4)`,
          [profileId, batchId, salt, hashBackupCode(key, salt, code)],
        )
      }
      return { codes: [...codes].map(formatBackupCode), replaced: removed.length > 0 }
    },

    /** Marks the matching unused code used (once, atomically). True only for the request that used it. */
    async consume(profileId: string, key: Buffer, code: string): Promise<boolean> {
      const rows = await query(
        `select id, code_salt, code_hash from public.mfa_backup_codes where profile_id = $1 and used_at is null`,
        [profileId],
      )
      const match = rows.find((row) => matches(key, { salt: String(row.code_salt), hash: String(row.code_hash) }, code))
      if (!match) return false
      const used = await query(
        `update public.mfa_backup_codes set used_at = now()
         where id = $1 and profile_id = $2 and used_at is null
         returning id`,
        [match.id, profileId],
      )
      return used.length > 0
    },

    /** After a 2FA reset the unused codes of that setup are removed; the member makes new ones. */
    async removeUnused(profileId: string) {
      await query(`delete from public.mfa_backup_codes where profile_id = $1 and used_at is null`, [profileId])
    },
  }
}

export type BackupCodeRepository = ReturnType<typeof createBackupCodeRepository>
