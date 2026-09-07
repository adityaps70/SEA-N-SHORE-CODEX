export function getServerActionAllowedOrigins(siteUrl: string | undefined): string[] {
  if (!siteUrl) return []

  try {
    const url = new URL(siteUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return []
    return [url.host]
  } catch {
    return []
  }
}
