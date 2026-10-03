/**
 * `/home?compose=…` values. The phone Create sheet links here; the Home composer opens in the
 * matching mode (photo and document also open, or point at, the file picker).
 */
export const COMPOSE_REQUESTS = ['update', 'photo', 'document', 'question', 'poll'] as const
export type ComposeRequest = (typeof COMPOSE_REQUESTS)[number]

export function parseComposeRequest(value: unknown): ComposeRequest | undefined {
  return typeof value === 'string' && (COMPOSE_REQUESTS as readonly string[]).includes(value)
    ? (value as ComposeRequest)
    : undefined
}
