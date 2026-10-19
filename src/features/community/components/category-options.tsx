import type { CommunityCategoryRef } from '../types'

/**
 * Round I (I2): the category picker's options, in admin order. A hidden category is not offered, except to the
 * community that already has it (marked as hidden), so saving the community never changes its category by itself.
 */
export function categoryPickerOptions(options: readonly CommunityCategoryRef[], current?: CommunityCategoryRef | null) {
  const shown = options.filter((option) => !option.hidden)
  if (current && !shown.some((option) => option.id === current.id)) return [...shown, { ...current, hidden: true }]
  return shown
}

export function CategoryOptions({ options, current }: { options: readonly CommunityCategoryRef[]; current?: CommunityCategoryRef | null }) {
  return (
    <>
      <option value="" disabled>Choose a category</option>
      {categoryPickerOptions(options, current).map((option) => (
        <option key={option.id} value={option.id}>{option.hidden ? `${option.name} (hidden, kept)` : option.name}</option>
      ))}
    </>
  )
}
