import { supabase } from '@/lib/supabase'
import { LEGAL } from '@/config/brand'
import { PAGE_SIZE } from './logic'
import type {
  AdminReport,
  BlockedUser,
  FollowRequest,
  GroupHit,
  GroupInfo,
  GroupMember,
  MyGroup,
  MySocial,
  Person,
  PostItem,
  SocialNotification,
  SocialProfile,
  TagHit,
  UserHit,
} from './schema'

/**
 * Social side. The caller's own social_profiles row is read directly (RLS: owner only); everything about
 * other users goes through the definer RPCs, which apply can_view_post / can_view_profile and blocks.
 */
function check<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error
  return r.data as T
}

// --- own state --------------------------------------------------------------------------------------
export async function fetchMySocial(): Promise<MySocial | null> {
  const r = await supabase
    .from('social_profiles')
    .select('enabled, is_private, discoverable, bio, enabled_at')
    .maybeSingle()
  return check(r)
}

export async function enableSocial(): Promise<void> {
  check(await supabase.rpc('social_enable', { p_consent_version: LEGAL.socialConsentVersion }))
}

/** p_delete false = pause (data kept, hidden); true = leave and delete every social row. */
export async function disableSocial(del: boolean): Promise<void> {
  check(await supabase.rpc('social_disable', { p_delete: del }))
}

export async function updateSocialSettings(p: {
  isPrivate?: boolean
  discoverable?: boolean
  bio?: string
}): Promise<void> {
  check(
    await supabase.rpc('social_update_settings', {
      p_is_private: p.isPrivate,
      p_discoverable: p.discoverable,
      p_bio: p.bio,
    }),
  )
}

// --- posts ------------------------------------------------------------------------------------------
type Before = string | undefined
export async function fetchFeed(before: Before): Promise<PostItem[]> {
  return check(await supabase.rpc('social_feed', { p_before: before, p_limit: PAGE_SIZE })) ?? []
}
export async function fetchDiscover(before: Before): Promise<PostItem[]> {
  return check(await supabase.rpc('social_discover', { p_before: before, p_limit: PAGE_SIZE })) ?? []
}
export async function fetchUserPosts(user: string, before: Before): Promise<PostItem[]> {
  return (
    check(await supabase.rpc('social_user_posts', { p_user: user, p_before: before, p_limit: PAGE_SIZE })) ??
    []
  )
}
export async function fetchGroupPosts(group: string, before: Before): Promise<PostItem[]> {
  return (
    check(
      await supabase.rpc('social_group_posts', { p_group: group, p_before: before, p_limit: PAGE_SIZE }),
    ) ?? []
  )
}
/** Posts with one hashtag (same row shape and keyset as social_discover); `tag` is already normalised. */
export async function fetchTagPosts(tag: string, before: Before): Promise<PostItem[]> {
  return check(await supabase.rpc('social_tag_posts', { p_tag: tag, p_before: before, p_limit: PAGE_SIZE })) ?? []
}
export async function fetchPost(id: string): Promise<PostItem | null> {
  return (check(await supabase.rpc('social_post', { p_post: id })) ?? [])[0] ?? null
}

// --- people -----------------------------------------------------------------------------------------
export async function fetchProfile(user: string): Promise<SocialProfile | null> {
  return (check(await supabase.rpc('social_profile', { p_user: user })) ?? [])[0] ?? null
}
export async function searchUsers(q: string): Promise<UserHit[]> {
  return check(await supabase.rpc('social_search_users', { p_query: q })) ?? []
}
/** Hashtags by prefix, most used first. */
export async function searchTags(q: string): Promise<TagHit[]> {
  return check(await supabase.rpc('social_search_tags', { p_query: q })) ?? []
}
export async function fetchFollowers(user: string): Promise<Person[]> {
  return check(await supabase.rpc('social_followers', { p_user: user })) ?? []
}
export async function fetchFollowing(user: string): Promise<Person[]> {
  return check(await supabase.rpc('social_following', { p_user: user })) ?? []
}
export async function fetchFollowRequests(): Promise<FollowRequest[]> {
  return check(await supabase.rpc('social_follow_requests')) ?? []
}
export async function fetchBlocked(): Promise<BlockedUser[]> {
  return check(await supabase.rpc('social_blocked_users')) ?? []
}
export async function follow(user: string): Promise<string> {
  return check(await supabase.rpc('social_follow', { p_user: user }))
}
export async function unfollow(user: string): Promise<void> {
  check(await supabase.rpc('social_unfollow', { p_user: user }))
}
export async function respondFollow(follower: string, accept: boolean): Promise<void> {
  check(await supabase.rpc('social_respond_follow', { p_follower: follower, p_accept: accept }))
}
export async function removeFollower(user: string): Promise<void> {
  check(await supabase.rpc('social_remove_follower', { p_user: user }))
}
export async function block(user: string): Promise<void> {
  check(await supabase.rpc('social_block', { p_user: user }))
}
export async function unblock(user: string): Promise<void> {
  check(await supabase.rpc('social_unblock', { p_user: user }))
}
export async function report(kind: 'post' | 'user' | 'group', target: string, reason: string): Promise<void> {
  check(await supabase.rpc('social_report', { p_kind: kind, p_target: target, p_reason: reason }))
}

// --- notifications ----------------------------------------------------------------------------------
export async function fetchNotifications(before: Before): Promise<SocialNotification[]> {
  return check(await supabase.rpc('social_notifications_list', { p_before: before, p_limit: 30 })) ?? []
}
export async function fetchUnreadCount(): Promise<number> {
  return check(await supabase.rpc('social_unread_count')) ?? 0
}
export async function markRead(ids: string[] | null): Promise<void> {
  check(await supabase.rpc('social_mark_read', ids ? { p_ids: ids } : {}))
}

// --- groups -----------------------------------------------------------------------------------------
export async function fetchMyGroups(): Promise<MyGroup[]> {
  return check(await supabase.rpc('social_my_groups')) ?? []
}
export async function fetchGroup(id: string): Promise<GroupInfo | null> {
  return (check(await supabase.rpc('social_group', { p_group: id })) ?? [])[0] ?? null
}
export async function searchGroups(q: string): Promise<GroupHit[]> {
  return check(await supabase.rpc('social_search_groups', { p_query: q })) ?? []
}
export async function fetchGroupMembers(id: string): Promise<GroupMember[]> {
  return check(await supabase.rpc('social_group_members', { p_group: id })) ?? []
}
export async function createGroup(
  name: string,
  description: string,
  visibility: 'open' | 'closed',
): Promise<string> {
  return check(
    await supabase.rpc('group_create', {
      p_name: name,
      p_description: description || undefined,
      p_visibility: visibility,
    }),
  )
}
export async function updateGroup(
  id: string,
  p: { name?: string; description?: string; visibility?: 'open' | 'closed' },
): Promise<void> {
  check(
    await supabase.rpc('group_update', {
      p_group: id,
      p_name: p.name,
      p_description: p.description,
      p_visibility: p.visibility,
    }),
  )
}
export async function joinGroup(id: string): Promise<string> {
  return check(await supabase.rpc('group_join', { p_group: id }))
}
/** A wrong code returns null (the server counts the attempt; 20 misses an hour -> RATE_LIMITED). */
export async function joinGroupByCode(code: string): Promise<string> {
  const id = check(await supabase.rpc('group_join_by_code', { p_code: code }))
  if (!id) throw new Error('GROUP_CODE_NOT_FOUND')
  return id
}
export async function inviteToGroup(group: string, user: string): Promise<void> {
  check(await supabase.rpc('group_invite', { p_group: group, p_user: user }))
}
/** user omitted: answer my own invitation; otherwise an owner/admin answers user's join request. */
export async function respondGroup(group: string, accept: boolean, user?: string): Promise<void> {
  check(await supabase.rpc('group_respond', { p_group: group, p_accept: accept, p_user: user }))
}
export async function setGroupRole(
  group: string,
  user: string,
  role: 'owner' | 'admin' | 'member',
): Promise<void> {
  check(await supabase.rpc('group_set_role', { p_group: group, p_user: user, p_role: role }))
}
/** Removed (banned) members; owner/admin only. */
export async function fetchGroupBans(group: string) {
  return check(await supabase.rpc('group_bans_list', { p_group: group })) ?? []
}
export async function unbanGroupMember(group: string, user: string): Promise<void> {
  check(await supabase.rpc('group_unban', { p_group: group, p_user: user }))
}
export async function removeGroupMember(group: string, user: string): Promise<void> {
  check(await supabase.rpc('group_remove_member', { p_group: group, p_user: user }))
}
export async function leaveGroup(group: string): Promise<void> {
  check(await supabase.rpc('group_leave', { p_group: group }))
}
export async function rotateGroupCode(group: string): Promise<string> {
  return check(await supabase.rpc('group_rotate_code', { p_group: group }))
}
export async function deleteGroup(group: string): Promise<void> {
  check(await supabase.rpc('group_delete', { p_group: group }))
}

// --- admin ------------------------------------------------------------------------------------------
export async function adminListReports(status: 'open' | 'resolved'): Promise<AdminReport[]> {
  return check(await supabase.rpc('admin_list_reports', { p_status: status })) ?? []
}
export async function adminResolveReport(id: string): Promise<void> {
  check(await supabase.rpc('admin_resolve_report', { p_id: id }))
}
export async function adminRemovePost(id: string): Promise<void> {
  check(await supabase.rpc('admin_remove_post', { p_post: id }))
}
