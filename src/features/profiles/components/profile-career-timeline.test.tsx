import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProfileExperienceRecord } from '../profile-portfolio-types'
import { ProfileCareerTimeline } from './profile-career-timeline'

vi.mock('../profile-portfolio-actions', () => ({
  createProfileExperience: vi.fn(),
  updateProfileExperience: vi.fn(),
  deleteProfileExperience: vi.fn(),
}))

const experiences: ProfileExperienceRecord[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    track: 'sea_service',
    title: 'Master',
    organization: 'Oceanic Shipping',
    vessel: 'MT Horizon',
    vesselType: 'Oil Tanker',
    location: null,
    startedOn: '2024-01-01',
    endedOn: null,
    isCurrent: true,
    description: 'Command responsibility on worldwide tanker trades.',
    cargoExperience: ['Crude Oil'],
    engineExperience: [],
    tradingAreas: ['Worldwide'],
    sortOrder: 0,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    track: 'shore_role',
    title: 'Marine Superintendent',
    organization: 'Harbour Marine',
    vessel: null,
    vesselType: null,
    location: 'Mumbai, India',
    startedOn: '2021-04-01',
    endedOn: '2023-12-31',
    isCurrent: false,
    description: 'Fleet safety and vetting oversight.',
    cargoExperience: [],
    engineExperience: [],
    tradingAreas: [],
    sortOrder: 10,
  },
]

afterEach(() => cleanup())

describe('ProfileCareerTimeline', () => {
  it('renders stored sea and shore career records in a recruiter-readable timeline', () => {
    render(<ProfileCareerTimeline experiences={experiences} />)

    expect(screen.getByRole('heading', { name: 'Career timeline' })).toBeInTheDocument()
    expect(screen.getByText('Master')).toBeInTheDocument()
    expect(screen.getByText('MT Horizon')).toBeInTheDocument()
    expect(screen.getByText('Oil Tanker')).toBeInTheDocument()
    expect(screen.getByText('Crude Oil')).toBeInTheDocument()
    expect(screen.getByText('Marine Superintendent')).toBeInTheDocument()
    expect(screen.getByText('Harbour Marine')).toBeInTheDocument()
    expect(screen.getByText('Mumbai, India')).toBeInTheDocument()
  })

  it('switches the owner editor between sea-service and shore-role fields', () => {
    render(<ProfileCareerTimeline experiences={[]} editable />)

    fireEvent.click(screen.getByRole('button', { name: /add experience/i }))

    expect(screen.getByLabelText('Vessel')).toBeInTheDocument()
    expect(screen.getByLabelText('Vessel type')).toBeInTheDocument()
    expect(screen.getByLabelText('Cargo experience')).toBeInTheDocument()
    expect(screen.getByLabelText('Engine experience')).toBeInTheDocument()
    expect(screen.getByLabelText('Trading areas')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Experience type'), { target: { value: 'shore_role' } })

    expect(screen.getByLabelText('Organisation / company')).toBeInTheDocument()
    expect(screen.getByLabelText('Location')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vessel')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Vessel type')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Cargo experience')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Engine experience')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Trading areas')).not.toBeInTheDocument()
  })

  it('keeps the public timeline read-only and hides an empty public section', () => {
    const { rerender } = render(<ProfileCareerTimeline experiences={experiences} />)

    expect(screen.queryByRole('button', { name: /add experience/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit master/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete master/i })).not.toBeInTheDocument()

    rerender(<ProfileCareerTimeline experiences={[]} />)
    expect(screen.queryByRole('heading', { name: 'Career timeline' })).not.toBeInTheDocument()
  })
})
