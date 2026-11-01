// Raw Supabase calls for sharing. Posts are created only through social_create_post (rate limit, payload
// validation, group check); media rows are inserted by the author within 10 minutes (RLS + storage policy).
import { supabase } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'
import { SOCIAL_BUCKET } from './mediaCache'
import type { AudienceChoice, MentionCandidate, PostKind, PreparedImage } from './types'

export async function isSocialEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('social_profiles').select('enabled').maybeSingle()
  if (error) throw error
  return Boolean(data?.enabled)
}

export async function myGroups(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.rpc('social_my_groups')
  if (error) throw error
  return (data ?? []).filter((g) => g.status === 'active').map((g) => ({ id: g.group_id, name: g.name }))
}

export type NewPost = {
  kind: PostKind
  body: string
  payload: Json
  target: AudienceChoice
  images: PreparedImage[]
  /** user ids of the people tagged (validated again on the server) */
  mentions?: string[]
}

/**
 * 1. create the post, 2. upload each prepared image to social-media/<uid>/<post>/<uuid>.jpg,
 * 3. insert its post_media row. Any failure deletes the post (storage objects follow via the cleanup queue).
 */
export async function publishPost(userId: string, p: NewPost): Promise<string> {
  const { data: postId, error } = await supabase.rpc('social_create_post', {
    p_kind: p.kind,
    p_body: p.body.trim() || undefined,
    p_payload: p.payload,
    p_audience: p.target.audience,
    p_group: p.target.audience === 'group' ? (p.target.groupId ?? undefined) : undefined,
    p_mentions: p.mentions?.length ? p.mentions : undefined,
  })
  // RATE_LIMITED here is a daily limit (20 posts or 50 tags a day), not the generic "wait a minute"
  if (error) throw /RATE_LIMITED/.test(error.message) ? new Error('POST_RATE_LIMITED') : error
  try {
    const bucket = supabase.storage.from(SOCIAL_BUCKET)
    for (const [position, img] of p.images.entries()) {
      const path = `${userId}/${postId}/${crypto.randomUUID()}.jpg`
      const up = await bucket.upload(path, img.blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' })
      if (up.error) throw up.error
      const { error: mErr } = await supabase
        .from('post_media')
        .insert({ post_id: postId, author_id: userId, path, width: img.width, height: img.height, position })
      if (mErr) throw mErr
    }
  } catch (e) {
    await deletePost(postId).catch((cleanup: unknown) => console.error('post cleanup failed', cleanup))
    throw e
  }
  return postId
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase.rpc('social_delete_post', { p_post: postId })
  if (error) throw error
}

export async function setAudience(postId: string, target: AudienceChoice): Promise<void> {
  const { error } = await supabase.rpc('social_set_audience', {
    p_post: postId,
    p_audience: target.audience,
    p_group: target.audience === 'group' ? (target.groupId ?? undefined) : undefined,
  })
  if (error) throw error
}

export async function setLike(postId: string, like: boolean): Promise<number> {
  const { data, error } = like
    ? await supabase.rpc('social_like', { p_post: postId })
    : await supabase.rpc('social_unlike', { p_post: postId })
  if (error) throw error
  return data ?? 0
}

export async function reportPost(postId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('social_report', { p_kind: 'post', p_target: postId, p_reason: reason.trim() || undefined })
  if (error) throw error
}

/** Which of these ids are catalog exercises (not custom) that the caller can read. */
export async function catalogExerciseIds(ids: string[]): Promise<Set<string>> {
  const valid = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  if (!valid.length) return new Set()
  const { data, error } = await supabase.from('exercises').select('id').in('id', valid).eq('is_custom', false)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.id))
}

/**
 * People the caller may tag on a post for this audience/group (max 8): prefix of the username or of a
 * word of the display name; an empty query lists the most recent relations.
 */
export async function mentionCandidates(query: string, target: AudienceChoice): Promise<MentionCandidate[]> {
  const { data, error } = await supabase.rpc('social_mention_candidates', {
    p_query: query,
    p_audience: target.audience,
    p_group: target.audience === 'group' ? (target.groupId ?? undefined) : undefined,
  })
  if (error) throw error
  return (data ?? []).flatMap((r) =>
    r.user_id && r.username ? [{ user_id: r.user_id, username: r.username, display_name: r.display_name ?? r.username, avatar_path: r.avatar_path ?? null }] : [],
  )
}

/**
 * Which of these picked people can NOT be tagged for this audience/group. Each is looked up by its
 * username; a full page without them is inconclusive (more than 8 prefix matches) and counts as allowed,
 * the server validates again on publish.
 */
export async function disallowedMentions(people: { user_id: string; username: string }[], target: AudienceChoice): Promise<string[]> {
  const checks = await Promise.all(
    people.map(async (p) => {
      const rows = await mentionCandidates(p.username, target)
      return !rows.some((r) => r.user_id === p.user_id) && rows.length < 8 ? [p.user_id] : []
    }),
  )
  return checks.flat()
}

/** The tagged caller removes themselves from a post; true when a tag was removed. */
export async function removeMyMention(postId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('social_remove_mention', { p_post: postId })
  if (error) throw error
  return data === true
}
