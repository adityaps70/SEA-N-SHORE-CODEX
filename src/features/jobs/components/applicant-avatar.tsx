function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'SN'
}

/** Applicant photo (short-lived signed URL created on the server) with an initials fallback. */
export function ApplicantAvatar({
  name,
  photoUrl,
  size = 'md',
}: {
  name: string
  photoUrl: string | null
  size?: 'md' | 'lg'
}) {
  const sizeClass = size === 'lg' ? 'size-14 text-base' : 'size-12 text-sm'
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed private media URL, not an optimizable static asset
      <img
        src={photoUrl}
        alt={`Photo of ${name}`}
        loading="lazy"
        className={`${sizeClass} shrink-0 rounded-2xl border border-mist-100 bg-mist-50 object-cover`}
      />
    )
  }
  return (
    <div aria-hidden="true" className={`${sizeClass} grid shrink-0 place-items-center rounded-2xl bg-navy-950 font-black text-white`}>
      {initials(name)}
    </div>
  )
}
