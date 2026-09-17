import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const controls = readFileSync('src/features/network/components/relationship-controls.tsx', 'utf8')

describe('relationship controls quality contract', () => {
  it('promotes messaging to the primary connected action', () => {
    expect(controls).toContain("import { StartConversationButton } from '@/features/messaging/components/start-conversation-button'")
    expect(controls).toContain('<StartConversationButton targetProfileId={profileId}')
  })

  it('keeps Pending as the outgoing primary state and moves cancellation under More', () => {
    const moreIndex = controls.indexOf('<details')
    const pendingIndex = controls.indexOf('>Pending</span>')
    const cancelIndex = controls.indexOf("respond('cancel')")

    expect(pendingIndex).toBeGreaterThan(-1)
    expect(moreIndex).toBeGreaterThan(pendingIndex)
    expect(cancelIndex).toBeGreaterThan(moreIndex)
  })

  it('keeps destructive and secondary connection actions under More', () => {
    const moreIndex = controls.indexOf('<details')
    expect(controls.indexOf("respond('decline')")).toBeGreaterThan(moreIndex)
    expect(controls.indexOf("respond('remove')")).toBeGreaterThan(moreIndex)
    expect(controls.indexOf('onClick={block}')).toBeGreaterThan(moreIndex)
  })
})
