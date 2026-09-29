import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GroupCover, GroupIconTile } from './group-icon-tile'

afterEach(() => cleanup())

describe('GroupIconTile', () => {
  it('shows the navy lucide icon tile when the community has no photo', () => {
    const { container } = render(<GroupIconTile icon="Wrench" />)
    const tile = screen.getByTestId('group-icon-tile')
    expect(tile).toHaveAttribute('aria-hidden', 'true')
    expect(tile).toHaveClass('bg-navy-950', 'size-12', 'rounded-xl')
    expect(container.querySelector('svg')).toHaveClass('size-6')
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders the community photo as a rounded square with the icon underneath as the fallback', () => {
    const { container } = render(<GroupIconTile icon="Wrench" iconUrl="/api/community-media/g1/icon?v=icon-1.webp" size="xl" />)
    const tile = screen.getByTestId('group-icon-tile')
    expect(tile).toHaveClass('rounded-2xl', 'overflow-hidden', 'relative')
    const image = container.querySelector('img')
    expect(image).not.toBeNull()
    expect(image).toHaveAttribute('src', '/api/community-media/g1/icon?v=icon-1.webp')
    expect(image).toHaveAttribute('alt', '')
    expect(image).toHaveClass('object-cover')
    // The lucide icon stays underneath until the photo paints (and remains if it fails).
    expect(container.querySelector('svg')).toHaveClass('size-9')
  })

  it.each([
    ['sm', 'size-10', 'size-5'],
    ['md', 'size-12', 'size-6'],
  ] as const)('keeps the %s size variant', (size, tileClass, iconClass) => {
    const { container } = render(<GroupIconTile icon={null} size={size} iconUrl="/api/community-media/g1/icon?v=a" />)
    expect(screen.getByTestId('group-icon-tile')).toHaveClass(tileClass)
    expect(container.querySelector('svg')).toHaveClass(iconClass)
  })
})

describe('GroupCover', () => {
  it('shows the gradient alone without a banner, and the banner image on top when set', () => {
    const { container, rerender } = render(<GroupCover coverUrl={null} name="Tanker Professionals" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.firstElementChild).toHaveClass('h-32')

    rerender(<GroupCover coverUrl="/api/community-media/g1/cover?v=cover-1.jpg" name="Tanker Professionals" className="h-40" />)
    const image = container.querySelector('img')
    expect(image).toHaveAttribute('src', '/api/community-media/g1/cover?v=cover-1.jpg')
    expect(image).toHaveAttribute('alt', 'Tanker Professionals cover image')
    expect(image).toHaveClass('object-cover')
    expect(container.firstElementChild).toHaveClass('h-40', 'relative', 'overflow-hidden')
  })
})
