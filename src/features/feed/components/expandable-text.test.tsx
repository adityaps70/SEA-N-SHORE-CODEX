import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { COMMENT_COLLAPSE, ExpandableText, POST_COLLAPSE, collapsedLength } from './expandable-text'

afterEach(cleanup)

const rinki = { profileId: '22222222-2222-4222-8222-222222222222', slug: 'rinki-mukharjee', fullName: 'Rinki Mukharjee' }

describe('collapsedLength', () => {
  it('leaves short text alone', () => {
    expect(collapsedLength('A short update.', [], POST_COLLAPSE)).toBeNull()
    expect(collapsedLength('one\ntwo\nthree\nfour\nfive', [], POST_COLLAPSE)).toBeNull()
  })

  it('cuts after five lines or about 300 characters, on a word boundary', () => {
    expect(collapsedLength('1\n2\n3\n4\n5\n6\n7', [], POST_COLLAPSE)).toBe('1\n2\n3\n4\n5'.length)
    const long = 'word '.repeat(100).trim()
    const cut = collapsedLength(long, [], POST_COLLAPSE)!
    expect(cut).toBeLessThanOrEqual(300)
    expect(cut).toBeGreaterThan(250)
    expect(long.slice(0, cut).endsWith('word')).toBe(true)
  })

  it('never cuts an @mention in half', () => {
    const body = `${'a'.repeat(190)} @Rinki Mukharjee thanks for the tips`
    const cut = collapsedLength(body, [rinki], COMMENT_COLLAPSE)!
    expect(body.slice(0, cut)).toBe('a'.repeat(190))
  })
})

describe('ExpandableText', () => {
  it('shows the first lines with an accessible “…more” button that expands inline and collapses again', () => {
    const body = `${'Lesson learned on the bridge today. '.repeat(12)}The end.`
    render(<ExpandableText body={body} />)

    const more = screen.getByRole('button', { name: 'more' })
    const paragraph = more.closest('p')!
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveAttribute('aria-controls', paragraph.id)
    expect(paragraph).toHaveTextContent('…more')
    expect(paragraph).not.toHaveTextContent('The end.')

    fireEvent.click(more)
    expect(paragraph).toHaveTextContent('The end.')
    const less = screen.getByRole('button', { name: 'Show less' })
    expect(less).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(less)
    expect(screen.getByRole('button', { name: 'more' })).toBeInTheDocument()
    expect(paragraph).not.toHaveTextContent('The end.')
  })

  it('keeps mention links working in both states', () => {
    const body = `Thanks @Rinki Mukharjee for the drill notes.\n2\n3\n4\n5\n6 more lines for @Rinki Mukharjee`
    render(<ExpandableText body={body} mentions={[rinki]} />)

    expect(screen.getAllByRole('link', { name: '@Rinki Mukharjee' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    expect(screen.getAllByRole('link', { name: '@Rinki Mukharjee' })).toHaveLength(2)
  })

  it('shows everything without a button when asked to start expanded or when the text is short', () => {
    const { rerender } = render(<ExpandableText body={'x '.repeat(400)} defaultExpanded />)
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
    rerender(<ExpandableText key="short" body="Short." />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
