export type SocialDomainEventType =
  | 'user.followed'
  | 'connection.requested'
  | 'connection.accepted'

export type SocialDomainEventPayload =
  | {
      eventType: 'user.followed'
      actorId: string
      targetId: string
    }
  | {
      eventType: 'connection.requested'
      actorId: string
      targetId: string
      connectionId: string
    }
  | {
      eventType: 'connection.accepted'
      actorId: string
      targetId: string
      connectionId: string
      requestedBy: string
    }

export type DomainEvent = {
  id: string
  aggregateType: 'profile' | 'connection'
  aggregateId: string
  eventType: SocialDomainEventType
  schemaVersion: 1
  occurredAt: string
  payload: SocialDomainEventPayload
}
