import type { ProfileType } from '../types'

type ProfileTypeCardProps = {
  value: ProfileType
  label: string
  description: string
  checked: boolean
  onChange: (profileType: ProfileType) => void
}

export function ProfileTypeCard({ value, label, description, checked, onChange }: ProfileTypeCardProps) {
  return (
    <label className="relative flex min-h-32 cursor-pointer flex-col rounded-2xl border border-mist-100 bg-white p-4 shadow-sm transition-colors has-[:checked]:border-ocean-700 has-[:checked]:bg-mist-50">
      <input
        className="absolute right-4 top-4 size-5 accent-[var(--ocean-700)]"
        type="radio"
        name="profileType"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        aria-label={label}
      />
      <span className="pr-8 text-base font-semibold text-navy-950">{label}</span>
      <span className="mt-2 text-sm leading-6 text-muted">{description}</span>
    </label>
  )
}
