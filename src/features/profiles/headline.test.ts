import { describe, expect, it } from 'vitest'
import { isUrlOnlyHeadline } from './headline'

describe('isUrlOnlyHeadline (Round H, H7)', () => {
  it('spots a web address used as the whole headline', () => {
    for (const value of ['https://example.com', 'http://example.com/me', 'www.example.com', 'example.com', 'example.co.in', 'linkedin.com/in/placeholder', '  EXAMPLE.COM  ']) {
      expect(isUrlOnlyHeadline(value)).toBe(true)
    }
  })

  it('accepts real headlines, including ones that mention a site or use abbreviations', () => {
    for (const value of ['Chief Engineer', 'Second Officer at example.com', 'B.Tech', 'M.Sc. Marine Engineering', 'Capt. (Master Mariner)', 'C/E', '', null]) {
      expect(isUrlOnlyHeadline(value)).toBe(false)
    }
  })
})
