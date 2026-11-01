// DEV ONLY (registered under /__dev/social in router.tsx behind import.meta.env.DEV).
// Community with a seeded cache and no network for reads: ?state=off|underage|nobirth shows the join flow.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/app/AppShell'
import { AdminPreviewContext } from '@/features/admin/previewContext'
import { useAuth } from '@/features/auth/AuthProvider'
import { leaderboardKeys } from '@/features/leaderboard/hooks'
import { profileKeys } from '@/features/profile/hooks'
import type { LeaderboardRow } from '@/lib/database.types'
import { socialKeys } from '../hooks'
import type {
  AdminReport,
  GroupInfo,
  GroupMember,
  MyGroup,
  Person,
  PostItem,
  SocialNotification,
  SocialProfile,
} from '../schema'

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const pages = <T,>(rows: T[]) => ({ pages: [rows], pageParams: [undefined] })
/** RPC row types say string where the database returns null; sample rows mirror the database. */
const rowOf = <T,>(v: Record<string, unknown>) => v as unknown as T

const PEOPLE = [
  { id: 'sample-2', username: 'deniz.k', name: 'Deniz Kaya' },
  { id: 'sample-3', username: 'mert_lifts', name: 'Mert Aydın' },
  { id: 'sample-4', username: 'elif.runs', name: 'Elif Demir' },
  { id: 'sample-5', username: 'can.ozt', name: 'Can Öztürk' },
]

function post(
  i: number,
  author: (typeof PEOPLE)[number],
  body: string,
  minutes: number,
  extra: Partial<PostItem> = {},
): PostItem {
  return {
    id: `post-${i}`,
    author_id: author.id,
    author_username: author.username,
    author_display_name: author.name,
    author_avatar_path: null,
    kind: 'text',
    body,
    payload: {},
    audience: 'followers',
    group_id: null,
    group_name: null,
    like_count: (i * 7) % 23,
    liked_by_me: i % 2 === 0,
    media: [],
    created_at: ago(minutes),
    mentions: [],
    ...extra,
  }
}

function seed(
  state: string | null,
  me: { id: string; username: string; name: string; avatar: string | null; level: number },
): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      },
    },
  })
  const enabled = !state
  qc.setQueryData(socialKeys.me, {
    enabled,
    is_private: true,
    discoverable: true,
    bio: enabled ? 'Push/pull/legs, 4x a week.' : null,
    enabled_at: enabled ? ago(9000) : null,
    allow_mentions: true,
  })
  qc.setQueryData(profileKeys.private, {
    birth_year: state === 'nobirth' ? null : state === 'underage' ? new Date().getFullYear() - 16 : 1992,
    height_cm: 178,
    sex: null,
    goal: null,
    target_weight_kg: null,
  })

  const [deniz, mert, elif, can] = PEOPLE as [
    (typeof PEOPLE)[number],
    (typeof PEOPLE)[number],
    (typeof PEOPLE)[number],
    (typeof PEOPLE)[number],
  ]
  const feed = [
    post(1, deniz, 'Yeni deadlift rekoru: 140 kg x 3. Altı aydır bu ana çalışıyordum. #Deadlift #PR', 25),
    post(2, elif, 'Sabah 10 km, tempo 5:20. Yağmur başlamadan bitirdim, @mert_lifts yarın sen de gel.', 140, {
      audience: 'public',
      mentions: [{ user_id: mert.id, username: mert.username, display_name: mert.name }],
    }),
    post(3, can, 'Salı akşamı grup antrenmanı 19:00, herkes gelsin.', 400, {
      audience: 'group',
      group_id: 'g1',
      group_name: 'Kadıköy Barbell',
    }),
    post(4, mert, 'İki haftadır uyku düzenim oturdu, farkı squatta hissediyorum. #BacakGünü', 1500),
  ]
  qc.setQueryData(socialKeys.feed('following'), pages(feed))
  qc.setQueryData(
    socialKeys.feed('discover'),
    pages([
      feed[1]!,
      post(5, deniz, 'Kardiyo günleri için 20 dakikalık interval önerisi.', 3000, { audience: 'public' }),
    ]),
  )
  qc.setQueryData(socialKeys.unread, 3)
  qc.setQueryData(socialKeys.tagPosts('bacakgünü'), pages([feed[3]!, post(8, elif, 'Squat 5x5 bitti. #bacakgünü', 4000)]))
  qc.setQueryData(socialKeys.searchTags('bacak'), [
    { tag: 'bacakgünü', post_count: 128 },
    { tag: 'bacak', post_count: 41 },
    { tag: 'bacakantrenmanı', post_count: 9 },
  ])

  const profile = (p: (typeof PEOPLE)[number], o: Partial<SocialProfile>): SocialProfile =>
    rowOf<SocialProfile>({
      user_id: p.id,
      username: p.username,
      display_name: p.name,
      avatar_path: null,
      bio: null,
      level: 4,
      badges: ['first_workout', 'streak_7', 'sets_100'],
      followers_count: 128,
      following_count: 87,
      posts_count: 42,
      is_private: false,
      relation: 'following',
      follows_me: false,
      incoming_request: false,
      can_view: true,
      ...o,
    })
  qc.setQueryData(
    socialKeys.profile(deniz.id),
    profile(deniz, { bio: 'Powerlifting, 4 yıl. Kadıköy.', relation: 'friends', follows_me: true }),
  )
  qc.setQueryData(
    socialKeys.profile(mert.id),
    profile(mert, {
      is_private: true,
      relation: 'none',
      can_view: false,
      incoming_request: true,
      posts_count: 12,
    }),
  )
  qc.setQueryData(socialKeys.profile(me.id), {
    ...profile(
      { id: me.id, username: me.username, name: me.name },
      {
        relation: 'self',
        is_private: true,
        level: me.level,
        followers_count: 34,
        following_count: 20,
        posts_count: 12,
      },
    ),
    avatar_path: me.avatar,
    bio: 'Push/pull/legs, 4x a week.',
  })
  qc.setQueryData(
    socialKeys.userPosts(deniz.id),
    pages([feed[0]!, post(6, deniz, 'Bugün bacak günü, hafif başladım.', 2900)]),
  )
  qc.setQueryData(
    socialKeys.userPosts(me.id),
    pages([post(7, { id: me.id, username: me.username, name: me.name }, 'İlk paylaşımım!', 600)]),
  )

  const person = (p: (typeof PEOPLE)[number], min: number): Person =>
    rowOf<Person>({
      user_id: p.id,
      username: p.username,
      display_name: p.name,
      avatar_path: null,
      since: ago(min),
    })
  qc.setQueryData(socialKeys.followers(deniz.id), [person(elif, 100), person(can, 900)])
  qc.setQueryData(socialKeys.followers(me.id), [person(deniz, 100), person(elif, 900), person(can, 2000)])
  qc.setQueryData(socialKeys.following(me.id), [person(deniz, 100)])
  qc.setQueryData(socialKeys.requests, [
    rowOf({
      user_id: mert.id,
      username: mert.username,
      display_name: mert.name,
      avatar_path: null,
      created_at: ago(30),
    }),
  ])
  qc.setQueryData(socialKeys.blocked, [])

  const notif = (
    i: number,
    kind: string,
    actor: (typeof PEOPLE)[number] | null,
    min: number,
    read: boolean,
    extra: Partial<SocialNotification> = {},
  ): SocialNotification =>
    rowOf<SocialNotification>({
      id: `n${i}`,
      kind,
      actor_id: actor?.id ?? null,
      actor_username: actor?.username ?? null,
      actor_display_name: actor?.name ?? null,
      actor_avatar_path: null,
      post_id: null,
      group_id: null,
      group_name: null,
      created_at: ago(min),
      read_at: read ? ago(min - 1) : null,
      ...extra,
    })
  qc.setQueryData(
    socialKeys.notifications,
    pages([
      notif(1, 'follow_request', mert, 12, false),
      notif(6, 'mention', elif, 30, false, { post_id: 'post-2' }),
      notif(2, 'like', deniz, 50, false, { post_id: 'post-7' }),
      notif(3, 'group_invite', can, 180, false, { group_id: 'g2', group_name: 'Sabah Koşucuları' }),
      notif(4, 'follow_accepted', elif, 1440, true),
      notif(5, 'follow', deniz, 4000, true),
    ]),
  )

  const myGroup = (id: string, name: string, o: Partial<MyGroup>): MyGroup =>
    rowOf<MyGroup>({
      group_id: id,
      name,
      description: null,
      visibility: 'open',
      owner_id: me.id,
      role: 'member',
      status: 'active',
      member_count: 12,
      invite_code: null,
      created_at: ago(20000),
      ...o,
    })
  qc.setQueryData(socialKeys.myGroups, [
    myGroup('g2', 'Sabah Koşucuları', { status: 'invited', member_count: 31 }),
    myGroup('g1', 'Kadıköy Barbell', {
      role: 'owner',
      member_count: 18,
      visibility: 'closed',
      invite_code: 'K7XQ2MPA9R',
    }),
    myGroup('g3', '5x5 Disiplini', { member_count: 64 }),
  ])
  const group: GroupInfo = {
    group_id: 'g1',
    name: 'Kadıköy Barbell',
    description: "Salı ve perşembe akşamları birlikte çalışan barbell ekibi. Programlar, PR'lar, motivasyon.",
    visibility: 'closed',
    owner_id: me.id,
    member_count: 18,
    my_role: 'owner',
    my_status: 'active',
    invite_code: 'K7XQ2MPA9R',
    can_view_posts: true,
    created_at: ago(20000),
  }
  qc.setQueryData(socialKeys.group('g1'), group)
  qc.setQueryData(socialKeys.groupPosts('g1'), pages([feed[2]!]))
  const member = (
    p: { id: string; username: string; name: string },
    role: string,
    status: string,
  ): GroupMember =>
    rowOf<GroupMember>({
      user_id: p.id,
      username: p.username,
      display_name: p.name,
      avatar_path: null,
      role,
      status,
      joined_at: ago(5000),
    })
  qc.setQueryData(socialKeys.groupMembers('g1'), [
    member({ id: me.id, username: me.username, name: me.name }, 'owner', 'active'),
    member(deniz, 'admin', 'active'),
    member(elif, 'member', 'active'),
    member(mert, 'member', 'pending'),
  ])

  const reports: AdminReport[] = [
    rowOf<AdminReport>({
      id: 'r1',
      reporter_id: elif.id,
      reporter_username: elif.username,
      target_kind: 'post',
      target_id: 'post-9',
      reason: 'spam: same link posted ten times',
      status: 'open',
      created_at: ago(90),
      resolved_at: null,
      target: {
        author_id: can.id,
        author_username: can.username,
        kind: 'text',
        body: 'Protein tozunda %50 indirim, linke tıkla!',
        media: [],
      },
    }),
    rowOf<AdminReport>({
      id: 'r2',
      reporter_id: deniz.id,
      reporter_username: deniz.username,
      target_kind: 'user',
      target_id: mert.id,
      reason: 'harassment',
      status: 'open',
      created_at: ago(600),
      resolved_at: null,
      target: { username: mert.username, display_name: mert.name, bio: null },
    }),
  ]
  qc.setQueryData(socialKeys.adminReports('open'), reports)
  qc.setQueryData(socialKeys.adminReports('resolved'), [])

  const lb = (
    rank: number,
    p: { id: string; username: string; name: string },
    points: number,
    isMe = false,
  ): LeaderboardRow => ({
    rank,
    user_id: p.id,
    username: p.username,
    display_name: p.name,
    avatar_path: '',
    points,
    level: 3,
    active_days: 5,
    streak: 12,
    is_me: isMe,
  })
  qc.setQueryData(leaderboardKeys.period('week'), [
    lb(1, deniz, 910),
    lb(2, { id: me.id, username: me.username, name: me.name }, 845, true),
    lb(3, elif, 420),
    lb(4, can, 180),
  ])
  return qc
}

/** Layout route: sample cache + admin preview flag + the normal app frame (tab bar). */
export function DevSocialLayout() {
  const [params] = useSearchParams()
  const { profile } = useAuth()
  const [client] = useState(() =>
    seed(params.get('state'), {
      id: profile?.user_id ?? 'me',
      username: profile?.username ?? 'me',
      name: profile?.display_name ?? 'Me',
      avatar: profile?.avatar_path ?? null,
      level: profile?.level ?? 1,
    }),
  )
  return (
    <QueryClientProvider client={client}>
      <AdminPreviewContext.Provider value={true}>
        <AppShell />
      </AdminPreviewContext.Provider>
    </QueryClientProvider>
  )
}
