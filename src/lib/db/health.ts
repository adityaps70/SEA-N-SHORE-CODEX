import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from './client'

type HealthRow = QueryResultRow & {
  database_ok: number
  identity_mappings_ok: boolean
  content_network_ok: boolean
}

type HealthQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<HealthRow[]>

export type Phase4DatabaseHealth = {
  database: boolean
  identityMappings: boolean
  contentNetwork: boolean
}

export type DatabaseFailureReason =
  | 'configuration'
  | 'dns'
  | 'timeout'
  | 'network'
  | 'tls'
  | 'authentication'
  | 'database'
  | 'schema'
  | 'unknown'

type SafeDatabaseErrorShape = {
  code?: unknown
  name?: unknown
}

const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])

export function classifyDatabaseFailure(error: unknown): DatabaseFailureReason {
  if (!error || typeof error !== 'object') return 'unknown'

  const candidate = error as SafeDatabaseErrorShape
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const name = typeof candidate.name === 'string' ? candidate.name : ''

  if (name === 'ZodError') return 'configuration'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns'
  if (code === 'ETIMEDOUT') return 'timeout'
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return 'network'
  }
  if (TLS_ERROR_CODES.has(code) || code.startsWith('ERR_SSL_') || code.startsWith('ERR_TLS_')) return 'tls'
  if (code === '28P01' || code === '28000') return 'authentication'
  if (code === '3D000') return 'database'
  if (code === '42P01' || code === '42703' || code === '3F000') return 'schema'

  return 'unknown'
}

export function createPhase4DatabaseHealthCheck(input: { query?: HealthQuery } = {}) {
  const queryRows: HealthQuery = input.query ?? ((text, values) => databaseQuery<HealthRow>(text, values))

  return async function checkPhase4DatabaseHealth(): Promise<Phase4DatabaseHealth> {
    const rows = await queryRows(
      `select
         1::int as database_ok,
         (
           select count(*) = 7
           from public.identity_accounts
           where provider = $1
         ) as identity_mappings_ok,
         (
           to_regclass('public.posts') is not null
           and to_regclass('public.post_reactions') is not null
           and to_regclass('public.post_comments') is not null
           and to_regclass('public.saved_posts') is not null
           and to_regclass('public.post_media') is not null
           and to_regclass('public.post_polls') is not null
           and to_regclass('public.post_poll_options') is not null
           and to_regclass('public.post_poll_votes') is not null
           and to_regclass('public.follows') is not null
           and to_regclass('public.connections') is not null
           and to_regclass('public.user_blocks') is not null
         ) as content_network_ok`,
      ['cognito'],
    )

    const row = rows[0]
    return {
      database: row?.database_ok === 1,
      identityMappings: row?.identity_mappings_ok === true,
      contentNetwork: row?.content_network_ok === true,
    }
  }
}

export const checkPhase4DatabaseHealth = createPhase4DatabaseHealthCheck()
