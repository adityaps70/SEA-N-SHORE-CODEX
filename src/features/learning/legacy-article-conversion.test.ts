import { describe, expect, it } from 'vitest'
import { sanitizeArticleHtml } from './article-html'
import { convertLegacyArticle, isLegacyHeading, toTitleCase } from './legacy-article-conversion'
import { articleText, sameWordsIgnoringCase } from './text-diff'

const legacy = [
  'INTRODUCTION TO SIRE 2.0',
  '',
  'The SIRE 2.0 programme changes how inspections',
  'are carried out on board.',
  'Inspectors look at evidence, not paperwork alone.',
  '',
  '1. PREPARING THE VESSEL',
  '- Review the VIQ and the PIQ',
  '- Brief the crew on ship-to-ship operations',
  '',
  '2. ON THE DAY OF THE INSPECTION',
  'Keep calm & answer honestly.',
].join('\n')

describe('legacy article conversion (round E)', () => {
  it('detects ALL-CAPS and "1. TITLE" headings, but not ordinary sentences or numbered steps', () => {
    expect(isLegacyHeading('INTRODUCTION TO SIRE 2.0')).toBe(true)
    expect(isLegacyHeading('1. PREPARING THE VESSEL')).toBe(true)
    expect(isLegacyHeading('2.3 CREW INTERVIEWS')).toBe(true)
    expect(isLegacyHeading('1. Check the mooring lines.')).toBe(false)
    expect(isLegacyHeading('The VIQ has 12 chapters.')).toBe(false)
    expect(isLegacyHeading('OK')).toBe(false)
  })

  it('writes headings in Title Case, keeping acronyms, numbers and small words', () => {
    expect(toTitleCase('INTRODUCTION TO SIRE 2.0')).toBe('Introduction to SIRE 2.0')
    expect(toTitleCase('2. ON THE DAY OF THE INSPECTION')).toBe('2. On the Day of the Inspection')
    expect(toTitleCase('SHIP-TO-SHIP (STS) TRANSFERS')).toBe('Ship-to-Ship (STS) Transfers')
    expect(toTitleCase('1. WHERE SIRE CAME FROM')).toBe('1. Where SIRE Came From')
  })

  it('turns headings, paragraphs and "- " lists into clean HTML without changing a word', () => {
    const result = convertLegacyArticle(legacy)
    expect(result.html).toBe([
      '<h2>Introduction to SIRE 2.0</h2>',
      '<p>The SIRE 2.0 programme changes how inspections are carried out on board.</p>',
      '<p>Inspectors look at evidence, not paperwork alone.</p>',
      '<h2>1. Preparing the Vessel</h2>',
      '<ul><li>Review the VIQ and the PIQ</li><li>Brief the crew on ship-to-ship operations</li></ul>',
      '<h2>2. On the Day of the Inspection</h2>',
      '<p>Keep calm &amp; answer honestly.</p>',
    ].join('\n'))
    expect(result).toMatchObject({ headings: ['Introduction to SIRE 2.0', '1. Preparing the Vessel', '2. On the Day of the Inspection'], paragraphs: 3, lists: 1, listItems: 2 })
    // The sanitiser keeps every tag, and the words are the same as before (ignoring heading capitals).
    expect(sanitizeArticleHtml(result.html)).toBe(result.html)
    expect(sameWordsIgnoringCase(articleText(legacy, 'plain'), articleText(result.html, 'html'))).toBe(true)
  })
})
