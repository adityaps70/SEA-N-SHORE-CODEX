import { z } from 'zod'
import { NETWORK_TABS, type NetworkTab } from './types'

export const networkTabSchema = z.enum(NETWORK_TABS)
export const targetProfileSchema = z.object({ targetId: z.string().uuid() })
export const connectionActionSchema = z.object({ connectionId: z.string().uuid() })

export function parseNetworkTab(value: unknown): NetworkTab {
  const parsed = networkTabSchema.safeParse(value)
  return parsed.success ? parsed.data : 'discover'
}
