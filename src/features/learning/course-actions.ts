'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { courseRepository, type CourseDraftInput } from './course-repository'

const courseIdSchema = z.string().uuid()
const courseCategories = new Set([
  'Deck',
  'Engine',
  'Tankers',
  'LNG/LPG',
  'Offshore',
  'SIRE 2.0',
  'Safety',
  'Maritime Law',
  'Leadership',
  'Human Factors',
  'Shore Careers',
  'Mental Health',
  'Exams & Assessments',
])

function normalizedList(maxItems: number) {
  return z.array(z.string()).max(maxItems * 2).transform((values, context) => {
    const seen = new Set<string>()
    const normalized: string[] = []
    for (const value of values) {
      const item = value.trim()
      if (!item) continue
      const key = item.toLocaleLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      normalized.push(item)
    }
    if (normalized.length > maxItems) {
      context.addIssue({ code: 'custom', message: `Use no more than ${maxItems} items.` })
      return z.NEVER
    }
    return normalized
  })
}

const nullableShortText = z.union([
  z.null(),
  z.string().trim().transform((value) => value || null),
]).pipe(z.union([z.null(), z.string().min(4).max(240)]))

const nullableAssetPath = z.union([
  z.null(),
  z.string().trim().transform((value) => value || null),
]).pipe(z.union([z.null(), z.string().min(1).max(1024)]))

const courseDraftSchema = z.object({
  slug: z.string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a URL-safe course slug.')),
  title: z.string().trim().min(4).max(180),
  subtitle: nullableShortText,
  description: z.string().trim().min(40).max(12000),
  category: z.string().trim().min(2).max(120).refine((value) => courseCategories.has(value), 'Choose a supported maritime learning category.'),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'all_levels']),
  language: z.string().trim().min(2).max(80),
  thumbnailPath: nullableAssetPath,
  trailerPath: nullableAssetPath,
  learningOutcomes: normalizedList(30),
  requirements: normalizedList(30),
  targetAudience: normalizedList(30),
  accessType: z.enum(['free', 'paid']),
  priceMinor: z.number().int().nonnegative(),
  discountPriceMinor: z.number().int().nonnegative().nullable(),
  currency: z.string().trim().transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.')),
  certificateEnabled: z.boolean(),
  courseFormat: z.enum(['recorded', 'live_cohort', 'hybrid']),
}).superRefine((course, context) => {
  if (course.accessType === 'free' && course.priceMinor !== 0) {
    context.addIssue({ code: 'custom', path: ['priceMinor'], message: 'Free courses must have a zero price.' })
  }
  if (course.accessType === 'paid' && course.priceMinor <= 0) {
    context.addIssue({ code: 'custom', path: ['priceMinor'], message: 'Paid courses must have a positive price.' })
  }
  if (course.discountPriceMinor !== null && course.discountPriceMinor > course.priceMinor) {
    context.addIssue({ code: 'custom', path: ['discountPriceMinor'], message: 'Discount price cannot exceed the course price.' })
  }
})

type CourseActionResult = { ok: true } | { ok: false; error: string }
type CourseCreateActionResult = { ok: true; courseId: string } | { ok: false; error: string }

function validationError(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Review the course details and try again.'
}

function mutationError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'mentor_required') return 'Approved mentor access is required to manage courses.'
    if (error.message === 'course_not_found') return 'We could not find this course in your Mentor Studio.'
    if (error.message === 'course_edit_forbidden') return 'This course cannot be edited while it is in review or published.'
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
    return 'A course with this URL slug already exists.'
  }
  return 'We could not save the course. Please try again.'
}

function refreshStudio() {
  revalidatePath('/learn/studio')
  revalidatePath('/learn/studio/courses')
}

export async function createCourseDraft(input: CourseDraftInput): Promise<CourseCreateActionResult> {
  const parsed = courseDraftSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }

  try {
    const user = await requireAwsUser()
    const result = await courseRepository.createCourse(user.id, parsed.data)
    refreshStudio()
    return { ok: true, courseId: result.courseId }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function updateCourseDraft(courseId: string, input: CourseDraftInput): Promise<CourseActionResult> {
  const parsedId = courseIdSchema.safeParse(courseId)
  if (!parsedId.success) return { ok: false, error: 'Invalid course.' }

  const parsed = courseDraftSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }

  try {
    const user = await requireAwsUser()
    await courseRepository.updateCourse(user.id, parsedId.data, parsed.data)
    refreshStudio()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}
