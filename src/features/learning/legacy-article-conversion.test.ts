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

  it('cases the SIRE headings the live plan run showed', () => {
    // "IT" is the pronoun far more often than information technology in an all-caps heading.
    expect(toTitleCase('2. WHY IT HAD TO CHANGE')).toBe('2. Why It Had to Change')
    // Acronym plurals keep the acronym: PIFs, KPIs.
    expect(toTitleCase('USING THE PIFS BEFORE THE INSPECTOR DOES')).toBe('Using the PIFs Before the Inspector Does')
    expect(toTitleCase('4. WHAT A DEFENSIBLE CAPA CONTAINS')).toBe('4. What a Defensible CAPA Contains')
    expect(toTitleCase('TRACKING KPIS')).toBe('Tracking KPIs')
    // A digit keeps only its own part of a hyphenated word.
    expect(toTitleCase('2. USING THE 14-DAY COMMENT WINDOW WELL')).toBe('2. Using the 14-Day Comment Window Well')
    // A subtitle after a colon or a dash starts with a capital.
    expect(toTitleCase('PART ONE - THE SCENARIO')).toBe('Part One - The Scenario')
    expect(toTitleCase('5. A PRACTICAL DRILL: THE THREE-LENS WALKTHROUGH')).toBe('5. A Practical Drill: The Three-Lens Walkthrough')
    expect(toTitleCase('REPEAT OBSERVATIONS — THE MOST EXPENSIVE FINDING')).toBe('Repeat Observations — The Most Expensive Finding')
    // Unchanged cases.
    expect(toTitleCase('3. ROOT CAUSE THAT IS NOT "CREW ERROR"')).toBe('3. Root Cause That Is Not "Crew Error"')
    expect(toTitleCase('HARMONISED VESSEL PARTICULARS QUESTIONNAIRE (HVPQ)')).toBe('Harmonised Vessel Particulars Questionnaire (HVPQ)')
    expect(toTitleCase('TO-DO LIST FOR THE MASTER')).toBe('To-Do List for the Master')
  })

  it('writes double quotes as the sanitiser does, so an article with quotes is not refused', () => {
    // The live plan refused 8 of 9 SIRE articles: the converter wrote " as &quot; and the sanitiser writes a plain ".
    const text = ['3. ROOT CAUSE THAT IS NOT "CREW ERROR"', 'The inspector asked "show me", not "tell me".', '- Say "I don\'t know" & then find out'].join('\n')
    const result = convertLegacyArticle(text)
    expect(result.html).toBe([
      '<h2>3. Root Cause That Is Not "Crew Error"</h2>',
      '<p>The inspector asked "show me", not "tell me".</p>',
      '<ul><li>Say "I don\'t know" &amp; then find out</li></ul>',
    ].join('\n'))
    expect(sanitizeArticleHtml(result.html)).toBe(result.html)
    expect(sameWordsIgnoringCase(articleText(text, 'plain'), articleText(result.html, 'html'))).toBe(true)
    // Markup in the text is still escaped, never passed through.
    expect(convertLegacyArticle('Use <b>bold</b> & <script>x</script>').html).toBe('<p>Use &lt;b&gt;bold&lt;/b&gt; &amp; &lt;script&gt;x&lt;/script&gt;</p>')
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
