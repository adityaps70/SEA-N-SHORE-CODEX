import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { messageActionLabel, messageOwnerPhrase } from './message-action-labels'

describe('message action labels (Round H, H8)', () => {
  it('names the sender, or "your message" for the viewer’s own', () => {
    expect(messageOwnerPhrase({ mine: false, senderName: 'Placeholder Member' })).toBe("Placeholder Member's message")
    expect(messageOwnerPhrase({ mine: true, senderName: 'Placeholder Member' })).toBe('your message')
    expect(messageOwnerPhrase({ mine: false, senderName: '  ' })).toBe("Sea N Shore member's message")
    expect(messageOwnerPhrase({ mine: false, senderName: null })).toBe("Sea N Shore member's message")
  })

  it('builds each action label', () => {
    const theirs = { mine: false, senderName: 'Placeholder Member' }
    expect(messageActionLabel('reply', theirs)).toBe("Reply to Placeholder Member's message")
    expect(messageActionLabel('react', theirs)).toBe("React to Placeholder Member's message")
    expect(messageActionLabel('more', { mine: true, senderName: null })).toBe('More actions for your message')
    expect(messageActionLabel('options', { mine: true, senderName: null })).toBe('Options for your message')
  })
})

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(tsx|ts)$/.test(full) && !/\.test\.tsx?$/.test(full) ? [full] : []
  })
}

describe('messaging accessible names never read out ids (Round H, H8)', () => {
  it('interpolates no id into an aria-label, triggerLabel or label in src/features/messaging', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(path.join(process.cwd(), 'src/features/messaging'))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        // aria-label={`… ${message.id}`}, triggerLabel={`… ${messageId}`}, label: `… ${conversation.id}` and the like.
        for (const match of line.matchAll(/(?:aria-label|aria-description|triggerLabel|accessibleLabel|label)\s*[=:]\s*\{?\s*`([^`]*)`/g)) {
          if (/\$\{[^}]*(?:\.id|Id|_id|uuid)\b[^}]*\}/.test(match[1])) offenders.push(`${path.relative(process.cwd(), file)}:${index + 1}: ${match[0]}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
