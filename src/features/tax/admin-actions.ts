'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withTransaction } from '@/lib/db/client'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { firstPlainIssue } from '@/lib/validation/plain-messages'
import { financialYearOf } from './gst'
import { saveLutRegistration, updateTdsSettings } from './tax-settings'

export type TaxAdminResult = { ok: true; message: string } | { ok: false; error: string; field?: string }

const TAX_PATHS = ['/admin/payments/tax', '/admin/payments/payouts']
const NOT_ADMIN = 'Only Sea N Shore platform administrators can do this.'

class NotAdminError extends Error {}

async function requireAdmin() {
  try {
    return await requirePlatformAdministratorUser()
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') throw new NotAdminError()
    throw error
  }
}

function refresh() {
  for (const path of TAX_PATHS) revalidatePath(path)
}

const tdsSchema = z.object({
  section: z.string().trim().toUpperCase().regex(/^[0-9]{3}[A-Z]{0,3}$/, 'Enter the TDS section, for example 194J.'),
  rate: z.string().trim().refine((value) => value === '' || /^\d{1,2}(\.\d{1,2})?$/.test(value), 'Enter the TDS rate as a percentage, for example 10 or 2, or leave it empty.')
    .refine((value) => value === '' || (Number(value) > 0 && Number(value) <= 30), 'Enter a TDS rate above 0% and at most 30%.'),
  threshold: z.string().trim().refine((value) => value === '' || /^\d{1,9}(\.\d{1,2})?$/.test(value.replaceAll(',', '')), 'Enter the yearly threshold in rupees, for example 30000, or leave it empty.'),
})

/** Admin: TDS section, rate and yearly threshold for course-seller payouts. An empty rate keeps course payouts on hold. */
export async function updateTdsSettingsAction(input: { section: string; rate: string; threshold: string }): Promise<TaxAdminResult> {
  const parsed = tdsSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: firstPlainIssue(parsed.error, 'Check the highlighted field.'), field: issue ? String(issue.path[0]) : undefined }
  }
  try {
    const admin = await requireAdmin()
    const rateBasisPoints = parsed.data.rate === '' ? null : Math.round(Number(parsed.data.rate) * 100)
    const thresholdMinor = parsed.data.threshold === '' ? null : Math.round(Number(parsed.data.threshold.replaceAll(',', '')) * 100)
    await withTransaction((tx) => updateTdsSettings(tx, { section: parsed.data.section, rateBasisPoints, thresholdMinor, actorProfileId: admin.id }))
    refresh()
    return {
      ok: true,
      message: rateBasisPoints === null
        ? 'Saved. Course payouts stay on hold until a TDS rate is set.'
        : `Saved. TDS under section ${parsed.data.section} at ${rateBasisPoints / 100}% applies to course payouts from now on.`,
    }
  } catch (error) {
    if (error instanceof NotAdminError) return { ok: false, error: NOT_ADMIN }
    console.error('tds_settings_update_failed', { name: error instanceof Error ? error.name : null })
    return { ok: false, error: "We couldn't save the TDS settings. Nothing was changed. Please try again." }
  }
}

const lutSchema = z.object({
  financialYear: z.string().trim().regex(/^[0-9]{4}-[0-9]{2}$/, 'Choose the financial year, for example 2026-27.')
    .refine((value) => (Number(value.slice(0, 4)) + 1) % 100 === Number(value.slice(5, 7)), 'Choose a financial year such as 2026-27.'),
  arn: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10,20}$/, 'Enter the LUT ARN exactly as on the GST portal (10 to 20 letters and digits).'),
})

/** Admin: the GST LUT ARN for a financial year. While none is saved for the current year, USD course sales stay off. */
export async function saveLutAction(input: { financialYear: string; arn: string }): Promise<TaxAdminResult> {
  const parsed = lutSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: firstPlainIssue(parsed.error, 'Check the highlighted field.'), field: issue ? String(issue.path[0]) : undefined }
  }
  try {
    const admin = await requireAdmin()
    await withTransaction((tx) => saveLutRegistration(tx, { ...parsed.data, actorProfileId: admin.id }))
    refresh()
    const current = parsed.data.financialYear === financialYearOf(new Date())
    return { ok: true, message: current ? `Saved. USD course purchases are open for ${parsed.data.financialYear} as exports under this LUT.` : `Saved for ${parsed.data.financialYear}.` }
  } catch (error) {
    if (error instanceof NotAdminError) return { ok: false, error: NOT_ADMIN }
    console.error('lut_save_failed', { name: error instanceof Error ? error.name : null })
    return { ok: false, error: "We couldn't save the LUT. Nothing was changed. Please try again." }
  }
}
