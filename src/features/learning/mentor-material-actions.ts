'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { verifyLearningMediaObject } from './media'
import { mentorMaterialRepository, type MentorMaterialDraft, type MaterialType } from './mentor-material-repository'
import type { LearningMediaKind } from './media-policy'

const uuidSchema = z.string().uuid()
const materialTypeSchema = z.enum([
  'video', 'article', 'image', 'pdf', 'presentation_document', 'audio', 'external_embed', 'quiz',
  'assignment', 'downloadable_resource', 'scorm', 'live_session',
])
const releaseModeSchema = z.enum(['immediate', 'scheduled', 'drip'])
const completionRuleSchema = z.enum(['manual', 'view', 'media_percentage', 'quiz_pass', 'assignment_submit', 'scorm_completion'])
const embedKindSchema = z.enum(['youtube', 'vimeo', 'generic'])
const navigationModeSchema = z.enum(['free', 'sequential'])

const nullableText = (max: number) => z.union([z.null(), z.string().trim().max(max).transform((value) => value || null)])
const nullableUrl = z.union([
  z.null(),
  z.string().trim().max(2048).transform((value) => value || null),
]).refine((value) => {
  if (value === null) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}, 'Use a valid http(s) URL.')

const assignmentSchema = z.object({
  instructions: z.string().trim().min(1).max(12000),
  acceptedExtensions: z.array(z.string().trim().regex(/^\.[a-z0-9]{1,10}$/i)).max(20),
  maxUploadBytes: z.number().int().min(1).max(100 * 1024 * 1024),
})

const materialSchema = z.object({
  title: z.string().trim().min(1).max(180),
  materialType: materialTypeSchema,
  summary: nullableText(2000),
  articleBody: nullableText(100000),
  assetPath: nullableText(1024),
  externalUrl: nullableUrl,
  durationSeconds: z.union([z.null(), z.number().int().nonnegative()]),
  isPreview: z.boolean(),
  isDownloadable: z.boolean(),
  isPublished: z.boolean(),
  releaseMode: releaseModeSchema,
  releaseAt: z.union([z.null(), z.string().datetime({ offset: true })]),
  dripDelayDays: z.union([z.null(), z.number().int().min(0).max(3650)]),
  prerequisiteLessonId: z.union([z.null(), uuidSchema]),
  completionRule: completionRuleSchema,
  completionThreshold: z.union([z.null(), z.number().int().min(1).max(100)]),
  maxAttempts: z.union([z.null(), z.number().int().min(1).max(1000)]),
  embedKind: z.union([z.null(), embedKindSchema]),
  assignment: z.union([z.null(), assignmentSchema]),
}).superRefine((material, context) => {
  if (material.releaseMode === 'immediate' && (material.releaseAt !== null || material.dripDelayDays !== null)) {
    context.addIssue({ code: 'custom', path: ['releaseMode'], message: 'Immediate release cannot include a date or drip delay.' })
  }
  if (material.releaseMode === 'scheduled' && (!material.releaseAt || material.dripDelayDays !== null)) {
    context.addIssue({ code: 'custom', path: ['releaseAt'], message: 'Scheduled release requires a release date.' })
  }
  if (material.releaseMode === 'drip' && (material.dripDelayDays === null || material.releaseAt !== null)) {
    context.addIssue({ code: 'custom', path: ['dripDelayDays'], message: 'Drip release requires a delay after enrollment.' })
  }
  if (material.materialType === 'article' && !material.articleBody) {
    context.addIssue({ code: 'custom', path: ['articleBody'], message: 'Article materials require content.' })
  }
  if (['video', 'image', 'pdf', 'presentation_document', 'audio', 'downloadable_resource', 'scorm'].includes(material.materialType)
    && !material.assetPath && !material.externalUrl) {
    context.addIssue({ code: 'custom', path: ['assetPath'], message: 'Upload a file or provide an external URL.' })
  }
  if (material.materialType === 'external_embed' && (!material.externalUrl || !material.embedKind)) {
    context.addIssue({ code: 'custom', path: ['externalUrl'], message: 'Embedded materials require a URL and provider.' })
  }
  if (material.materialType === 'live_session' && !material.externalUrl) {
    context.addIssue({ code: 'custom', path: ['externalUrl'], message: 'Live sessions require a meeting URL.' })
  }
  if (material.materialType === 'assignment' && !material.assignment) {
    context.addIssue({ code: 'custom', path: ['assignment'], message: 'Assignments require learner instructions.' })
  }
  const expected: Partial<Record<MaterialType, MentorMaterialDraft['completionRule']>> = {
    quiz: 'quiz_pass',
    assignment: 'assignment_submit',
    scorm: 'scorm_completion',
  }
  const expectedRule = expected[material.materialType]
  if (expectedRule && material.completionRule !== expectedRule) {
    context.addIssue({ code: 'custom', path: ['completionRule'], message: `This material must use ${expectedRule.replaceAll('_', ' ')} completion.` })
  }
  if (material.completionRule === 'media_percentage' && material.completionThreshold === null) {
    context.addIssue({ code: 'custom', path: ['completionThreshold'], message: 'Media completion requires a percentage threshold.' })
  }
})

type MutationResult = { ok: true } | { ok: false; error: string }
type CreateResult = { ok: true; materialId: string } | { ok: false; error: string }

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'course_not_found') return 'We could not find this course in your Mentor Studio.'
    if (error.message === 'course_edit_forbidden') return 'This course is read-only while it is under review or published.'
    if (error.message === 'section_not_found') return 'We could not find this section.'
    if (error.message === 'material_not_found') return 'We could not find this material.'
    if (error.message === 'prerequisite_not_found') return 'The prerequisite must belong to this course.'
    if (error.message === 'prerequisite_self') return 'A material cannot depend on itself.'
  }
  return 'We could not save this material. Please try again.'
}

function refresh(courseId: string) {
  revalidatePath(`/learn/studio/courses/${courseId}/edit`)
  revalidatePath('/learn/studio')
}

function uploadKind(materialType: MaterialType): LearningMediaKind | null {
  switch (materialType) {
    case 'video': return 'lesson_video'
    case 'image': return 'lesson_image'
    case 'audio': return 'lesson_audio'
    case 'pdf':
    case 'presentation_document': return 'lesson_document'
    case 'downloadable_resource': return 'lesson_resource'
    case 'scorm': return 'scorm_package'
    default: return null
  }
}

async function verifyAsset(userId: string, courseId: string, draft: MentorMaterialDraft) {
  if (!draft.assetPath) return
  const kind = uploadKind(draft.materialType)
  if (!kind) return
  await verifyLearningMediaObject({ userId, courseId, kind, storagePath: draft.assetPath })
}

export async function createCurriculumMaterial(courseId: string, sectionId: string, input: MentorMaterialDraft): Promise<CreateResult> {
  const course = uuidSchema.safeParse(courseId)
  const section = uuidSchema.safeParse(sectionId)
  const material = materialSchema.safeParse(input)
  if (!course.success || !section.success) return { ok: false, error: 'Invalid course or section.' }
  if (!material.success) return { ok: false, error: material.error.issues[0]?.message ?? 'Review the material details.' }
  try {
    const user = await requireAwsUser()
    await verifyAsset(user.id, course.data, material.data)
    const result = await mentorMaterialRepository.createMaterial(user.id, course.data, section.data, material.data)
    refresh(course.data)
    return { ok: true, materialId: result.materialId }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

export async function updateCurriculumMaterial(courseId: string, materialId: string, input: MentorMaterialDraft): Promise<MutationResult> {
  const course = uuidSchema.safeParse(courseId)
  const materialIdResult = uuidSchema.safeParse(materialId)
  const material = materialSchema.safeParse(input)
  if (!course.success || !materialIdResult.success) return { ok: false, error: 'Invalid course or material.' }
  if (!material.success) return { ok: false, error: material.error.issues[0]?.message ?? 'Review the material details.' }
  try {
    const user = await requireAwsUser()
    await verifyAsset(user.id, course.data, material.data)
    await mentorMaterialRepository.updateMaterial(user.id, course.data, materialIdResult.data, material.data)
    refresh(course.data)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

export async function updateCourseNavigationMode(courseId: string, mode: 'free' | 'sequential'): Promise<MutationResult> {
  const course = uuidSchema.safeParse(courseId)
  const parsedMode = navigationModeSchema.safeParse(mode)
  if (!course.success || !parsedMode.success) return { ok: false, error: 'Invalid course navigation setting.' }
  try {
    const user = await requireAwsUser()
    await mentorMaterialRepository.updateNavigationMode(user.id, course.data, parsedMode.data)
    refresh(course.data)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}
