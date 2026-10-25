import type { Tables } from '@/lib/database.types'

export type PhotoRow = Tables<'progress_photos'>
export const POSES = ['front', 'side', 'back', 'other'] as const
export type Pose = (typeof POSES)[number]

/** Encrypted with the photo; never stored in the clear. */
export type PhotoMeta = { note?: string; weight?: number | null }
