import { describe, expect, it } from 'vitest'
import { organizationAddress, organizationJsonLd, organizationMetadata } from './organization-seo'

const organization = {
  id: '55555555-5555-4555-8555-555555555555',
  slug: 'example-ship-management',
  name: 'Example Ship Management',
  logoPath: 'organizations/5555/logo-abcdef.png',
  website: 'https://example.com/',
  description: 'Ship manager for **tankers** and bulk carriers.\nCrewing offices in two ports.',
  tagline: 'Tanker and bulk ship management',
  officeLocations: ['Mumbai, Maharashtra, India', 'Singapore'],
}

/** Round H (H5): organization page search data. */
describe('organization search metadata', () => {
  it('gives the page a canonical address without the tab query and a plain description', () => {
    const metadata = organizationMetadata(organization)
    expect(metadata.title).toBe('Example Ship Management')
    expect(metadata.alternates).toEqual({ canonical: '/organizations/example-ship-management' })
    expect(metadata.description).toBe('Ship manager for tankers and bulk carriers. Crewing offices in two ports.')
  })

  it('builds Organization data with an absolute logo, the website as sameAs and the head office', () => {
    expect(organizationJsonLd(organization, 'https://seanshore.in')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Example Ship Management',
      url: 'https://seanshore.in/organizations/example-ship-management',
      logo: 'https://seanshore.in/api/company-logo/55555555-5555-4555-8555-555555555555?v=logo-abcdef.png',
      sameAs: ['https://example.com/'],
      address: { '@type': 'PostalAddress', addressLocality: 'Mumbai', addressCountry: 'India' },
      description: 'Ship manager for tankers and bulk carriers. Crewing offices in two ports.',
    })
  })

  it('leaves out what the organization has not filled in', () => {
    const data = organizationJsonLd({ ...organization, logoPath: null, website: 'not a url', description: null, tagline: null, officeLocations: [] }, 'https://seanshore.in')
    expect(data).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Example Ship Management',
      url: 'https://seanshore.in/organizations/example-ship-management',
    })
    expect(organizationAddress('Singapore')).toEqual({ '@type': 'PostalAddress', addressLocality: 'Singapore' })
  })
})
