import type { Database } from '@/lib/database.types'
import type { MentionRef } from '../mentions'

/** One row of every social post list (social_feed, social_user_posts, social_post, ...). */
export type PostItem = Database['public']['CompositeTypes']['social_post_item']

/** A post with the composite's nullable columns resolved (see toPost). */
export type Post = {
  id: string
  author_id: string
  author_username: string
  author_display_name: string
  author_avatar_path: string | null
  kind: PostKind
  body: string | null
  payload: unknown
  audience: Audience
  group_id: string | null
  group_name: string | null
  like_count: number
  liked_by_me: boolean
  media: MediaRef[]
  created_at: string
  /** people tagged in the post, as the server stored and filtered them for the viewer */
  mentions: MentionRef[]
}

export type PostKind = 'text' | 'workout' | 'program' | 'meal' | 'photo' | 'progress' | 'compare'
export type Audience = 'public' | 'followers' | 'friends' | 'group'
export const AUDIENCES: readonly Audience[] = ['public', 'followers', 'friends', 'group']

export type MediaRef = { path: string; width: number; height: number; position: number }

export type BestSet = { weight_kg: number | null; reps: number }
export type WorkoutPayload = {
  date: string
  duration_sec: number
  volume_kg: number
  sets: number
  exercises: { name: string; best?: BestSet }[]
}
export type ProgramExercise = { name: string; exercise_id?: string; sets: number; reps_low: number; reps_high: number }
export type ProgramPayload = { name: string; days: { name: string; exercises: ProgramExercise[] }[] }
export type MealPayload = { name?: string; kcal: number; protein_g: number; carb_g: number; fat_g: number }

/** A processed image ready for upload: JPEG, EXIF stripped, <= 1280 px long edge, <= 600 KB. */
export type PreparedImage = { blob: Blob; width: number; height: number }

/** What a ShareButton pre-fills the composer with. Progress/compare images are produced in memory on demand. */
export type ShareSource =
  | { kind: 'workout'; payload: WorkoutPayload }
  | { kind: 'program'; payload: ProgramPayload }
  | { kind: 'meal'; payload: MealPayload }
  | { kind: 'photo' }
  | { kind: 'progress'; getImage: () => Promise<Blob> }
  | { kind: 'compare'; getImages: () => Promise<[Blob, Blob]>; labels: [string, string] }

/** The composer's starting point: progress/compare already decrypted, downscaled and composited in memory. */
export type ComposerInitial =
  | Exclude<ShareSource, { kind: 'progress' } | { kind: 'compare' }>
  | { kind: 'progress' | 'compare'; image: PreparedImage }

export type AudienceChoice = { audience: Audience; groupId: string | null }

/** A person the author may tag for the current audience (social_mention_candidates). */
export type MentionCandidate = { user_id: string; username: string; display_name: string; avatar_path: string | null }
