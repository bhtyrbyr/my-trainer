// DEV ONLY. Renders the real PostCard / ComposerSheet / ShareButton with sample data. The preview context
// makes every mutation resolve locally and media resolve to generated sample images: nothing reaches Supabase.
// (registered in router.tsx as /__dev/share; ?view=grid shows the profile grid, ?open=workout|program|meal|text the composer).
import { useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ComposerSheet } from '../components/ComposerSheet'
import { PostCard } from '../components/PostCard'
import { PostGrid } from '../components/PostGrid'
import { ShareButton } from '../components/ShareButton'
import { mealPayload, programPayload, workoutPayload } from '../payload'
import { SharePreviewContext, type SharePreview } from '../previewContext'
import type { PostItem, ShareSource } from '../types'

const ME = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const ELIF = '00000000-0000-4000-8000-000000000003'
const MERT = '00000000-0000-4000-8000-000000000004'
const CAN = '00000000-0000-4000-8000-000000000005'
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

function sampleSvg(hue: number, label: string, w = 960, h = 1200): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},28%,34%)"/><stop offset="1" stop-color="hsl(${hue + 40},22%,16%)"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <ellipse cx="${w / 2}" cy="${h * 0.3}" rx="${w * 0.12}" ry="${w * 0.14}" fill="hsl(${hue},18%,62%)" opacity=".55"/>
  <rect x="${w * 0.3}" y="${h * 0.42}" width="${w * 0.4}" height="${h * 0.5}" rx="${w * 0.12}" fill="hsl(${hue},18%,62%)" opacity=".45"/>
  <text x="32" y="${h - 36}" font-family="Inter, sans-serif" font-size="34" fill="#fff" opacity=".7">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const MEDIA: Record<string, string> = {
  'm/1.jpg': sampleSvg(140, 'Run'),
  'm/2.jpg': sampleSvg(20, 'Meal', 1200, 900),
  'm/3.jpg': sampleSvg(200, 'Gym', 1200, 1200),
  'm/4.jpg': sampleSvg(80, 'Park', 1200, 1200),
  'm/5.jpg': sampleSvg(100, 'Before · After', 1280, 900),
}

async function svgToBlob(src: string, w = 960, h = 1200): Promise<Blob> {
  const img = new Image()
  img.src = src
  await img.decode()
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9))
}

const workout = workoutPayload({
  startedAt: ago(90),
  durationSec: 3920,
  volumeKg: 8450,
  totalSets: 18,
  exercises: [
    { name: 'Bench Press', sets: [{ weight_kg: 80, reps: 8 }, { weight_kg: 85, reps: 5 }] },
    { name: 'Incline Dumbbell Press', sets: [{ weight_kg: 30, reps: 10 }] },
    { name: 'Pull-up', sets: [{ weight_kg: null, reps: 11 }] },
    { name: 'Barbell Row', sets: [{ weight_kg: 70, reps: 8 }] },
    { name: 'Lateral Raise', sets: [{ weight_kg: 10, reps: 15 }] },
    { name: 'Triceps Pushdown', sets: [{ weight_kg: 25, reps: 12 }] },
  ],
})
const ID = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const program = programPayload('Upper / Lower', [
  {
    name: 'Upper A',
    exercises: [
      { name: 'Bench Press', exercise_id: ID(1), sets: 4, reps_low: 6, reps_high: 8 },
      { name: 'Barbell Row', exercise_id: ID(2), sets: 4, reps_low: 8, reps_high: 10 },
      { name: 'My cable fly', sets: 3, reps_low: 12, reps_high: 15 },
    ],
  },
  { name: 'Lower A', exercises: [{ name: 'Back Squat', exercise_id: ID(3), sets: 5, reps_low: 5, reps_high: 5 }, { name: 'Romanian Deadlift', exercise_id: ID(4), sets: 3, reps_low: 8, reps_high: 10 }] },
  { name: 'Upper B', exercises: [{ name: 'Overhead Press', exercise_id: ID(5), sets: 4, reps_low: 6, reps_high: 8 }] },
])
const meal = mealPayload({ name: 'Chicken rice bowl', kcal: 642, protein_g: 48.5, carb_g: 71, fat_g: 16.2 })

const post = (p: Partial<PostItem> & Pick<PostItem, 'id' | 'kind'>): PostItem => ({
  author_id: OTHER,
  author_username: 'deniz.k',
  author_display_name: 'Deniz Kaya',
  author_avatar_path: null,
  body: null,
  payload: {},
  audience: 'followers',
  group_id: null,
  group_name: null,
  like_count: 0,
  liked_by_me: false,
  media: [],
  created_at: ago(5),
  mentions: [],
  ...p,
})

const POSTS: PostItem[] = [
  post({
    id: 'p1',
    kind: 'workout',
    body: 'Bench PR finally. 85 for 5. Thanks @elif_runs for the spot and @ben_me for the plan #PR (cc @nobody)',
    payload: workout,
    like_count: 12,
    liked_by_me: true,
    created_at: ago(42),
    mentions: [
      { user_id: ELIF, username: 'elif_runs', display_name: 'Elif Demir' },
      { user_id: ME, username: 'ben_me', display_name: 'Ben' },
    ],
  }),
  post({ id: 'p2', kind: 'program', author_id: ME, author_username: 'me', author_display_name: 'Ben', payload: program, audience: 'group', group_id: 'g1', group_name: 'Sabah Koşucuları', created_at: ago(180) }),
  post({ id: 'p3', kind: 'meal', payload: meal, media: [{ path: 'm/2.jpg', width: 1200, height: 900, position: 0 }], audience: 'public', like_count: 3, created_at: ago(60 * 26) }),
  post({
    id: 'p4',
    kind: 'photo',
    body: 'Sunday long run with the crew.',
    media: [
      { path: 'm/1.jpg', width: 960, height: 1200, position: 0 },
      { path: 'm/3.jpg', width: 1200, height: 1200, position: 1 },
      { path: 'm/4.jpg', width: 1200, height: 1200, position: 2 },
    ],
    audience: 'friends',
    like_count: 1,
    created_at: ago(60 * 24 * 9),
  }),
  post({
    id: 'p7',
    kind: 'photo',
    author_username: 'elif.runs',
    author_display_name: 'Elif Demir',
    body: 'Leg day, four angles.',
    media: [
      { path: 'm/3.jpg', width: 1200, height: 1200, position: 0 },
      { path: 'm/4.jpg', width: 1200, height: 1200, position: 1 },
      { path: 'm/1.jpg', width: 960, height: 1200, position: 2 },
      { path: 'm/2.jpg', width: 1200, height: 900, position: 3 },
    ],
    audience: 'public',
    like_count: 41,
    created_at: ago(60 * 5),
  }),
  post({ id: 'p5', kind: 'compare', author_id: ME, author_username: 'me', author_display_name: 'Ben', body: '12 weeks.', media: [{ path: 'm/5.jpg', width: 1280, height: 900, position: 0 }], audience: 'followers' }),
  post({ id: 'p6', kind: 'text', body: 'Anyone up for a 5k on Saturday morning? Meeting at the park gate, 8:00.', like_count: 0, created_at: ago(0.5) }),
]

const PREVIEW: SharePreview = {
  meId: ME,
  resolveMedia: (path) => MEDIA[path] ?? null,
  groups: [
    { id: 'g1', name: 'Sabah Koşucuları' },
    { id: 'g2', name: 'Powerlifting TR' },
  ],
  // Deniz: mutual follow, both groups; Elif: follows me, group 1; Mert: I follow him; Can: group 2 only
  people: [
    { user_id: OTHER, username: 'deniz_k', display_name: 'Deniz Kaya', avatar_path: null, allowed: () => true },
    { user_id: ELIF, username: 'elif_runs', display_name: 'Elif Demir', avatar_path: null, allowed: (t) => t.audience !== 'friends' && (t.audience !== 'group' || t.groupId === 'g1') },
    { user_id: MERT, username: 'mert_lifts', display_name: 'Mert Aydın', avatar_path: null, allowed: (t) => t.audience === 'public' },
    { user_id: CAN, username: 'can_ozt', display_name: 'Can Öztürk', avatar_path: null, allowed: (t) => t.audience === 'group' && t.groupId === 'g2' },
  ],
}

export function DevSharePreview() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return (
    <QueryClientProvider client={client}>
      <SharePreviewContext.Provider value={PREVIEW}>
        <PreviewBody />
      </SharePreviewContext.Provider>
    </QueryClientProvider>
  )
}

function PreviewBody() {
  const { t } = useTranslation('share')
  const params = new URLSearchParams(window.location.search)
  const open = params.get('open')
  const sources = useMemo<Record<string, ShareSource>>(
    () => ({
      workout: { kind: 'workout', payload: workout },
      program: { kind: 'program', payload: program },
      meal: { kind: 'meal', payload: meal },
      photo: { kind: 'photo' },
      progress: { kind: 'progress', getImage: () => svgToBlob(sampleSvg(60, 'Progress')) },
      compare: {
        kind: 'compare',
        labels: ['3 Ağu 2026', '1 Kas 2026'],
        getImages: () => Promise.all([svgToBlob(sampleSvg(30, '')), svgToBlob(sampleSvg(90, ''))]),
      },
    }),
    [],
  )
  const [composer, setComposer] = useState(open === 'text')
  const initial = open && open !== 'text' && 'payload' in (sources[open] ?? {}) ? (sources[open] as Extract<ShareSource, { payload: unknown }>) : undefined

  return (
    <div className="mx-auto max-w-md space-y-3 px-4 pb-24 pt-safe">
      <h1 className="display pt-6 text-[28px]">Share preview</h1>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setComposer(true)}>
          {t('composer.titles.text')}
        </Button>
        {Object.entries(sources).map(([k, s]) => (
          <span key={k} className="contents" data-source={k}>
            <ShareButton source={s} />
          </span>
        ))}
      </div>
      {params.get('view') === 'grid' ? (
        <div className="-mx-4 pt-2">
          <PostGrid posts={[...POSTS, ...POSTS.map((p) => ({ ...p, id: `${p.id}b` }))]} />
        </div>
      ) : (
        <ul className="-mx-4 divide-y divide-line border-y border-line">
          {POSTS.map((p) => (
            <li key={p.id}>
              <PostCard post={p} />
            </li>
          ))}
        </ul>
      )}
      <ComposerSheet open={composer || Boolean(initial)} initial={initial} onClose={() => setComposer(false)} />
    </div>
  )
}
