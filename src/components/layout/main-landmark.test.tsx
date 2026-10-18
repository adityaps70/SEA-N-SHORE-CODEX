import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MainLandmark, SkipLink } from './main-landmark'

afterEach(() => cleanup())

describe('MainLandmark (Round H, H8)', () => {
  it('is the page’s <main id="main-content"> when it stands alone', () => {
    const { container } = render(<MainLandmark className="px-4">Page</MainLandmark>)
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main-content')
    expect(main).toHaveAttribute('tabindex', '-1')
    expect(main).toHaveClass('px-4')
    expect(container.querySelectorAll('main')).toHaveLength(1)
  })

  it('renders a plain <div> inside another one, so a page never has two mains', () => {
    const { container } = render(
      <MainLandmark>
        <MainLandmark className="mx-auto max-w-page-wide" data-testid="inner">Page</MainLandmark>
      </MainLandmark>,
    )
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelectorAll('#main-content')).toHaveLength(1)
    const inner = screen.getByTestId('inner')
    expect(inner.tagName).toBe('DIV')
    expect(inner).toHaveClass('mx-auto', 'max-w-page-wide')
    expect(inner).not.toHaveAttribute('id')
  })

  it('offers a "Skip to content" link to the main landmark', () => {
    render(<SkipLink />)
    const link = screen.getByRole('link', { name: 'Skip to content' })
    expect(link).toHaveAttribute('href', '#main-content')
    expect(link).toHaveClass('skip-link')
  })
})
