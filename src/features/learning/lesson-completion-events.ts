/**
 * Learning round E: a lesson completed on the page (video watched far enough, quiz passed) tells the
 * player's bottom bar at once, so "Complete & next" unlocks without waiting for a reload.
 */
export const LESSON_COMPLETED_EVENT = 'sea-n-shore:lesson-completed'

export function announceLessonCompleted(lessonId: string) {
  window.dispatchEvent(new CustomEvent(LESSON_COMPLETED_EVENT, { detail: { lessonId } }))
}

export function lessonIdFromEvent(event: Event) {
  const detail = (event as CustomEvent<{ lessonId?: unknown }>).detail
  return typeof detail?.lessonId === 'string' ? detail.lessonId : null
}
