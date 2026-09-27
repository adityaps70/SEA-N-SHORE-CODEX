import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LinkifiedText, splitLinks } from './linkified-text'

describe('LinkifiedText', () => {
  it('turns http(s) links into safe anchors and keeps trailing punctuation outside', () => {
    render(<p><LinkifiedText text="Have a look: https://d3prih0q6jofyr.cloudfront.net/posts/abc. Thoughts?" /></p>)
    const link = screen.getByRole('link', { name: 'https://d3prih0q6jofyr.cloudfront.net/posts/abc' })
    expect(link).toHaveAttribute('href', 'https://d3prih0q6jofyr.cloudfront.net/posts/abc')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('never links other schemes and keeps plain text intact', () => {
    expect(splitLinks('javascript:alert(1) and www.example.com')).toEqual([{ type: 'text', value: 'javascript:alert(1) and www.example.com' }])
    expect(splitLinks('no links here')).toEqual([{ type: 'text', value: 'no links here' }])
  })

  it('handles several links in one message', () => {
    const parts = splitLinks('a https://a.test/x b http://b.test/y')
    expect(parts.filter((part) => part.type === 'link').map((part) => part.value)).toEqual(['https://a.test/x', 'http://b.test/y'])
  })
})
