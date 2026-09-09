export function LandingSectionHeading({
  id,
  eyebrow,
  title,
  body,
  align = 'left',
}: {
  id?: string
  eyebrow: string
  title: string
  body?: string
  align?: 'left' | 'center'
}) {
  const centered = align === 'center'
  return (
    <div className={centered ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-ocean-700">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-navy-950 sm:text-4xl">{title}</h2>
      {body ? <p className="mt-4 text-base leading-7 text-muted sm:text-lg sm:leading-8">{body}</p> : null}
    </div>
  )
}
