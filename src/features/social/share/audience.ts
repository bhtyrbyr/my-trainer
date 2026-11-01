import { Globe, Handshake, Users, UsersRound, type LucideIcon } from 'lucide-react'
import type { Audience, AudienceChoice } from './types'

export const AUDIENCE_ICON: Record<Audience, LucideIcon> = { public: Globe, followers: Users, friends: Handshake, group: UsersRound }

/** A group audience needs a chosen group. */
export function audienceReady(v: AudienceChoice): boolean {
  return v.audience !== 'group' || Boolean(v.groupId)
}
