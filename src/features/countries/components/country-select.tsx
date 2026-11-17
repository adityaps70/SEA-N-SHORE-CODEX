import { COUNTRY_OPTIONS } from '../catalog'

/**
 * Round GP: one country picker for profiles, onboarding and organizations. A native select: on phones it opens the
 * system list, which can be typed into. The value is the ISO 3166-1 two-letter code; empty means "not chosen".
 */
export function CountrySelect({
  id,
  name,
  defaultValue,
  emptyLabel = 'Choose a country',
  required = false,
  invalid = false,
  errorId,
  describedBy,
  className,
}: {
  id: string
  name: string
  defaultValue?: string | null
  emptyLabel?: string
  required?: boolean
  invalid?: boolean
  errorId?: string
  describedBy?: string
  className?: string
}) {
  const described = [describedBy, invalid ? errorId : undefined].filter(Boolean).join(' ') || undefined
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue ?? ''}
      required={required}
      aria-invalid={invalid || undefined}
      aria-describedby={described}
      autoComplete="country"
      className={className}
    >
      <option value="">{emptyLabel}</option>
      {COUNTRY_OPTIONS.map((option) => (
        <option key={option.code} value={option.code}>{option.name}</option>
      ))}
    </select>
  )
}
