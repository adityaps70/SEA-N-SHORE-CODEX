import { describe, expect, it } from 'vitest'
import {
  articleImagePaths,
  articlePlainText,
  plainTextToArticleHtml,
  renderArticleHtml,
  sanitizeArticleHtml,
} from './article-html'

const image = 'learning/user-1/33333333-3333-4333-8333-333333333333/lesson_image/44444444-4444-4444-8444-444444444444.png'

describe('rich-text lesson sanitizing', () => {
  it.each([
    ['<p>Hi<script>alert(1)</script></p>', '<p>Hi</p>'],
    ['<p onclick="alert(1)" onmouseover="steal()">Hi</p>', '<p>Hi</p>'],
    ['<img src="x" onerror="alert(1)">', ''],
    ['<a href="javascript:alert(1)">x</a>', '<a target="_blank" rel="noopener noreferrer nofollow">x</a>'],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', '<a target="_blank" rel="noopener noreferrer nofollow">x</a>'],
    ['<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', '<a target="_blank" rel="noopener noreferrer nofollow">x</a>'],
    ['<a href="//evil.example/x">x</a>', '<a target="_blank" rel="noopener noreferrer nofollow">x</a>'],
    ['<iframe src="https://evil.example"></iframe><p>after</p>', '<p>after</p>'],
    ['<object data="x"></object><embed src="x"><p>ok</p>', '<p>ok</p>'],
    ['<svg><script>alert(1)</script><circle /></svg><p>ok</p>', '<p>ok</p>'],
    ['<style>body{display:none}</style><p style="color:red" class="x">ok</p>', '<p>ok</p>'],
    ['<form action="https://evil"><input name="password"></form><p>ok</p>', '<p>ok</p>'],
    ['<img src="https://tracker.example/pixel.gif">', ''],
    ['<math><mtext><img src=x onerror=alert(1)></mtext></math>', ''],
    ['<p>a</p><!-- <script>alert(1)</script> --><p>b</p>', '<p>a</p><p>b</p>'],
  ])('strips %s', (input, expected) => {
    expect(sanitizeArticleHtml(input)).toBe(expected)
  })

  it('keeps the formatting the editor produces', () => {
    const html = '<h2>Heading</h2><h3>Sub</h3><p><strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s> <code>code</code></p>'
      + '<ul><li>one</li></ul><ol><li>two</li></ol><blockquote><p>quote</p></blockquote><hr>'
      + '<table><tbody><tr><th colspan="2">Head</th></tr><tr><td>a</td><td rowspan="1">b</td></tr></tbody></table>'
    expect(sanitizeArticleHtml(html)).toBe(
      '<h2>Heading</h2><h3>Sub</h3><p><strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s> <code>code</code></p>'
      + '<ul><li>one</li></ul><ol><li>two</li></ol><blockquote><p>quote</p></blockquote><hr />'
      + '<table><tbody><tr><th colspan="2">Head</th></tr><tr><td>a</td><td rowspan="1">b</td></tr></tbody></table>',
    )
  })

  it('opens links safely in a new tab, overriding anything the author set', () => {
    expect(sanitizeArticleHtml('<a href="https://www.imo.org" target="_self" rel="opener">IMO</a>'))
      .toBe('<a href="https://www.imo.org" target="_blank" rel="noopener noreferrer nofollow">IMO</a>')
    expect(sanitizeArticleHtml('<a href="mailto:training@example.com">Email</a>'))
      .toBe('<a href="mailto:training@example.com" target="_blank" rel="noopener noreferrer nofollow">Email</a>')
  })

  it('stores course images by storage path only and drops their short-lived URL', () => {
    const stored = sanitizeArticleHtml(`<img data-storage-path="${image}" src="https://bucket.example/signed?X-Amz-Signature=abc" alt="Deck plan">`)
    expect(stored).toBe(`<img data-storage-path="${image}" alt="Deck plan" />`)
    expect(articleImagePaths(stored)).toEqual([image])
    expect(sanitizeArticleHtml('<img data-storage-path="profiles/other/photo.png">')).toBe('')
  })

  it('signs course images when rendering, and drops any it cannot sign', async () => {
    const stored = `<p>Plan</p><img data-storage-path="${image}" alt="Deck plan" />`
    expect(await renderArticleHtml(stored, async () => 'https://bucket.example/signed?a=1&b=2'))
      .toBe(`<p>Plan</p><img data-storage-path="${image}" src="https://bucket.example/signed?a=1&amp;b=2" alt="Deck plan" />`)
    expect(await renderArticleHtml(stored, async () => null)).toBe('<p>Plan</p>')
  })

  it('sanitizes again when rendering, so stored HTML is never trusted', async () => {
    expect(await renderArticleHtml('<p>ok</p><script>alert(1)</script>', async () => null)).toBe('<p>ok</p>')
  })
})

describe('plain-text articles', () => {
  it('turn into paragraphs (keeping line breaks) the first time they are edited', () => {
    expect(plainTextToArticleHtml('Before the inspection:\ncheck the VIQ.\n\nThen brief the crew.'))
      .toBe('<p>Before the inspection:<br>check the VIQ.</p><p>Then brief the crew.</p>')
  })

  it('are escaped, never interpreted, when converted', () => {
    expect(plainTextToArticleHtml('Use <b> tags & "quotes"')).toBe('<p>Use &lt;b&gt; tags &amp; &quot;quotes&quot;</p>')
  })

  it('read the same as text in either format', () => {
    expect(articlePlainText('Line one\nline two', 'plain')).toBe('Line one\nline two')
    expect(articlePlainText('<h2>Title</h2><p>Body <b>text</b></p>', 'html')).toBe('TitleBody text')
  })
})
