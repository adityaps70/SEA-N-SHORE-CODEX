import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import type { DomainEvent } from '@/features/events/types'

type EventBridgePutResult = {
  successfulIds: string[]
  failures: Array<{ id: string; error: string }>
}

type EventBridgeSender = {
  send(command: PutEventsCommand): Promise<{
    Entries?: Array<{ EventId?: string; ErrorCode?: string; ErrorMessage?: string }>
  }>
}

export function createEventBridgePublisher(input: {
  busName: string
  sender?: EventBridgeSender
}) {
  const sender = input.sender ?? new EventBridgeClient({})

  return {
    async publish(events: DomainEvent[]): Promise<EventBridgePutResult> {
      if (events.length === 0) return { successfulIds: [], failures: [] }
      if (events.length > 10) throw new Error('eventbridge_batch_too_large')

      const response = await sender.send(new PutEventsCommand({
        Entries: events.map((event) => ({
          EventBusName: input.busName,
          Source: 'sea-n-shore.social',
          DetailType: event.eventType,
          Time: new Date(event.occurredAt),
          Detail: JSON.stringify(event),
        })),
      }))

      const successfulIds: string[] = []
      const failures: Array<{ id: string; error: string }> = []

      events.forEach((event, index) => {
        const entry = response.Entries?.[index]
        if (entry?.ErrorCode) {
          failures.push({
            id: event.id,
            error: `${entry.ErrorCode}:${entry.ErrorMessage ?? 'EventBridge rejected event'}`.slice(0, 1000),
          })
        } else {
          successfulIds.push(event.id)
        }
      })

      return { successfulIds, failures }
    },
  }
}

export type EventBridgePublisher = ReturnType<typeof createEventBridgePublisher>
