import { describe, expect, it } from 'vitest'
import { applyMarkdownFormat, parseMarkdown, safeLinkTarget, truncateMarkdown, type MarkdownSource } from './markdown'

const text = (value: string): MarkdownSource<string>[] => [{ kind: 'text', value }]

describe('parseMarkdown', () => {
  it('reads bold, italic and nested emphasis with body offsets', () => {
    expect(parseMarkdown(text('**Good Morning!** from *the* _bridge_'))).toEqual([{
      type: 'text',
      start: 0,
      children: [
        { type: 'strong', start: 0, children: [{ type: 'text', value: 'Good Morning!', start: 2 }] },
        { type: 'text', value: ' from ', start: 17 },
        { type: 'emphasis', start: 23, children: [{ type: 'text', value: 'the', start: 24 }] },
        { type: 'text', value: ' ', start: 28 },
        { type: 'emphasis', start: 29, children: [{ type: 'text', value: 'bridge', start: 30 }] },
      ],
    }])

    const [block] = parseMarkdown(text('***both***'))
    expect(block).toMatchObject({ children: [{ type: 'emphasis', children: [{ type: 'strong', children: [{ value: 'both' }] }] }] })
  })

  it('leaves unmatched markers, spaced asterisks and snake_case alone', () => {
    for (const value of ['**not closed', '5 * 3 * 2', 'file_name_here', '** spaced **', 'a*']) {
      expect(parseMarkdown(text(value))).toEqual([{ type: 'text', start: 0, children: [{ type: 'text', value, start: 0 }] }])
    }
  })

  it('honours backslash escapes', () => {
    const [block] = parseMarkdown(text('\\*literal\\*'))
    expect(block?.type === 'text' && block.children.map((node) => node.type === 'text' ? node.value : node.type).join('')).toBe('*literal*')
  })

  it('groups "- ", "* " and "1. " lines into lists and keeps other lines as text with newlines', () => {
    const blocks = parseMarkdown(text('Checklist:\n- Lifejackets\n* **Flares**\n\n- EPIRB\nThen:\n1. Muster\n2. Report'))
    expect(blocks.map((block) => block.type)).toEqual(['text', 'list', 'text', 'list'])
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: false, items: [
      { marker: '•', children: [{ type: 'text', value: 'Lifejackets' }] },
      { marker: '•', children: [{ type: 'strong', children: [{ value: 'Flares' }] }] },
      { marker: '•', children: [{ type: 'text', value: 'EPIRB' }] },
    ] })
    expect(blocks[3]).toMatchObject({ type: 'list', ordered: true, items: [{ marker: '1.' }, { marker: '2.' }] })

    const [paragraph] = parseMarkdown(text('Line one\nLine two'))
    expect(paragraph).toMatchObject({ type: 'text', children: [{ value: 'Line one\nLine two' }] })
  })

  it('does not take hyphenated words, "-1" or "2024." without a space as list markers', () => {
    expect(parseMarkdown(text('-1 degrees\n2024.Good year\n**bold** line')).map((block) => block.type)).toEqual(['text'])
  })

  it('keeps atoms (mentions, hashtags) whole, also inside bold', () => {
    const source: MarkdownSource<string>[] = [
      { kind: 'text', value: '**Thanks ' },
      { kind: 'atom', value: '@Member A', atom: 'member-a' },
      { kind: 'text', value: '**' },
    ]
    expect(parseMarkdown(source)).toEqual([{
      type: 'text',
      start: 0,
      children: [{ type: 'strong', start: 0, children: [
        { type: 'text', value: 'Thanks ', start: 2 },
        { type: 'atom', value: '@Member A', atom: 'member-a', start: 9 },
      ] }],
    }])
  })

  it('links http(s) and same-site paths, and leaves every other target as the literal text', () => {
    const [block] = parseMarkdown(text('[Guide](https://example.com/a_(b)) and [jobs](/jobs?rank=master)'))
    expect(block).toMatchObject({ children: [
      { type: 'link', label: 'Guide', href: 'https://example.com/a_(b)', external: true },
      { type: 'text', value: ' and ' },
      { type: 'link', label: 'jobs', href: '/jobs?rank=master', external: false },
    ] })

    for (const value of [
      '[x](javascript:alert(1))',
      '[x](JaVaScRiPt:alert(1))',
      '[x](data:text/html,<script>alert(1)</script>)',
      '[x](vbscript:msgbox)',
      '[x](//evil.example)',
      '[x](/\\evil.example)',
      '[x](mailto:someone@example.com)',
      '[](https://example.com)',
    ]) {
      expect(parseMarkdown(text(value))).toEqual([{ type: 'text', start: 0, children: [{ type: 'text', value, start: 0 }] }])
    }
  })
})

describe('safeLinkTarget', () => {
  it('accepts only http(s) URLs and single-slash paths', () => {
    expect(safeLinkTarget('HTTPS://Example.com/Path')).toEqual({ href: 'https://example.com/Path', external: true })
    expect(safeLinkTarget('/posts/1')).toEqual({ href: '/posts/1', external: false })
    for (const value of ['javascript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil.example', 'https://user:pass@example.com', 'ftp://example.com', 'example.com']) {
      expect(safeLinkTarget(value)).toBeNull()
    }
  })
})

describe('truncateMarkdown', () => {
  it('keeps formatting open at the cut and drops what follows', () => {
    const body = '**Good Morning everyone** and welcome aboard\n- one\n- two'
    const blocks = truncateMarkdown(parseMarkdown(text(body)), 10)
    expect(blocks).toEqual([{ type: 'text', start: 0, children: [{ type: 'strong', start: 0, children: [{ type: 'text', value: 'Good Mor', start: 2 }] }] }])

    const withList = truncateMarkdown(parseMarkdown(text(body)), body.indexOf('two'))
    expect(withList.map((block) => block.type)).toEqual(['text', 'list'])
    expect(withList[1]).toMatchObject({ items: [{ children: [{ value: 'one' }] }] })
  })

  it('never splits a link', () => {
    const blocks = truncateMarkdown(parseMarkdown(text('See [the long guide](https://example.com) now')), 8)
    expect(blocks[0]).toMatchObject({ children: [{ type: 'text', value: 'See ' }, { type: 'link', label: 'the long guide' }] })
  })
})

describe('applyMarkdownFormat', () => {
  it('wraps a selection, keeping spaces outside the markers, and unwraps it again', () => {
    const bold = applyMarkdownFormat({ value: 'Good Morning! all', start: 0, end: 14 }, 'bold')
    expect(bold).toEqual({ value: '**Good Morning!** all', start: 2, end: 15 })
    expect(applyMarkdownFormat(bold, 'bold')).toEqual({ value: 'Good Morning! all', start: 0, end: 13 })
    expect(applyMarkdownFormat({ value: '**word**', start: 0, end: 8 }, 'bold')).toEqual({ value: 'word', start: 0, end: 4 })

    const italic = applyMarkdownFormat({ value: 'calm seas', start: 0, end: 4 }, 'italic')
    expect(italic).toEqual({ value: '*calm* seas', start: 1, end: 5 })
    expect(applyMarkdownFormat(italic, 'italic').value).toBe('calm seas')
    // Italic inside bold adds a marker instead of stripping the bold.
    expect(applyMarkdownFormat({ value: '**x**', start: 2, end: 3 }, 'italic').value).toBe('***x***')
  })

  it('inserts a selected placeholder when nothing is selected', () => {
    expect(applyMarkdownFormat({ value: 'Hi ', start: 3, end: 3 }, 'bold')).toEqual({ value: 'Hi **bold text**', start: 5, end: 14 })
    expect(applyMarkdownFormat({ value: '', start: 0, end: 0 }, 'link')).toEqual({ value: '[link text](https://)', start: 1, end: 10 })
  })

  it('never splits a mention label', () => {
    const value = 'Thanks @Member A today'
    expect(applyMarkdownFormat({ value, start: 10, end: 22 }, 'bold', ['@Member A']).value).toBe('Thanks **@Member A today**')
  })

  it('toggles list prefixes on the selected lines and keeps a caret in place', () => {
    expect(applyMarkdownFormat({ value: 'Intro\nMuster\nReport', start: 8, end: 15 }, 'bulleted')).toEqual({ value: 'Intro\n- Muster\n- Report', start: 6, end: 23 })
    expect(applyMarkdownFormat({ value: '- Muster\n- Report', start: 0, end: 17 }, 'bulleted').value).toBe('Muster\nReport')
    expect(applyMarkdownFormat({ value: '- Muster\n\n- Report', start: 0, end: 18 }, 'numbered').value).toBe('1. Muster\n\n2. Report')
    expect(applyMarkdownFormat({ value: 'Muster', start: 3, end: 3 }, 'numbered')).toEqual({ value: '1. Muster', start: 6, end: 6 })
    expect(applyMarkdownFormat({ value: '', start: 0, end: 0 }, 'bulleted')).toEqual({ value: '- ', start: 2, end: 2 })
  })

  it('uses a selected URL as the link target', () => {
    expect(applyMarkdownFormat({ value: 'https://example.com', start: 0, end: 19 }, 'link')).toEqual({ value: '[link text](https://example.com)', start: 1, end: 10 })
  })
})
