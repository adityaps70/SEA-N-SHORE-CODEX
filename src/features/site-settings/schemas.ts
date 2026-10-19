import { z } from 'zod'

/**
 * Round H (H7): admin-edited site settings (Admin › Site settings), stored one row per key in
 * public.site_settings (migration 0089). Each key has its own schema and default here, so every read is
 * validated and a missing or unreadable row falls back to the default (an empty section, never invented
 * content). Pure, safe to import from client and server code.
 */

export const SITE_SETTING_KEYS = ['grievance_officer', 'about_page', 'social_handles'] as const
export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number]

const optionalText = (max: number, message: string) => z.string().trim().max(max, { error: message })

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, { error: 'That email address is too long.' })
  .refine((value) => value === '' || z.email().safeParse(value).success, { error: 'Enter a valid email address, like name@example.com.' })

/** The Grievance Officer on the Contact page. Empty until the owner appoints one. */
export const grievanceOfficerSchema = z
  .object({
    name: optionalText(120, 'Keep the name under 120 characters.'),
    email: optionalEmail,
    responseTime: optionalText(120, 'Keep the response time under 120 characters.'),
  })
  .superRefine((value, context) => {
    if (value.name && !value.email) context.addIssue({ code: 'custom', path: ['email'], message: 'Add the Grievance Officer’s email address, or clear the name.' })
    if (value.email && !value.name) context.addIssue({ code: 'custom', path: ['name'], message: 'Add the Grievance Officer’s name, or clear the email address.' })
    if (value.responseTime && !value.name) context.addIssue({ code: 'custom', path: ['responseTime'], message: 'Add the Grievance Officer’s name and email before the response time.' })
  })

export type GrievanceOfficer = z.infer<typeof grievanceOfficerSchema>

/** True when the Contact page can name the officer. */
export function hasGrievanceOfficer(value: GrievanceOfficer) {
  return Boolean(value.name && value.email)
}

/** Image types an admin may upload for the About page, and the largest size. */
export const SITE_IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const
export const SITE_IMAGE_MAX_BYTES = 2 * 1024 * 1024

/** Uploaded About page images: `site/about/<uuid>.<ext>` in the media bucket (see admin-actions.ts). */
export const SITE_IMAGE_PATH = /^site\/about\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp)$/

const imagePath = z
  .string()
  .trim()
  .refine((value) => value === '' || SITE_IMAGE_PATH.test(value), { error: 'Upload the image again.' })
  .transform((value) => value || null)
  .nullable()

/** A link from the About page: https, or a page on this site (starting with "/"). */
const optionalLink = z
  .string()
  .trim()
  .max(500, { error: 'Keep the link under 500 characters.' })
  .refine((value) => value === '' || /^\/(?!\/)[^\s]*$/.test(value) || /^https:\/\/[^\s/]+\.[^\s]+$/.test(value), {
    error: 'Use a link that starts with https:// or a page on this site that starts with /.',
  })
  .transform((value) => value || null)
  .nullable()

export const aboutPersonSchema = z.object({
  name: z.string().trim().min(1, { error: 'Add the person’s name.' }).max(120, { error: 'Keep the name under 120 characters.' }),
  role: optionalText(120, 'Keep the role under 120 characters.'),
  bio: optionalText(600, 'Keep the short bio under 600 characters.'),
  photoPath: imagePath.default(null),
  profileUrl: optionalLink.default(null),
})

export const aboutPartnerSchema = z.object({
  name: z.string().trim().min(1, { error: 'Add the partner’s name.' }).max(120, { error: 'Keep the name under 120 characters.' }),
  logoPath: imagePath.default(null),
  websiteUrl: optionalLink.default(null),
})

export const memberNumbersSchema = z.object({
  /** The section is shown only when the admin switches it on. */
  enabled: z.boolean().default(false),
  members: z.boolean().default(true),
  organizations: z.boolean().default(true),
  courses: z.boolean().default(true),
})

export const ABOUT_LIMITS = { founders: 6, team: 24, partners: 24 } as const

export const aboutPageSchema = z.object({
  founders: z.array(aboutPersonSchema).max(ABOUT_LIMITS.founders, { error: `Add up to ${ABOUT_LIMITS.founders} founders.` }).default([]),
  team: z.array(aboutPersonSchema).max(ABOUT_LIMITS.team, { error: `Add up to ${ABOUT_LIMITS.team} team members.` }).default([]),
  partners: z.array(aboutPartnerSchema).max(ABOUT_LIMITS.partners, { error: `Add up to ${ABOUT_LIMITS.partners} partners.` }).default([]),
  memberNumbers: memberNumbersSchema.default({ enabled: false, members: true, organizations: true, courses: true }),
})

export type AboutPerson = z.infer<typeof aboutPersonSchema>
export type AboutPartner = z.infer<typeof aboutPartnerSchema>
export type AboutPageContent = z.infer<typeof aboutPageSchema>
export type MemberNumbersChoice = z.infer<typeof memberNumbersSchema>

/**
 * Round I (I1): Sea N Shore's social handles, shown in the footer of job share images. A handle without the "@"
 * and without a web address (e.g. seaandshore.in); empty leaves that network out.
 */
export const SOCIAL_HANDLE_NETWORKS = ['instagram', 'linkedin', 'facebook', 'x', 'youtube'] as const
export type SocialHandleNetwork = (typeof SOCIAL_HANDLE_NETWORKS)[number]
export const SOCIAL_HANDLE_LABELS: Record<SocialHandleNetwork, string> = {
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  x: 'X',
  youtube: 'YouTube',
}

const socialHandle = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, ''))
  .refine((value) => value === '' || /^[A-Za-z0-9._-]{1,60}$/.test(value), { error: 'Use the handle only: letters, numbers, dots, dashes or underscores, without a web address.' })

export const socialHandlesSchema = z.object({
  instagram: socialHandle.default(''),
  linkedin: socialHandle.default(''),
  facebook: socialHandle.default(''),
  x: socialHandle.default(''),
  youtube: socialHandle.default(''),
})

export type SocialHandles = z.infer<typeof socialHandlesSchema>

export const SITE_SETTING_SCHEMAS = {
  grievance_officer: grievanceOfficerSchema,
  about_page: aboutPageSchema,
  social_handles: socialHandlesSchema,
} as const satisfies Record<SiteSettingKey, z.ZodType>

export type SiteSettingValue<K extends SiteSettingKey> = z.infer<(typeof SITE_SETTING_SCHEMAS)[K]>

export const SITE_SETTING_DEFAULTS: { [K in SiteSettingKey]: SiteSettingValue<K> } = {
  grievance_officer: { name: '', email: '', responseTime: '' },
  about_page: { founders: [], team: [], partners: [], memberNumbers: { enabled: false, members: true, organizations: true, courses: true } },
  // The accounts already linked in the site footer (components/navigation/social-links.ts) until an admin edits them.
  social_handles: { instagram: 'seaandshore.in', linkedin: '', facebook: 'seaandshore.in', x: 'inseaandshore', youtube: '' },
}

/** A stored value read through its schema; anything that no longer validates reads as the default. */
export function parseSiteSetting<K extends SiteSettingKey>(key: K, value: unknown): SiteSettingValue<K> {
  const parsed = SITE_SETTING_SCHEMAS[key].safeParse(value)
  return parsed.success ? parsed.data as SiteSettingValue<K> : SITE_SETTING_DEFAULTS[key]
}

export function isSiteSettingKey(value: unknown): value is SiteSettingKey {
  return (SITE_SETTING_KEYS as readonly unknown[]).includes(value)
}
