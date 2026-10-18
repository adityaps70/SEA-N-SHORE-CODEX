/**
 * Round H (H7): the welcome post a new community owner is invited to write. Communities have no pinned posts
 * yet (that needs a schema change), so the prompt asks the owner to post it as the first post instead.
 */
export const WELCOME_STARTER_QUESTIONS = [
  'What is your current role, and which vessel types or trades do you work on?',
  'What is one lesson from sea or shore you wish you had learned earlier?',
  'What would you like to discuss or learn in this community?',
] as const

/** The composer text: a welcome line, what the community is for, house rules and the three starter questions. */
export function welcomePostTemplate(group: { name: string; description?: string | null }) {
  const purpose = group.description?.split('\n').map((line) => line.trim()).find(Boolean)
  return [
    `Welcome to ${group.name}!`,
    purpose
      ? `${purpose.replace(/[.!?]*$/, '.')} Introduce yourself below and keep discussions professional and useful.`
      : 'Introduce yourself below and keep discussions professional and useful.',
    'To get us started, reply with your answers:',
    WELCOME_STARTER_QUESTIONS.map((question, index) => `${index + 1}. ${question}`).join('\n'),
  ].join('\n\n')
}

/** The prompt shows to an owner while no owner or moderator has posted in the community yet. */
export function shouldShowWelcomePrompt(input: {
  isOwner: boolean
  postAuthorIds: readonly string[]
  moderatorIds: readonly string[]
}) {
  if (!input.isOwner) return false
  const moderators = new Set(input.moderatorIds)
  return !input.postAuthorIds.some((authorId) => moderators.has(authorId))
}
