// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildShareContent, isPartnerStripPoster, type ShareJob, type ShareSettings } from './share-content'
import { layoutShareImage } from './share-layout'
import { defaultShareOptions, SHARE_LOOK_KEYS, SHARE_SIZE_KEYS, SHARE_SIZES, type ShareOptions } from './share-options'
import { pngSize, renderShareImage } from './share-render'
import { contrastRatio, SHARE_BADGES, SHARE_THEMES, themeTextPairs } from './share-themes'
import { measureText } from './text-fit'

const SITE = 'https://seanshore.in'

function job(overrides: Partial<ShareJob> = {}): ShareJob {
  return {
    id: '7d3f1c2a-1111-4222-8333-444455556666',
    title: 'Chief Officer – LR2 Product Tanker',
    companyName: 'Harbour Minds Ship Management',
    companyId: 'c0000000-0000-4000-8000-000000000001',
    companyLogoPath: null,
    location: 'Mumbai, India',
    salaryMin: 9000,
    salaryMax: 11000,
    salaryCurrency: 'USD',
    salaryPeriod: 'month',
    publishedAt: '2026-10-18T05:30:00.000Z',
    createdAt: '2026-10-18T05:00:00.000Z',
    updatedAt: '2026-10-18T05:30:00.000Z',
    urgent: false,
    vesselTypes: ['Product tanker'],
    experienceMinYears: 2,
    experienceMaxYears: null,
    joiningFrom: '2026-11-15',
    joiningUntil: null,
    applyUntil: '2026-11-05',
    postedByPlatformAdmin: false,
    ...overrides,
  }
}

const SETTINGS: ShareSettings = {
  socials: { instagram: 'seaandshore.in', linkedin: '', facebook: 'seaandshore.in', x: 'inseaandshore', youtube: '' },
  partners: [{ name: 'Partner One', logoPath: 'site/about/11111111-1111-4111-8111-111111111111.png' }],
}

const LONG = {
  title: 'Second Engineer (MAN B&W ME-C electronically controlled main engine experience essential) for a newbuild 174,000 cbm LNG carrier on long-term charter',
  companyName: 'Oceanic Fleet Management & Crew Services International Private Limited, Singapore Regional Office',
  location: 'Singapore, Rotterdam, Houston, Fujairah, Mumbai, Manila and other crew change ports worldwide',
  vesselTypes: ['LNG carrier (membrane, Mark III Flex)', 'LPG carrier (VLGC)', 'Ethane carrier', 'FSRU'],
}

const options = (overrides: Partial<ShareOptions> = {}): ShareOptions => ({ ...defaultShareOptions({ urgent: false }), ...overrides })

const noMedia = async () => null

describe('job share image: content (Round I, I1)', () => {
  it('fills everything from the job: label, company, title, chips, facts, footer and the QR link with src=share_image', () => {
    const content = buildShareContent(job({ urgent: true }), defaultShareOptions({ urgent: true }), SETTINGS, SITE)
    expect(content.label).toBe('Urgent hiring')
    expect(content.company).toEqual({ name: 'Harbour Minds Ship Management', logoPath: null, initials: 'HM' })
    expect(content.chips).toEqual([
      { kind: 'location', text: 'Mumbai, India' },
      { kind: 'salary', text: '$9,000–11,000/month' },
      { kind: 'posted', text: 'Posted Oct 18, 2026' },
    ])
    expect(content.facts).toEqual([
      { key: 'joining', label: 'Joining', value: 'Nov 15, 2026' },
      { key: 'experience', label: 'Experience', value: '2 years+' },
      { key: 'vessel', label: 'Vessel type', value: 'Product tanker' },
      { key: 'apply_by', label: 'Apply by', value: 'Nov 5, 2026' },
    ])
    expect(content.qrUrl).toBe('https://seanshore.in/jobs/7d3f1c2a-1111-4222-8333-444455556666?src=share_image')
    expect(content.footer).toEqual({ siteHost: 'seanshore.in', socials: ['Instagram @seaandshore.in', 'Facebook @seaandshore.in', 'X @inseaandshore'] })
    // Never a job id or reference on the image itself (only inside the QR link).
    const visible = JSON.stringify({ ...content, qrUrl: null, applyUrl: null })
    expect(visible).not.toContain('7d3f1c2a')
    expect(defaultShareOptions({ urgent: false }).label).toBe('now_hiring')
  })

  it('hides missing fields and switched-off options', () => {
    const bare = job({ location: null, salaryMin: null, salaryMax: null, vesselTypes: [], experienceMinYears: null, joiningFrom: null, applyUntil: null })
    const content = buildShareContent(bare, options(), SETTINGS, SITE)
    expect(content.chips.map((chip) => chip.kind)).toEqual(['posted'])
    expect(content.facts).toEqual([])
    expect(layoutShareImage(content, 'portrait').facts).toBeNull()

    const switchedOff = buildShareContent(job(), options({ salary: false, qr: false, facts: ['experience'] }), SETTINGS, SITE)
    expect(switchedOff.chips.map((chip) => chip.kind)).toEqual(['location', 'posted'])
    expect(switchedOff.facts.map((fact) => fact.key)).toEqual(['experience'])
    expect(switchedOff.qrUrl).toBeNull()
    expect(layoutShareImage(switchedOff, 'square').footer.qrSize).toBeNull()
  })

  it('shows the partner strip only on jobs by a platform administrator or Beaufort Marine Services LLP, and only with logos', () => {
    expect(buildShareContent(job(), options(), SETTINGS, SITE).partners).toEqual([])
    expect(buildShareContent(job({ postedByPlatformAdmin: true }), options(), SETTINGS, SITE).partners).toHaveLength(1)
    expect(buildShareContent(job({ companyName: 'BEAUFORT MARINE SERVICES LLP' }), options(), SETTINGS, SITE).partners).toHaveLength(1)
    expect(isPartnerStripPoster({ companyName: 'Beaufort Marine Services', postedByPlatformAdmin: false })).toBe(true)
    expect(isPartnerStripPoster({ companyName: 'Not Beaufort Marine Services LLP Ltd', postedByPlatformAdmin: false })).toBe(false)
    const empty = { ...SETTINGS, partners: [{ name: 'No Logo', logoPath: null }] }
    expect(buildShareContent(job({ postedByPlatformAdmin: true }), options(), empty, SITE).partners).toEqual([])
    expect(layoutShareImage(buildShareContent(job(), options(), SETTINGS, SITE), 'portrait').partners).toBeNull()
  })
})

describe('job share image: auto-fit (Round I, I1)', () => {
  const extremes: Array<[string, ShareJob, Partial<ShareOptions>]> = [
    ['long title and company, every fact, partner strip', job({ ...LONG, postedByPlatformAdmin: true, salaryMin: 1234567, salaryMax: 2345678, salaryCurrency: 'INR', salaryPeriod: 'month', joiningUntil: '2027-01-31', experienceMaxYears: 12 }), {}],
    ['one very long word', job({ title: 'Superintendent'.repeat(12), companyName: 'X'.repeat(160) }), {}],
    ['short everything', job({ title: 'AB', companyName: 'Q', location: 'X' }), { qr: false, salary: false }],
  ]

  for (const size of SHARE_SIZE_KEYS) {
    for (const [name, value, overrides] of extremes) {
      it(`${size}: ${name} stays inside its boxes`, () => {
        const content = buildShareContent(value, options(overrides), SETTINGS, SITE)
        const layout = layoutShareImage(content, size)
        expect(layout.checks.filter((check) => !check.ok)).toEqual([])
        expect(layout.fits).toBe(true)
        expect(layout.title.lines.length).toBeGreaterThanOrEqual(1)
        expect(layout.title.lines.length).toBeLessThanOrEqual(3)
        for (const line of layout.title.lines) expect(measureText(line, 'title', layout.title.size)).toBeLessThanOrEqual(layout.main.width + 0.5)
        for (const line of layout.company.name.lines) expect(measureText(line, 'heading', layout.company.name.size)).toBeLessThanOrEqual(layout.company.nameWidth + 0.5)
        // Nothing is drawn below the top of the partner strip / footer.
        const usedHeight = layout.main.y + layout.main.height
        expect(usedHeight).toBeLessThanOrEqual(SHARE_SIZES[size].height - layout.footer.height)
      })
    }
  }

  it.each(SHARE_SIZE_KEYS)('%s: shows all three default social handles inside the footer, never cut', (size) => {
    const layout = layoutShareImage(buildShareContent(job(), options(), SETTINGS, SITE), size)
    expect(layout.footer.socials).toEqual(['Instagram @seaandshore.in', 'Facebook @seaandshore.in', 'X @inseaandshore'])
    expect(layout.footer.socialLines.length).toBeLessThanOrEqual(2)
    for (const line of layout.footer.socialLines) expect(measureText(line, 'body', layout.footer.socialSize)).toBeLessThanOrEqual(layout.footer.textWidth)
    expect(layout.checks.filter((check) => !check.ok)).toEqual([])
  })

  it('gives a short title the biggest type and shrinks a long one', () => {
    const short = layoutShareImage(buildShareContent(job({ title: 'Master' }), options(), SETTINGS, SITE), 'portrait')
    const long = layoutShareImage(buildShareContent(job({ title: LONG.title }), options(), SETTINGS, SITE), 'portrait')
    expect(short.title.size).toBeGreaterThan(long.title.size)
    expect(short.title.lines).toEqual(['Master'])
  })
})

describe('job share image: looks (Round I, I1)', () => {
  it('passes WCAG AA (4.5:1) for every text colour on every background, in all five looks and four badges', () => {
    expect(Object.keys(SHARE_THEMES)).toEqual(['sky', 'navy', 'teal', 'midnight', 'white'])
    for (const look of SHARE_LOOK_KEYS) {
      for (const pair of themeTextPairs(SHARE_THEMES[look])) {
        expect(contrastRatio(pair.text, pair.on), `${look} ${pair.role}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    for (const [name, badge] of Object.entries(SHARE_BADGES)) expect(contrastRatio(badge.text, badge.background), name).toBeGreaterThanOrEqual(4.5)
  })
})

describe('job share image: PNG (Round I, I1)', () => {
  it.each(SHARE_SIZE_KEYS)('renders %s as a PNG of exactly that size', async (size) => {
    const content = buildShareContent(job(), options({ size }), SETTINGS, SITE)
    const { png, layout } = await renderShareImage({ content, options: options({ size }), loadMedia: noMedia })
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(pngSize(png)).toEqual({ width: SHARE_SIZES[size].width, height: SHARE_SIZES[size].height })
    expect(layout.fits).toBe(true)
  }, 30_000)

  it('renders a very long title and company name without failing', async () => {
    const value = job({ ...LONG, postedByPlatformAdmin: true })
    const opts = options({ size: 'square', look: 'midnight' })
    const { png, layout } = await renderShareImage({ content: buildShareContent(value, opts, SETTINGS, SITE), options: opts, loadMedia: noMedia })
    expect(pngSize(png)).toEqual({ width: 1080, height: 1080 })
    expect(layout.fits).toBe(true)
  }, 30_000)

  // SHARE_SAMPLES_DIR=<dir> writes every size × look for a visual check (not run in CI).
  it.runIf(Boolean(process.env.SHARE_SAMPLES_DIR))('writes samples', async () => {
    const directory = process.env.SHARE_SAMPLES_DIR!
    mkdirSync(directory, { recursive: true })
    for (const size of SHARE_SIZE_KEYS) {
      for (const look of SHARE_LOOK_KEYS) {
        const opts = options({ size, look, label: 'urgent_hiring' })
        const { png } = await renderShareImage({ content: buildShareContent(job({ postedByPlatformAdmin: false }), opts, SETTINGS, SITE), options: opts, loadMedia: noMedia })
        writeFileSync(join(directory, `${size}-${look}.png`), png)
      }
    }
    const opts = options({ size: 'portrait', look: 'navy' })
    const { png } = await renderShareImage({ content: buildShareContent(job({ ...LONG }), opts, SETTINGS, SITE), options: opts, loadMedia: noMedia })
    writeFileSync(join(directory, 'portrait-navy-long.png'), png)
  }, 120_000)
})
