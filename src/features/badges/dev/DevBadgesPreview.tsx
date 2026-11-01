// DEV ONLY (registered under /__dev/profile in router.tsx behind import.meta.env.DEV).
// Profile tab with seeded data: a sample person when nobody is signed in, two own posts, and badges
// (three earned, the rest with progress). ?tab=badges opens the Badges section; ?fresh=1 shows nothing
// earned yet; ?social=off shows the not-joined state of Posts; ?celebrate=sets_100 opens the celebration.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/app/AppShell'
import { AdminPreviewContext } from '@/features/admin/previewContext'
import { format } from 'date-fns'
import { useAuth } from '@/features/auth/AuthProvider'
import { effectiveStreak } from '@/features/gamification/streak'
import { ProfilePage } from '@/features/profile/pages/ProfilePage'
import { socialKeys } from '@/features/social/hooks'
import type { PostItem } from '@/features/social/schema'
import type { Profile } from '@/lib/database.types'
import { BadgeCelebration } from '../components/BadgeCelebration'
import { badgeKeys } from '../hooks'
import { BADGES, type BadgeCode, type BadgeCounts, type EarnedBadge } from '../logic'
import { BadgesPreviewContext } from '../previewContext'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

const SAMPLE_EARNED: EarnedBadge[] = [
  { badge_code: 'first_workout', earned_at: daysAgo(41) },
  { badge_code: 'streak_7', earned_at: daysAgo(30) },
  { badge_code: 'sets_100', earned_at: daysAgo(6) },
]

/** Stand-in for the signed-in person when the preview runs without a session. */
const SAMPLE_PROFILE = {
  user_id: 'me',
  username: 'bahtiyar',
  display_name: 'Bahtiyar Yılmaz',
  avatar_path: '',
  role: 'admin',
  status: 'approved',
  total_points: 2340,
  level: 3,
  current_streak: 12,
  longest_streak: 21,
  last_active_on: format(new Date(), 'yyyy-MM-dd'),
  show_on_leaderboard: true,
  is_blocked: false,
  created_at: daysAgo(90),
  updated_at: daysAgo(1),
} as unknown as Profile

function samplePosts(me: Profile): PostItem[] {
  const post = (i: number, body: string, hours: number) =>
    ({
      id: `me-post-${i}`,
      author_id: me.user_id,
      author_username: me.username,
      author_display_name: me.display_name,
      author_avatar_path: me.avatar_path || null,
      kind: 'text',
      body,
      payload: {},
      audience: 'followers',
      group_id: null,
      group_name: null,
      like_count: i * 3,
      liked_by_me: false,
      media: [],
      created_at: new Date(Date.now() - hours * 3_600_000).toISOString(),
      mentions: [],
    }) as unknown as PostItem
  return [
    post(1, 'Squat 5x5 bitti, yeni PR: 120 kg. #Squat #bacakgünü', 5),
    post(2, 'Sabah koşusu, 6 km. Hava mükemmeldi.', 30),
  ]
}

/** Posts by others that tag the signed-in person (Profile > Tagged). */
function sampleTagged(me: Profile): PostItem[] {
  const tag = { user_id: me.user_id, username: me.username, display_name: me.display_name }
  const post = (i: number, author: [string, string, string], body: string, hours: number, extra: object = {}) =>
    ({
      id: `tagged-${i}`,
      author_id: author[0],
      author_username: author[1],
      author_display_name: author[2],
      author_avatar_path: null,
      kind: 'text',
      body,
      payload: {},
      audience: 'followers',
      group_id: null,
      group_name: null,
      like_count: i * 4,
      liked_by_me: i === 1,
      media: [],
      created_at: new Date(Date.now() - hours * 3_600_000).toISOString(),
      mentions: [tag],
      ...extra,
    }) as unknown as PostItem
  return [
    post(1, ['sample-2', 'deniz_k', 'Deniz Kaya'], `Bugünkü deadlift seansı @${me.username} ile, 140 kg x 3. #Deadlift`, 3),
    post(2, ['sample-4', 'elif_runs', 'Elif Demir'], `Pazar uzun koşusu bitti. @${me.username} tempoyu hiç düşürmedi.`, 50, {
      audience: 'group',
      group_id: 'g1',
      group_name: 'Sabah Koşucuları',
    }),
  ]
}

function seed(fresh: boolean): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnMount: false } },
  })
  const zero = Object.fromEntries(BADGES.map((b) => [b.metric, 0])) as BadgeCounts
  const counts: BadgeCounts = fresh
    ? zero
    : { ...zero, workouts: 14, streak: 12, sets: 236, volume_kg: 8400, prs: 6, cardio_minutes: 240, photos: 4, habit_days: 22, todos: 9, water_goal_days: 11, sleep_logs: 18, weigh_ins: 9 }
  qc.setQueryData(badgeKeys.mine, fresh ? [] : SAMPLE_EARNED)
  qc.setQueryData([...badgeKeys.counts, 0], counts)
  return qc
}

/** Layout route: sample cache + preview flags + the normal app frame (tab bar). */
export function DevProfileLayout() {
  const [params] = useSearchParams()
  const profile = useAuth().profile ?? SAMPLE_PROFILE
  const [client] = useState(() => {
    const qc = seed(params.get('fresh') === '1')
    const joined = params.get('social') !== 'off'
    qc.setQueryData(socialKeys.me, { enabled: joined, is_private: true, discoverable: true, bio: null, enabled_at: joined ? daysAgo(30) : null, allow_mentions: true })
    qc.setQueryData(socialKeys.userPosts(profile.user_id), { pages: [samplePosts(profile)], pageParams: [undefined] })
    // ?tagged=0: the empty Tagged state
    qc.setQueryData(socialKeys.mentioned, { pages: [params.get('tagged') === '0' ? [] : sampleTagged(profile)], pageParams: [undefined] })
    // the signed-in user's best streak keys the counts query
    const streak = Math.max(profile?.longest_streak ?? 0, effectiveStreak(profile?.current_streak, profile?.last_active_on))
    if (streak) qc.setQueryData([...badgeKeys.counts, streak], qc.getQueryData([...badgeKeys.counts, 0]))
    return qc
  })
  return (
    <QueryClientProvider client={client}>
      <AdminPreviewContext.Provider value={true}>
        <BadgesPreviewContext.Provider value={true}>
          <AppShell />
        </BadgesPreviewContext.Provider>
      </AdminPreviewContext.Provider>
    </QueryClientProvider>
  )
}

export function DevProfile() {
  const [params] = useSearchParams()
  const celebrate = params.get('celebrate')?.split(',') ?? []
  const codes = BADGES.map((b) => b.code).filter((c) => celebrate.includes(c)) as BadgeCode[]
  const { profile } = useAuth()
  return (
    <>
      <ProfilePage previewProfile={profile ? undefined : SAMPLE_PROFILE} />
      <BadgeCelebration preview={codes} />
    </>
  )
}
