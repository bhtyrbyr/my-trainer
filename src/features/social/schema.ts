import { z } from 'zod'
import type { Database } from '@/lib/database.types'

type Fns = Database['public']['Functions']
type Row<F extends keyof Fns> = Fns[F]['Returns'] extends (infer R)[] ? R : never

/** One rendered post (social_feed, social_discover, social_user_posts, social_group_posts, social_post). */
export type PostItem = Database['public']['CompositeTypes']['social_post_item']
export type SocialProfile = Row<'social_profile'>
export type Person = Row<'social_followers'>
export type FollowRequest = Row<'social_follow_requests'>
export type BlockedUser = Row<'social_blocked_users'>
export type UserHit = Row<'social_search_users'>
export type SocialNotification = Row<'social_notifications_list'>
export type MyGroup = Row<'social_my_groups'>
export type GroupInfo = Row<'social_group'>
export type GroupHit = Row<'social_search_groups'>
export type GroupMember = Row<'social_group_members'>
export type AdminReport = Row<'admin_list_reports'>

/** The caller's own social_profiles row (RLS: owner select). */
export type MySocial = {
  enabled: boolean
  is_private: boolean
  discoverable: boolean
  bio: string | null
  enabled_at: string | null
}

export type Relation = 'self' | 'friends' | 'following' | 'requested' | 'none'

export const BIO_MAX = 160
export const groupFormSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(300),
  visibility: z.enum(['open', 'closed']),
})
export type GroupForm = z.infer<typeof groupFormSchema>
