import { z } from 'zod'

const uuid = z.string().uuid()

const followedEvent = z.object({
  id: uuid,
  aggregateType: z.literal('profile'),
  aggregateId: uuid,
  eventType: z.literal('user.followed'),
  schemaVersion: z.literal(1),
  occurredAt: z.string().datetime(),
  payload: z.object({
    eventType: z.literal('user.followed'),
    actorId: uuid,
    targetId: uuid,
  }),
})

const connectionRequestedEvent = z.object({
  id: uuid,
  aggregateType: z.literal('connection'),
  aggregateId: uuid,
  eventType: z.literal('connection.requested'),
  schemaVersion: z.literal(1),
  occurredAt: z.string().datetime(),
  payload: z.object({
    eventType: z.literal('connection.requested'),
    actorId: uuid,
    targetId: uuid,
    connectionId: uuid,
  }),
})

const connectionAcceptedEvent = z.object({
  id: uuid,
  aggregateType: z.literal('connection'),
  aggregateId: uuid,
  eventType: z.literal('connection.accepted'),
  schemaVersion: z.literal(1),
  occurredAt: z.string().datetime(),
  payload: z.object({
    eventType: z.literal('connection.accepted'),
    actorId: uuid,
    targetId: uuid,
    connectionId: uuid,
    requestedBy: uuid,
  }),
})

export const domainEventSchema = z.discriminatedUnion('eventType', [
  followedEvent,
  connectionRequestedEvent,
  connectionAcceptedEvent,
])

export function parseDomainEvent(value: unknown) {
  return domainEventSchema.parse(value)
}
