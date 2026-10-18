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

/**
 * Round H (H7): a page can open its composer with text already in it (the community welcome-post prompt).
 * The composer for the same group (or the one with no group when `groupId` is null) listens for this event.
 */
export const COMPOSER_PREFILL_EVENT = 'sea-n-shore:composer-prefill'
export type ComposerPrefill = { groupId: string | null; body: string }

export function requestComposerPrefill(detail: ComposerPrefill) {
  window.dispatchEvent(new CustomEvent<ComposerPrefill>(COMPOSER_PREFILL_EVENT, { detail }))
}
