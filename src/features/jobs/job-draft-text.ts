/**
 * Hotfix P2: drafts may be saved before the summary or description is written, but the jobs table
 * requires both to be at least one character (jobs_summary_check / jobs_description_check). An empty
 * draft field is stored as one zero-width space (not trimmed by btrim() or String.trim()) and read back
 * as empty. Published jobs always pass validateJobPublish, so they never carry the marker.
 */
export const JOB_DRAFT_EMPTY_TEXT = '​'

/** The value to store for a draft's summary or description. */
export function storedDraftText(value: string) {
  return value.trim() ? value : JOB_DRAFT_EMPTY_TEXT
}

/** A stored summary or description as the form and the publish checks see it. */
export function readStoredJobText(value: string | null | undefined) {
  return !value || value === JOB_DRAFT_EMPTY_TEXT ? '' : value
}
