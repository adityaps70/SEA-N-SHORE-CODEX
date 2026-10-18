import { describe, expect, it } from 'vitest'
import { personJsonLd, profileMetadata } from './profile-seo'
import type { PublicProfile } from './types'

const profile = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'example-officer',
  profileType: 'seafarer',
  fullName: 'Example Officer',
  avatarPath: 'profiles/22222222/avatar.jpg',
  avatarUrl: '/api/media/image/profiles/22222222/avatar.jpg?w=1&s=abc',
  location: 'Mumbai',
  headline: 'Chief Officer on LNG carriers',
  summary: 'Ten **years** at sea.\n\nOpen to shore roles.',
  rank: 'Chief Officer',
  currentCompany: 'Typed Company',
  currentOrganization: { id: 'org-1', slug: 'listed-shipping', name: 'Listed Shipping', logoUrl: null, verified: true },
  currentVessel: null,
  sailingExperienceYears: 10,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: [],
} as PublicProfile

/** Round H (H5): public member profile search data. */
describe('profile search metadata', () => {
  it('asks not to be indexed or followed without the owner opt-in', () => {
    const metadata = profileMetadata(profile, { allowIndexing: false })
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata).not.toHaveProperty('alternates')
    expect(metadata).not.toHaveProperty('openGraph')
  })

  it('gives an opted-in profile a canonical address, a plain description and its avatar for share cards', () => {
    const metadata = profileMetadata(profile, { allowIndexing: true })
    expect(metadata.robots).toBeUndefined()
    expect(metadata.title).toBe('Example Officer · Chief Officer on LNG carriers')
    expect(metadata.description).toBe('Ten years at sea. Open to shore roles.')
    expect(metadata.alternates).toEqual({ canonical: '/people/example-officer' })
    expect(metadata.openGraph).toMatchObject({ url: '/people/example-officer', images: [profile.avatarUrl] })
  })

  it('builds Person data from public fields only', () => {
    const person = personJsonLd(profile, 'https://seanshore.in')
    expect(person).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: 'Example Officer',
      url: 'https://seanshore.in/people/example-officer',
      jobTitle: 'Chief Officer',
      description: 'Ten years at sea. Open to shore roles.',
      image: `https://seanshore.in${profile.avatarUrl}`,
      worksFor: { '@type': 'Organization', name: 'Listed Shipping' },
    })
    expect(JSON.stringify(person)).not.toMatch(/email|telephone|phone/i)
  })

  it('never publishes a short-lived signed storage address as the image, and falls back to the typed company', () => {
    const person = personJsonLd({
      ...profile,
      avatarUrl: 'https://bucket.s3.amazonaws.com/profiles/avatar.jpg?X-Amz-Signature=abc',
      currentOrganization: null,
      rank: null,
    }, 'https://seanshore.in')
    expect(person).not.toHaveProperty('image')
    expect(person.jobTitle).toBe('Chief Officer on LNG carriers')
    expect(person.worksFor).toEqual({ '@type': 'Organization', name: 'Typed Company' })
  })
})
