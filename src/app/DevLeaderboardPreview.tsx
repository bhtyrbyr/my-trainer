import { LeaderboardPage } from '@/features/leaderboard/pages/LeaderboardPage'
import { useAuth } from '@/features/auth/AuthProvider'
import type { LeaderboardRow } from '@/lib/database.types'

/**
 * Dev-only: /__dev/leaderboard with sample rows. The signed-in user is always the first row and the only
 * one marked "you", so the preview never suggests a wrong identity.
 */
export function DevLeaderboardPreview() {
  const { profile } = useAuth()
  const me: LeaderboardRow = {
    rank: 1,
    user_id: profile?.user_id ?? 'me',
    username: profile?.username ?? 'me',
    display_name: profile?.display_name ?? 'Me',
    avatar_path: profile?.avatar_path ?? '',
    points: 845,
    level: profile?.level ?? 1,
    active_days: 6,
    streak: 60,
    is_me: true,
  }
  const others: LeaderboardRow[] = [
    { rank: 2, user_id: 'sample-2', username: 'sample_two', display_name: 'Örnek Kullanıcı 2', avatar_path: '', points: 610, level: 1, active_days: 5, streak: 35, is_me: false },
    { rank: 3, user_id: 'sample-3', username: 'sample_three', display_name: 'Örnek Kullanıcı 3', avatar_path: '', points: 420, level: 1, active_days: 4, streak: 20, is_me: false },
    { rank: 4, user_id: 'sample-4', username: 'sample_four', display_name: 'Örnek Kullanıcı 4', avatar_path: '', points: 180, level: 1, active_days: 2, streak: 7, is_me: false },
  ]
  return <LeaderboardPage previewRows={[me, ...others]} />
}
