import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Round H (H8): readable text is at least 12px (text-xs) and body meta 13px (text-meta). text-[10px] and text-[11px]
// stay only where the characters are not text a reader needs: initials inside an avatar (the person's name is
// next to it or in the link's label) and the emoji inside a reaction bubble.

type AllowEntry = { file: string; contains: string; reason: string }

const ALLOWED: AllowEntry[] = [
  { file: 'src/components/navigation/viewer-avatar.tsx', contains: "'text-[11px]'", reason: 'initials in the viewer avatar; the account menu button carries the name' },
  { file: 'src/features/admin/components/admin-ui.tsx', contains: 'bg-mist-100 text-[11px] font-bold', reason: 'aria-hidden initials avatar next to the member name' },
  { file: 'src/features/messaging/components/messaging-dock.tsx', contains: 'bg-mist-50 text-[10px] font-bold', reason: 'initials avatar in the dock; the name is shown beside it' },
  { file: 'src/features/organizations/components/organization-logo.tsx', contains: "size-8 rounded-md text-[10px]", reason: 'initials in the smallest organization logo; the name is shown beside it' },
  { file: 'src/features/feed/components/post-card.tsx', contains: 'bg-mist-100 text-[11px] font-semibold', reason: 'initials in the phone comment preview avatar; the link label names the author' },
  { file: 'src/features/feed/components/comment-thread.tsx', contains: "size-8 rounded-lg text-[11px]", reason: 'initials in a reply avatar; the link label names the author' },
  { file: 'src/features/feed/components/reaction-summary.tsx', contains: "'size-5 text-[11px]'", reason: 'emoji glyph inside the small reaction bubble; the button label gives the count' },
]

const SMALL_TEXT = /text-\[1[01]px\]/

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return tsxFiles(full)
    return full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : []
  })
}

const lines = tsxFiles(path.join(process.cwd(), 'src')).flatMap((full) => {
  const file = path.relative(process.cwd(), full)
  return readFileSync(full, 'utf8').split('\n').map((text, index) => ({ file, line: index + 1, text }))
})

const allowedBy = (file: string, text: string) => ALLOWED.find((entry) => entry.file === file && text.includes(entry.contains))

describe('minimum text size contract (Round H, H8)', () => {
  it('uses no text-[10px] or text-[11px] outside the allow-list', () => {
    const offenders = lines
      .filter(({ text }) => SMALL_TEXT.test(text))
      .filter(({ file, text }) => !allowedBy(file, text))
      .map(({ file, line, text }) => `${file}:${line}: ${text.trim().slice(0, 120)}`)
    expect(offenders).toEqual([])
  })

  it('gives every allow-list entry a reason and keeps it in use', () => {
    for (const entry of ALLOWED) expect(entry.reason.length, entry.file).toBeGreaterThan(10)
    const stale = ALLOWED.filter((entry) => !lines.some(({ file, text }) => file === entry.file && text.includes(entry.contains) && SMALL_TEXT.test(text)))
    expect(stale).toEqual([])
  })

  it('defines the 13px body meta size and uses it for the feed post time and role lines', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')
    expect(css).toMatch(/--text-meta:\s*0\.8125rem;/)
    const postCard = readFileSync(path.join(process.cwd(), 'src/features/feed/components/post-card.tsx'), 'utf8')
    expect(postCard).toMatch(/<p className="mt-1 flex items-center gap-1 text-meta text-muted">\s*<time/)
    const comments = readFileSync(path.join(process.cwd(), 'src/features/feed/components/comment-thread.tsx'), 'utf8')
    expect(comments).toContain('truncate text-meta text-muted">{comment.author.rank')
  })
})
