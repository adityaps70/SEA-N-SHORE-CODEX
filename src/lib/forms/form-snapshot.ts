/**
 * Hotfix P2: a form's typed values as plain data, for the local autosave copy. Files, passwords and
 * anything named like a payment, bank or tax identifier are never included.
 */
export type FormSnapshot = Record<string, string[]>

const NEVER_STORED = /(password|account.?number|ifsc|upi|vpa|\bpan\b|^pan$|gstin|bank|card)/i

export function readFormSnapshot(form: HTMLFormElement): FormSnapshot {
  const snapshot: FormSnapshot = {}
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue
    const name = element.name
    if (!name || element.disabled || NEVER_STORED.test(name)) continue
    if (element instanceof HTMLInputElement) {
      if (element.type === 'file' || element.type === 'password' || element.type === 'submit' || element.type === 'button') continue
      if ((element.type === 'checkbox' || element.type === 'radio') && !element.checked) continue
    }
    const values = element instanceof HTMLSelectElement && element.multiple
      ? Array.from(element.selectedOptions).map((option) => option.value)
      : [element.value]
    snapshot[name] = [...(snapshot[name] ?? []), ...values]
  }
  return snapshot
}

/** A FormData holding a snapshot, so the form's own parser can read it back. */
export function formDataFromSnapshot(snapshot: FormSnapshot) {
  const formData = new FormData()
  for (const [name, values] of Object.entries(snapshot)) {
    if (NEVER_STORED.test(name)) continue
    for (const value of values) if (typeof value === 'string') formData.append(name, value)
  }
  return formData
}

export function isFormSnapshot(value: unknown): value is FormSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((entry) => Array.isArray(entry) && entry.every((item) => typeof item === 'string'))
}
