import { describe, expect, it } from 'vitest'
import { OPTIMIZED_MEDIA_IMAGE_HOSTNAMES, avatarPx, avatarSizes, isOptimizedMediaImageUrl } from './media-image-source'

describe('optimized media image sources', () => {
  it('only optimizes https URLs on the private media bucket host', () => {
    const [host] = OPTIMIZED_MEDIA_IMAGE_HOSTNAMES
    expect(isOptimizedMediaImageUrl(`https://${host}/profiles/a/avatar.webp?X-Amz-Signature=abc`)).toBe(true)
    expect(isOptimizedMediaImageUrl(`http://${host}/profiles/a/avatar.webp`)).toBe(false)
    expect(isOptimizedMediaImageUrl('https://media.example/avatar.webp')).toBe(false)
    expect(isOptimizedMediaImageUrl('/api/company-logo/1')).toBe(false)
    expect(isOptimizedMediaImageUrl('/api/messages/attachments/1')).toBe(false)
    expect(isOptimizedMediaImageUrl('blob:https://seanshore.example/1')).toBe(false)
    expect(isOptimizedMediaImageUrl('data:image/png;base64,AAAA')).toBe(false)
    expect(isOptimizedMediaImageUrl('https://')).toBe(false)
  })
})

describe('avatar sizes from Tailwind size classes', () => {
  it('reads the base size in pixels', () => {
    expect(avatarPx('size-11 rounded-2xl text-sm')).toBe(44)
    expect(avatarPx('grid size-[74px] place-items-center')).toBe(74)
    expect(avatarPx('rounded-full text-xs')).toBe(48)
    expect(avatarPx('rounded-full', 32)).toBe(32)
    expect(avatarPx('max-md:size-14 rounded-full', 36)).toBe(36)
  })

  it('builds a sizes attribute with responsive variants first', () => {
    expect(avatarSizes('size-11 rounded-2xl')).toBe('44px')
    expect(avatarSizes('size-11 shrink-0 max-md:size-14 max-md:rounded-full')).toBe('(max-width: 767px) 56px, 44px')
    expect(avatarSizes('size-24 sm:size-32')).toBe('(min-width: 640px) 128px, 96px')
    expect(avatarSizes('rounded-full', 40)).toBe('40px')
  })
})
