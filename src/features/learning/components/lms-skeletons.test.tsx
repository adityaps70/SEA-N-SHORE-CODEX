import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CatalogueSkeleton, CourseEditorSkeleton, CoursePageSkeleton, MyLearningSkeleton, PlayerSkeleton, StudioSkeleton } from './lms-skeletons'

afterEach(() => cleanup())

describe('LMS loading skeletons (round E)', () => {
  it.each([
    [CatalogueSkeleton, 'Loading courses'],
    [CoursePageSkeleton, 'Loading the course'],
    [PlayerSkeleton, 'Loading the lesson'],
    [MyLearningSkeleton, 'Loading your courses'],
    [StudioSkeleton, 'Loading Learning Studio'],
    [CourseEditorSkeleton, 'Loading the course editor'],
  ])('announces what is loading and pulses only when motion is welcome', (Skeleton, label) => {
    const { container } = render(<Skeleton />)
    expect(screen.getByRole('status')).toHaveTextContent(label)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    const blocks = container.querySelectorAll('[aria-hidden="true"]')
    expect(blocks.length).toBeGreaterThan(2)
    blocks.forEach((block) => expect(block.className).toContain('motion-safe:animate-pulse'))
  })
})
