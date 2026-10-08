/** Plain-word names for material types, shared by the course page and the course player. */
export const LESSON_TYPE_LABELS: Record<string, string> = {
  video: 'Video', audio: 'Audio', article: 'Article', image: 'Image', pdf: 'PDF', presentation_document: 'Presentation',
  external_embed: 'Video', quiz: 'Quiz', assignment: 'Assignment', downloadable_resource: 'Resource', scorm: 'Interactive module',
  live_session: 'Live session',
}

export function lessonTypeLabel(lessonType: string) {
  return LESSON_TYPE_LABELS[lessonType] ?? 'Material'
}
