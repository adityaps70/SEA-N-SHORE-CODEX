import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('Sea N Shore premium page and Events presentation contract', () => {
  it('shares the Events navy-to-teal premium hero across top-level product pages', () => {
    const heroPath = 'src/components/product/premium-page-hero.tsx'
    expect(existsSync(resolve(root, heroPath))).toBe(true)
    if (!existsSync(resolve(root, heroPath))) return

    const hero = source(heroPath)
    expect(hero).toContain('bg-gradient-to-br')
    expect(hero).toContain('from-navy-950')
    expect(hero).toContain('via-navy-900')
    expect(hero).toContain('to-teal-800')
    expect(hero).toContain('rounded-[2rem]')

    for (const page of [
      'src/components/product/product-surface.tsx',
      'src/app/(app)/events/page.tsx',
      'src/app/(app)/jobs/page.tsx',
      'src/app/(app)/network/page.tsx',
    ]) {
      expect(source(page)).toContain('PremiumPageHero')
    }
  })

  it('uses sea-green for the prominent Jobs hero action', () => {
    const jobs = source('src/app/(app)/jobs/page.tsx')
    expect(jobs).toContain('bg-teal-400')
    expect(jobs).toContain('hover:bg-teal-300')
  })

  it('uses one minimal focus layer across forms while keeping keyboard controls accessible', () => {
    const globalCss = source('src/app/globals.css')
    const form = source('src/features/events/components/event-form.tsx')

    expect(globalCss).toContain('input:focus-visible')
    expect(globalCss).toContain('textarea:focus-visible')
    expect(globalCss).toContain('select:focus-visible')
    expect(globalCss).toContain('border-color: var(--teal-500)')
    expect(globalCss).toContain('box-shadow: none !important')
    expect(globalCss).toContain('outline: none')
    expect(globalCss).toContain('a:focus-visible')
    expect(globalCss).toContain('button:focus-visible')
    expect(globalCss).toContain('outline: 1px solid var(--teal-500)')
    expect(globalCss).not.toContain(':focus-visible { outline: 3px')

    expect(form).toContain('focus:border-teal-500')
    expect(form).not.toContain('focus:ring-')
  })

  it('lets hosts upload an event banner directly instead of requiring a pasted URL', () => {
    const form = source('src/features/events/components/event-form.tsx')
    expect(form).toContain('type="file"')
    expect(form).toContain('accept="image/jpeg,image/png,image/webp"')
    expect(form).toContain('Upload banner')
    expect(form).not.toContain('Banner image URL')
  })

  it('uses authenticated presigned S3 uploads and durable banner references', () => {
    const mediaPath = 'src/features/events/event-banner-media.ts'
    const policyPath = 'src/features/events/event-banner-policy.ts'
    const uploadPath = 'src/features/events/components/upload-event-banner.ts'
    expect(existsSync(resolve(root, mediaPath))).toBe(true)
    expect(existsSync(resolve(root, policyPath))).toBe(true)
    expect(existsSync(resolve(root, uploadPath))).toBe(true)
    if (!existsSync(resolve(root, mediaPath)) || !existsSync(resolve(root, policyPath)) || !existsSync(resolve(root, uploadPath))) return

    const media = source(mediaPath)
    const policy = source(policyPath)
    const actions = source('src/features/events/calendar-actions.ts')
    const repository = source('src/features/events/calendar-repository.ts')

    expect(media).toContain('createMediaUploadUrl')
    expect(media).toContain('headMediaObject')
    expect(media).toContain('createMediaReadUrl')
    expect(policy).toContain('events/')
    expect(actions).toContain('createEventBannerUploadAction')
    expect(actions).toContain('verifyEventBannerReference')
    expect(repository).toContain('resolveEventBannerReference')
    expect(repository).toContain('bannerStoragePath')
  })
})
