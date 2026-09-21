export const MESSAGE_EDIT_WINDOW_MS = 5 * 60 * 1000

export function isWithinMessageEditWindow(
  createdAt: string | Date,
  now: string | Date | number = Date.now(),
) {
  const createdMs = new Date(createdAt).getTime()
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime()
  if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs)) return false
  const elapsed = nowMs - createdMs
  return elapsed >= 0 && elapsed <= MESSAGE_EDIT_WINDOW_MS
}
