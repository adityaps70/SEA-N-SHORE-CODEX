import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../media-actions', () => ({ createLearningMediaUpload: vi.fn(), getLearningMediaReadUrl: vi.fn() }))

import { ArticleRichTextEditor } from './article-rich-text-editor'

afterEach(() => cleanup())

const courseId = '33333333-3333-4333-8333-333333333333'

describe('ArticleRichTextEditor', () => {
  it('loads an article and offers headings, emphasis, links, lists, quotes, tables and images', async () => {
    render(<ArticleRichTextEditor courseId={courseId} ariaLabel="Edit material article content" value="<h2>Before boarding</h2><p>Check the <strong>VIQ</strong>.</p>" onChange={vi.fn()} />)

    const textbox = await screen.findByRole('textbox', { name: 'Edit material article content' })
    expect(textbox.querySelector('h2')).toHaveTextContent('Before boarding')
    expect(textbox.querySelector('strong')).toHaveTextContent('VIQ')
    for (const label of ['Heading', 'Subheading', 'Bold', 'Italic', 'Underline', 'Link', 'Bulleted list', 'Numbered list', 'Quote', 'Insert table', 'Insert image']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('sends the edited HTML back', async () => {
    const onChange = vi.fn()
    render(<ArticleRichTextEditor courseId={courseId} ariaLabel="Article" value="<p>Text</p>" onChange={onChange} />)
    await screen.findByRole('textbox', { name: 'Article' })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Insert table' })) })

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.lastCall?.[0]).toContain('<table')
    expect(screen.getByRole('toolbar', { name: 'Table' })).toBeInTheDocument()
  })
})
