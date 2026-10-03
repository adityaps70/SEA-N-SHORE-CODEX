import { BUSINESS } from '@/config/business'

/**
 * Official Sea N Shore social profiles.
 *
 * Leave a value empty until the official account exists. Empty entries are
 * never rendered, so the footer never shows a dead or invented social link.
 * Use full https:// URLs, e.g. 'https://www.linkedin.com/company/<handle>'.
 */
export const SOCIAL_LINKS = {
  // LinkedIn page address not confirmed yet — add it here when known.
  linkedin: '',
  instagram: 'https://www.instagram.com/seaandshore.in',
  youtube: '',
  facebook: 'https://www.facebook.com/seaandshore.in',
  x: 'https://x.com/inseaandshore',
} as const

/**
 * Public support inbox shown on /help and /contact. Comes from src/config/business.ts.
 * If it is ever emptied, the help page explains how to get help without it.
 */
export const SUPPORT_EMAIL: string = BUSINESS.email

const SOCIAL_LABELS: Record<keyof typeof SOCIAL_LINKS, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  x: 'X',
}

export type SocialLink = { key: keyof typeof SOCIAL_LINKS; href: string; label: string }

export function configuredSocialLinks(
  links: Readonly<Record<keyof typeof SOCIAL_LINKS, string>> = SOCIAL_LINKS,
): SocialLink[] {
  return (Object.keys(links) as Array<keyof typeof SOCIAL_LINKS>)
    .map((key) => ({ key, href: links[key].trim(), label: SOCIAL_LABELS[key] }))
    .filter((link) => /^https:\/\/[^\s]+$/.test(link.href))
}
