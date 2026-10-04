/**
 * The visitor's IP behind CloudFront and the ALB. CloudFront appends the viewer address to
 * X-Forwarded-For and the ALB then appends CloudFront's own address, so the viewer is the
 * second-to-last entry; anything before it was sent by the client and cannot be trusted.
 */
export function trustedClientIp(headers: Pick<Headers, 'get'>): string | null {
  const parts = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const candidate = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
  if (!candidate || candidate.length > 64 || !/^[0-9a-fA-F:.]+$/.test(candidate)) return null
  return candidate
}
