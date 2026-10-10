'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { BatchError } from '../batches/batch-repository'
import { batchRefusalMessage } from '../batches/batch-rules'
import { crewRepository } from './crew-repository'
import { CrewError, crewRefusalMessage, crewTagsSchema, parseInviteEmails } from './crew-rules'
import { seatRepository } from './seat-repository'
import { SeatError, seatRefusalMessage } from './seat-rules'
import { trainingRepository } from './training-repository'

/**
 * D3 company training crew and seats. The company side (owner, administrators, learning managers of a verified
 * organization, checked again in every write) invites people, tags them and gives them seats; the member side answers
 * an invitation and can stop sharing. Messages are plain words; errors never echo raw input.
 */

export type CrewActionResult = { ok: true; message: string } | { ok: false; error: string }

const uuid = z.string().uuid()

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof CrewError) return crewRefusalMessage(error.code)
  if (error instanceof SeatError) return seatRefusalMessage(error.code)
  if (error instanceof BatchError) return batchRefusalMessage(error.code) ?? fallback
  console.error('company_training_action_failed', { message: error instanceof Error ? error.message : null })
  return fallback
}

async function refreshCompany(companyId: string) {
  const slug = await trainingRepository.companySlug(companyId).catch(() => null)
  if (!slug) return
  try {
    revalidatePath(`/organizations/${slug}/training`)
  } catch {
    // Best effort.
  }
}

function refreshMember() {
  for (const path of ['/learn/my-learning', '/learn']) {
    try {
      revalidatePath(path)
    } catch {
      // Best effort.
    }
  }
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

export async function inviteCrewAction(companyId: string, input: { emails: string; vessel?: string; rank?: string }): Promise<CrewActionResult> {
  const company = uuid.safeParse(companyId)
  const tags = crewTagsSchema.safeParse({ vessel: input.vessel ?? null, rank: input.rank ?? null })
  if (!company.success) return { ok: false, error: seatRefusalMessage('company_not_found') }
  if (!tags.success) return { ok: false, error: 'Vessel and rank can be up to 80 characters each.' }
  const { valid, invalid } = parseInviteEmails(String(input.emails ?? '').slice(0, 20_000))
  if (!valid.length) return { ok: false, error: invalid.length ? `These are not email addresses: ${invalid.slice(0, 3).join(', ')}.`.slice(0, 300) : crewRefusalMessage('invite_none') }
  try {
    const user = await requireAwsUser()
    const outcome = await crewRepository.invite({ actorId: user.id }, company.data, { emails: valid, vessel: tags.data.vessel ?? null, rank: tags.data.rank ?? null })
    await refreshCompany(company.data)
    const parts = [
      outcome.invited ? `Invited ${plural(outcome.invited, 'person', 'people')}. They get an email to accept.` : null,
      outcome.alreadyInvited ? `${plural(outcome.alreadyInvited, 'address was', 'addresses were')} already invited.` : null,
      outcome.alreadyInCrew ? `${plural(outcome.alreadyInCrew, 'person is', 'people are')} already in your crew.` : null,
      invalid.length ? `${plural(invalid.length, 'entry was', 'entries were')} not an email address and ${invalid.length === 1 ? 'was' : 'were'} skipped.` : null,
    ].filter(Boolean)
    return { ok: true, message: parts.join(' ') || 'Nothing to send.' }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'We could not send these invitations. Please try again.') }
  }
}

export async function cancelCrewInvitationAction(companyId: string, invitationId: string): Promise<CrewActionResult> {
  if (!uuid.safeParse(companyId).success || !uuid.safeParse(invitationId).success) return { ok: false, error: crewRefusalMessage('invitation_not_found') }
  try {
    const user = await requireAwsUser()
    await crewRepository.cancelInvitation({ actorId: user.id }, companyId, invitationId)
    await refreshCompany(companyId)
    return { ok: true, message: 'Invitation cancelled.' }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'We could not cancel this invitation. Please try again.') }
  }
}

export async function updateCrewTagsAction(companyId: string, profileId: string, input: { vessel?: string; rank?: string }): Promise<CrewActionResult> {
  const tags = crewTagsSchema.safeParse({ vessel: input.vessel ?? null, rank: input.rank ?? null })
  if (!uuid.safeParse(companyId).success || !uuid.safeParse(profileId).success) return { ok: false, error: crewRefusalMessage('crew_member_not_found') }
  if (!tags.success) return { ok: false, error: 'Vessel and rank can be up to 80 characters each.' }
  try {
    const user = await requireAwsUser()
    await crewRepository.updateTags({ actorId: user.id }, companyId, profileId, { vessel: tags.data.vessel ?? null, rank: tags.data.rank ?? null })
    await refreshCompany(companyId)
    return { ok: true, message: 'Saved.' }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'We could not save these details. Please try again.') }
  }
}

export async function removeCrewMemberAction(companyId: string, profileId: string): Promise<CrewActionResult> {
  if (!uuid.safeParse(companyId).success || !uuid.safeParse(profileId).success) return { ok: false, error: crewRefusalMessage('crew_member_not_found') }
  try {
    const user = await requireAwsUser()
    await crewRepository.remove({ actorId: user.id }, companyId, profileId)
    await refreshCompany(companyId)
    return { ok: true, message: 'Removed from your crew. Seats they hold stay in use, and you no longer see their progress.' }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'We could not remove this person. Please try again.') }
  }
}

export async function assignSeatsAction(companyId: string, input: { courseId: string; profileIds: string[]; batchId?: string | null }): Promise<CrewActionResult> {
  const parsed = z.object({ courseId: z.string().uuid(), profileIds: z.array(z.string().uuid()).min(1).max(200), batchId: z.string().uuid().nullable().optional() }).safeParse(input)
  if (!uuid.safeParse(companyId).success) return { ok: false, error: seatRefusalMessage('company_not_found') }
  if (!parsed.success) return { ok: false, error: 'Choose a course and at least one crew member.' }
  try {
    const user = await requireAwsUser()
    const outcomes = await seatRepository.assign({ actorId: user.id }, companyId, { courseId: parsed.data.courseId, profileIds: parsed.data.profileIds, batchId: parsed.data.batchId ?? null })
    await refreshCompany(companyId)
    const assigned = outcomes.filter((outcome) => outcome.ok).length
    const refused = outcomes.filter((outcome): outcome is Extract<typeof outcome, { ok: false }> => !outcome.ok)
    if (!assigned) return { ok: false, error: refused[0] ? seatRefusalMessage(refused[0].code) : 'No seats were assigned.' }
    const reasons = [...new Set(refused.map((outcome) => seatRefusalMessage(outcome.code)))]
    return {
      ok: true,
      message: [`Assigned ${plural(assigned, 'seat', 'seats')}. Each learner is enrolled and gets an email.`, refused.length ? `${plural(refused.length, 'person was', 'people were')} skipped: ${reasons.join(' ')}` : null].filter(Boolean).join(' '),
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'We could not assign these seats. Please try again.') }
  }
}

export async function reassignSeatAction(companyId: string, input: { seatId: string; toProfileId: string; batchId?: string | null }): Promise<CrewActionResult> {
  const parsed = z.object({ seatId: z.string().uuid(), toProfileId: z.string().uuid(), batchId: z.string().uuid().nullable().optional() }).safeParse(input)
  if (!uuid.safeParse(companyId).success || !parsed.success) return { ok: false, error: seatRefusalMessage('seat_not_found') }
  try {
    const user = await requireAwsUser()
    await seatRepository.reassign({ actorId: user.id }, companyId, { seatId: parsed.data.seatId, toProfileId: parsed.data.toProfileId, batchId: parsed.data.batchId ?? null })
    await refreshCompany(companyId)
    return { ok: true, message: 'Seat moved. The new learner is enrolled; the previous learner no longer has access from this seat.' }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'We could not move this seat. Please try again.') }
  }
}

export async function acceptCompanyInvitationAction(invitationId: string): Promise<CrewActionResult> {
  if (!uuid.safeParse(invitationId).success) return { ok: false, error: crewRefusalMessage('invitation_not_found') }
  try {
    const user = await requireAwsUser()
    const invitation = await crewRepository.accept(user.id, invitationId)
    refreshMember()
    await refreshCompany(invitation.companyId)
    return { ok: true, message: `You joined ${invitation.companyName}'s crew training. Courses it assigns you appear in My Learning.` }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'We could not accept this invitation. Please try again.') }
  }
}

export async function declineCompanyInvitationAction(invitationId: string): Promise<CrewActionResult> {
  if (!uuid.safeParse(invitationId).success) return { ok: false, error: crewRefusalMessage('invitation_not_found') }
  try {
    const user = await requireAwsUser()
    const invitation = await crewRepository.decline(user.id, invitationId)
    refreshMember()
    await refreshCompany(invitation.companyId)
    return { ok: true, message: `Declined. ${invitation.companyName} has not been given anything.` }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'We could not decline this invitation. Please try again.') }
  }
}

export async function stopSharingAction(companyId: string): Promise<CrewActionResult> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: crewRefusalMessage('crew_member_not_found') }
  try {
    const user = await requireAwsUser()
    await crewRepository.withdraw(user.id, companyId)
    refreshMember()
    await refreshCompany(companyId)
    return { ok: true, message: 'You stopped sharing. Your courses stay yours; the company now sees only that you stopped sharing.' }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'We could not change this just now. Please try again.') }
  }
}
