/** My Learning's tabs (learning round C, C6). A plain module, so the server page can read `?tab=` too. */
export const MY_LEARNING_TABS = ['courses', 'certificates', 'purchases'] as const
export type MyLearningTab = (typeof MY_LEARNING_TABS)[number]

/** `?tab=` value to tab; anything else is the Courses tab. */
export function myLearningTabFrom(value: string | string[] | undefined): MyLearningTab {
  const tab = Array.isArray(value) ? value[0] : value
  return (MY_LEARNING_TABS as readonly string[]).includes(tab ?? '') ? tab as MyLearningTab : 'courses'
}
