'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { createMediaUploadUrl } from '@/lib/aws/storage'
import { plainIssueMessage } from '@/lib/validation/plain-messages'
import { siteSettingsRepository, SiteSettingValidationError } from './repository'
import { aboutPageSchema, grievanceOfficerSchema, SITE_IMAGE_MAX_BYTES, SITE_IMAGE_TYPES, type AboutPageContent, type GrievanceOfficer } from './schemas'

/**
 * Round H (H7): Admin › Site settings. Every action is for platform administrators with admin MFA
 * (requirePlatformAdministratorUser), validates with the key's schema and is audited in the repository.
 */
export type SiteSettingsFormState<Values> = {
  status: 'idle' | 'success' | 'error'
  message?: string
  /** Keyed by the field path, e.g. "email" or "founders.0.name". */
  fieldErrors?: Record<string, string>
  values?: Values
}

const NOT_ALLOWED = 'Only platform administrators with an authenticator app can change site settings.'
const SAVE_FAILED = 'The settings could not be saved. Nothing was changed. Please try again.'

async function requireSiteSettingsAdmin() {
  return requirePlatformAdministratorUser()
}

function fieldErrorsFrom(error: z.ZodError) {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || 'form'
    errors[key] ??= plainIssueMessage(issue)
  }
  return errors
}

function refreshPublicPages() {
  revalidatePath('/admin/settings')
  revalidatePath('/contact')
  revalidatePath('/about')
}

export async function saveGrievanceOfficerAction(
  _previous: SiteSettingsFormState<GrievanceOfficer>,
  formData: FormData,
): Promise<SiteSettingsFormState<GrievanceOfficer>> {
  const values = {
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    responseTime: String(formData.get('responseTime') ?? ''),
  }
  let adminId: string
  try {
    adminId = (await requireSiteSettingsAdmin()).id
  } catch {
    return { status: 'error', message: NOT_ALLOWED, values }
  }
  const parsed = grievanceOfficerSchema.safeParse(values)
  if (!parsed.success) {
    return { status: 'error', message: 'Please fix the highlighted fields and try again.', fieldErrors: fieldErrorsFrom(parsed.error), values }
  }
  try {
    const saved = await siteSettingsRepository.set('grievance_officer', parsed.data, adminId)
    refreshPublicPages()
    return {
      status: 'success',
      message: saved.name ? 'Saved. The Contact page now names the Grievance Officer.' : 'Saved. The Contact page says a Grievance Officer is being appointed.',
      values: saved,
    }
  } catch (error) {
    if (error instanceof SiteSettingValidationError) return { status: 'error', message: error.issues[0] ?? SAVE_FAILED, values }
    console.error('[site_settings_save_failed]', { key: 'grievance_officer', code: (error as { code?: string } | null)?.code ?? null })
    return { status: 'error', message: SAVE_FAILED, values }
  }
}

function parseAboutJson(raw: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(raw ?? ''))
  } catch {
    return null
  }
}

export async function saveAboutPageAction(
  _previous: SiteSettingsFormState<AboutPageContent>,
  formData: FormData,
): Promise<SiteSettingsFormState<AboutPageContent>> {
  const raw = parseAboutJson(formData.get('about'))
  let adminId: string
  try {
    adminId = (await requireSiteSettingsAdmin()).id
  } catch {
    return { status: 'error', message: NOT_ALLOWED }
  }
  const parsed = aboutPageSchema.safeParse(raw)
  if (!parsed.success) {
    return { status: 'error', message: 'Please fix the highlighted fields and try again.', fieldErrors: fieldErrorsFrom(parsed.error) }
  }
  try {
    const saved = await siteSettingsRepository.set('about_page', parsed.data, adminId)
    refreshPublicPages()
    return { status: 'success', message: 'Saved. Sections without content stay hidden on the About page.', values: saved }
  } catch (error) {
    if (error instanceof SiteSettingValidationError) return { status: 'error', message: error.issues[0] ?? SAVE_FAILED }
    console.error('[site_settings_save_failed]', { key: 'about_page', code: (error as { code?: string } | null)?.code ?? null })
    return { status: 'error', message: SAVE_FAILED }
  }
}

const siteImageUploadSchema = z.object({
  contentType: z.enum(Object.keys(SITE_IMAGE_TYPES) as [keyof typeof SITE_IMAGE_TYPES, ...Array<keyof typeof SITE_IMAGE_TYPES>]),
  size: z.number().int().min(1).max(SITE_IMAGE_MAX_BYTES),
})

export type SiteImageUploadResult = { ok: true; uploadUrl: string; path: string } | { ok: false; error: string }

/**
 * A short-lived upload link for one About page image (a partner logo or a person's photo), stored in the
 * media bucket at site/about/<uuid>.<ext>. The page shows it through a signed read link.
 */
export async function createSiteImageUploadAction(input: { contentType: string; size: number }): Promise<SiteImageUploadResult> {
  const parsed = siteImageUploadSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Choose a PNG, JPEG or WebP image of 2 MB or less.' }
  try {
    await requireSiteSettingsAdmin()
  } catch {
    return { ok: false, error: NOT_ALLOWED }
  }
  const path = `site/about/${randomUUID()}.${SITE_IMAGE_TYPES[parsed.data.contentType]}`
  try {
    const uploadUrl = await createMediaUploadUrl({ key: path, contentType: parsed.data.contentType, contentLength: parsed.data.size })
    return { ok: true, uploadUrl, path }
  } catch (error) {
    console.error('[site_image_presign_failed]', { code: (error as { code?: string; message?: string } | null)?.code ?? null })
    return { ok: false, error: 'The upload could not be prepared. Please try again.' }
  }
}
