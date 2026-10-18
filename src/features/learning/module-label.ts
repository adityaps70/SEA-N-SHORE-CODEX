/**
 * Round H (H7): a section's "Module N" label, shown only when the trainer's own title does not already
 * start with a number ("Module 1 · Team Working" must not read "Module 1 / Module 1 · Team Working").
 */
const NUMBERED_TITLE = /^\s*(?:module|section|unit|chapter)\s*\d+(?![\d])/i

export function titleHasModuleNumber(title: string) {
  return NUMBERED_TITLE.test(title)
}

/** "Module 2" above the title, or null when the title already carries its number. */
export function moduleLabel(index: number, title: string) {
  return titleHasModuleNumber(title) ? null : `Module ${index + 1}`
}

/** The player breadcrumb: the numbered title itself, otherwise "Module N". */
export function moduleCrumb(index: number, title: string) {
  return titleHasModuleNumber(title) ? title.trim() : `Module ${index + 1}`
}
