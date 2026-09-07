function parseHttpHost(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.host
  } catch {
    return null
  }
}

export function getServerActionAllowedOrigins(
  siteUrl: string | undefined,
  additionalOrigins: string | undefined,
): string[] {
  const candidates = [siteUrl ?? '', ...(additionalOrigins ?? '').split(',')]
  const hosts = candidates
    .map((value) => value.trim())
    .filter(Boolean)
    .map(parseHttpHost)
    .filter((host): host is string => Boolean(host))

  return [...new Set(hosts)]
}
