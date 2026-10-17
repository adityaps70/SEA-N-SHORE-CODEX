import { describe, expect, it } from 'vitest'
import { createCoursePageRepository, shortBio } from './course-page-repository'

const courseId = '22222222-2222-4222-8222-222222222222'

function recorder(responses: Array<Record<string, unknown>[]>) {
  const seen: Array<{ text: string; values?: readonly unknown[] }> = []
  let call = 0
  const query = async (text: string, values?: readonly unknown[]) => {
    seen.push({ text, values })
    return responses[call++] ?? []
  }
  return { seen, query }
}

describe('course page repository (Round H, H7)', () => {
  it('reads list-price evidence from paid, undiscounted, non-seat-pack orders in the last 90 days', async () => {
    const { seen, query } = recorder([[{ course_id: courseId, plan_id: null, list_price_minor: '300000', currency: 'INR' }]])
    const sales = await createCoursePageRepository({ query }).listRecentListPriceSales([courseId, courseId])
    expect(sales).toEqual([{ courseId, planId: null, listPriceMinor: 300000, currency: 'INR' }])
    const sql = seen[0]!.text
    expect(sql).toMatch(/from public\.course_payment_orders/)
    expect(sql).toMatch(/status = 'paid'/)
    expect(sql).toMatch(/paid_at > now\(\) - make_interval\(days => \$2::int\)/)
    expect(sql).toMatch(/discount_price_minor is null/)
    expect(sql).toMatch(/coalesce\(promo_discount_minor, 0\) = 0/)
    expect(sql).toMatch(/seat_company_id is null/)
    expect(sql).toMatch(/amount_minor = list_price_minor/)
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/i)
    expect(seen[0]!.values).toEqual([[courseId], 90])
  })

  it('skips the query when there are no courses', async () => {
    const { seen, query } = recorder([])
    await expect(createCoursePageRepository({ query }).listRecentListPriceSales([])).resolves.toEqual([])
    expect(seen).toHaveLength(0)
  })

  it('builds the trainer card with bio, photo and up to three other courses', async () => {
    const { seen, query } = recorder([
      [{ kind: 'person', name: 'Placeholder Trainer', slug: 'placeholder-trainer', short_bio: 'Master Mariner with tanker experience.', avatar_path: 'profiles/u1/avatar.jpg', company_id: null, logo_path: null, tagline: null, description: null, mentor_id: 'm1', publisher_company_id: null }],
      [{ id: 'c2', slug: 'other-course', title: 'Other course' }],
    ])
    await expect(createCoursePageRepository({ query }).getPublisherCard(courseId)).resolves.toEqual({
      kind: 'person',
      name: 'Placeholder Trainer',
      href: '/people/placeholder-trainer',
      bio: 'Master Mariner with tanker experience.',
      photoPath: 'profiles/u1/avatar.jpg',
      logoUrl: null,
      otherCourses: [{ id: 'c2', slug: 'other-course', title: 'Other course' }],
    })
    expect(seen[1]!.text).toMatch(/course\.status = 'published'/)
    expect(seen[1]!.text).toMatch(/course\.is_discoverable = true/)
    expect(seen[1]!.values).toEqual([courseId, null, 'm1', 3])
  })

  it('builds the organization card from its tagline and logo', async () => {
    const { query } = recorder([
      [{ kind: 'organization', name: 'Placeholder Shipping', slug: 'placeholder-shipping', short_bio: null, avatar_path: null, company_id: 'co1', logo_path: 'organizations/co1/logo-abc.png', tagline: 'Ship management', description: null, mentor_id: null, publisher_company_id: 'co1' }],
      [],
    ])
    await expect(createCoursePageRepository({ query }).getPublisherCard(courseId)).resolves.toMatchObject({
      kind: 'organization', href: '/organizations/placeholder-shipping', bio: 'Ship management', photoPath: null, logoUrl: expect.stringMatching(/^\/api\/company-logo\/co1\?v=/), otherCourses: [],
    })
  })

  it('returns certificate preview settings only when the course issues certificates', async () => {
    const enabled = recorder([[{ certificate_enabled: true, certificate_template: 'formal', certificate_signatory_name: 'Placeholder Signatory', certificate_signatory_title: 'Director', certificate_serial_prefix: 'SNS-SIRE-', certificate_validity_months: '24' }]])
    await expect(createCoursePageRepository({ query: enabled.query }).getCertificatePreviewSettings(courseId)).resolves.toEqual({
      template: 'formal', signatoryName: 'Placeholder Signatory', signatoryTitle: 'Director', serialPrefix: 'SNS-SIRE-', validityMonths: 24,
    })
    const disabled = recorder([[{ certificate_enabled: false }]])
    await expect(createCoursePageRepository({ query: disabled.query }).getCertificatePreviewSettings(courseId)).resolves.toBeNull()
  })

  it('shortens long bios on a word boundary', () => {
    expect(shortBio('  a   b  ')).toBe('a b')
    expect(shortBio('')).toBeNull()
    const long = shortBio('word '.repeat(100), 40)!
    expect(long.length).toBeLessThanOrEqual(40)
    expect(long.endsWith('…')).toBe(true)
  })
})
