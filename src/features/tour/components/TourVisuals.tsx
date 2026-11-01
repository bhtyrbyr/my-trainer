import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bell,
  Check,
  Download,
  Droplets,
  Dumbbell,
  Heart,
  LayoutDashboard,
  LineChart,
  Lock,
  Moon,
  PlusSquare,
  Scale,
  Search,
  Share,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  WifiOff,
} from 'lucide-react'
import { APP_NAME } from '@/config/brand'
import { useAuth } from '@/features/auth/AuthProvider'
import { BadgeMedal } from '@/features/badges/components/BadgeMedal'
import { StreakFlame } from '@/features/gamification/StreakFlame'
import { useUnits } from '@/features/settings/useUnits'
import { cn } from '@/lib/utils'
import type { TourStep } from '../logic'

/**
 * Each step shows a slice of the real screen it talks about, drawn with the app's own tokens and
 * components (BadgeMedal, StreakFlame, the tab bar), not illustrations. Decorative: the slide text
 * carries the meaning, so the plate is aria-hidden.
 */
export function TourVisual({ step }: { step: TourStep }) {
  const View = VIEWS[step]
  return (
    <div
      aria-hidden
      className="hairline pointer-events-none relative max-h-full w-full overflow-hidden rounded-[var(--radius-sheet)] bg-surface select-none [mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]"
    >
      <View />
    </div>
  )
}

const VIEWS: Record<TourStep, () => ReactNode> = {
  welcome: Welcome,
  workouts: Workouts,
  track: Track,
  progress: Progress,
  social: Social,
  privacy: Privacy,
  install: Install,
}

/** An inner card on the plate. */
function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('hairline rounded-[16px] bg-bg/60 p-3.5', className)}>{children}</div>
}

function useNumber() {
  const { i18n } = useTranslation()
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr')
  return (n: number) => nf.format(n)
}

function useWeekdays() {
  const { i18n } = useTranslation()
  const f = new Intl.DateTimeFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'tr', { weekday: 'short' })
  // 2026-11-02 is a Monday: the week starts on Monday like the rest of the app
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2026, 10, 2 + i)))
}

/* 1. Welcome: Home, as it looks on day one, above the real five-tab bar. */
const NAV = [
  { key: 'social', icon: UsersRound },
  { key: 'home', icon: LayoutDashboard },
  { key: 'workouts', icon: Dumbbell },
  { key: 'track', icon: LineChart },
  { key: 'profile', icon: UserRound },
] as const

function Welcome() {
  const { t } = useTranslation(['tour', 'common'])
  const { profile } = useAuth()
  const first = profile?.display_name?.trim().split(/\s+/)[0]
  return (
    <div className="flex flex-col">
      <div className="space-y-4 p-5">
        <div>
          <p className="text-[13px] text-ink-faint">{t('tour:mock.today')}</p>
          <p className="display mt-1 text-[28px]">
            {first ? t('tour:mock.hello', { name: first }) : t('tour:mock.helloAnon')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between text-[13px]">
              <span className="font-semibold">{t('tour:mock.level', { n: 1 })}</span>
              <span className="tabular text-ink-muted">{t('tour:mock.points', { n: 0 })}</span>
            </span>
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-raised">
              <span className="block h-full w-[6%] rounded-full bg-volt" />
            </span>
          </span>
          <span className="flex items-center gap-1.5 border-l border-line pl-4">
            <StreakFlame days={0} />
            <span className="display tabular text-[20px] leading-none">0</span>
          </span>
        </div>
        <Card className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] text-ink-faint">{t('tour:mock.todayWorkout')}</span>
            <span className="mt-0.5 block truncate text-[16px] font-semibold">{t('tour:mock.push')}</span>
            <span className="tabular block text-[12px] text-ink-muted">
              {t('tour:mock.pushMeta', { n: 5, min: 45 })}
            </span>
          </span>
          <span className="inner-glow rounded-full bg-volt px-3.5 py-2 text-[13px] font-semibold text-volt-ink">
            {t('tour:mock.startWorkout')}
          </span>
        </Card>
        <Card className="divide-y divide-line py-1">
          <span className="flex items-center gap-2.5 py-2 text-[14px]">
            <Droplets className="size-4 text-ink-faint" />
            <span className="flex-1">{t('tour:mock.suggestWater', { v: 750 })}</span>
          </span>
          <span className="flex items-center gap-2.5 py-2 text-[14px]">
            <Sparkles className="size-4 text-volt" />
            <span className="flex-1">{t('tour:mock.aiReview')}</span>
          </span>
        </Card>
      </div>
      <div className="mt-auto border-t border-line bg-bg/90 px-1 pb-6">
        <ul className="flex h-16 items-stretch justify-around">
          {NAV.map(({ key, icon: Icon }) => {
            const featured = key === 'workouts'
            return (
              <li
                key={key}
                className="flex flex-1 flex-col items-center justify-end gap-1 pb-2 text-[10.5px] font-medium leading-[14px]"
              >
                {featured ? (
                  <span className="relative h-6 w-14">
                    <span className="inner-glow absolute bottom-0 left-0 flex size-14 items-center justify-center rounded-full bg-volt text-volt-ink ring-4 ring-bg">
                      <Icon className="size-7" strokeWidth={2.25} />
                    </span>
                  </span>
                ) : (
                  <Icon className={cn('size-6', key === 'home' ? 'text-volt' : 'text-ink-muted')} />
                )}
                <span
                  className={cn(
                    key === 'home' ? 'text-volt' : featured ? 'font-semibold text-ink' : 'text-ink-muted',
                  )}
                >
                  {t(`common:nav.${key}`)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/* 2. Workouts: the weekday plan, a live set table with last time's weight and the rest timer. */
function Workouts() {
  const { t } = useTranslation('tour')
  const u = useUnits()
  const days = useWeekdays()
  const planned = [0, 2, 4]
  const sets: { kg: number; reps: number; done: boolean }[] = [
    { kg: 80, reps: 8, done: true },
    { kg: 80, reps: 8, done: true },
    { kg: 82.5, reps: 6, done: false },
  ]
  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d, i) => (
          <span
            key={i}
            className={cn(
              'flex h-12 flex-col items-center justify-center gap-1 rounded-[12px] text-[12px] font-medium',
              i === 0 ? 'bg-volt text-volt-ink' : 'hairline text-ink-muted',
            )}
          >
            {d}
            <span
              className={cn(
                'size-1 rounded-full',
                planned.includes(i) ? (i === 0 ? 'bg-volt-ink' : 'bg-volt') : 'bg-transparent',
              )}
            />
          </span>
        ))}
      </div>
      <Card className="overflow-hidden p-0">
        <div className="px-3.5 pt-3.5">
          <p className="text-[16px] font-semibold">{t('mock.bench')}</p>
          <p className="tabular mt-0.5 text-[12px] text-ink-faint">
            {t('mock.lastTime', { w: `${u.load(80)} ${u.weightLabel}`, reps: 8 })}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-[2rem_1fr_1fr_2.25rem] gap-x-2 px-3.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
          <span>{t('mock.set')}</span>
          <span>{u.weightLabel}</span>
          <span>{t('mock.reps')}</span>
          <span />
        </div>
        {sets.map((s, i) => (
          <div
            key={i}
            className={cn(
              'tabular grid grid-cols-[2rem_1fr_1fr_2.25rem] items-center gap-x-2 border-t border-line px-3.5 py-2 text-[15px]',
              !s.done && 'bg-raised/70',
            )}
          >
            <span className="text-ink-faint">{i + 1}</span>
            <span className={cn(!s.done && 'font-semibold')}>{u.load(s.kg)}</span>
            <span className={cn(!s.done && 'font-semibold')}>{s.reps}</span>
            <span
              className={cn(
                'flex size-8 items-center justify-center rounded-full',
                s.done ? 'bg-volt text-volt-ink' : 'hairline border-line-strong text-ink-faint',
              )}
            >
              <Check className="size-4" strokeWidth={2.75} />
            </span>
          </div>
        ))}
      </Card>
      <Card className="flex items-center gap-3 py-3">
        <RestRing ratio={0.62} />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] text-ink-faint">{t('mock.rest')}</span>
          <span className="display tabular block text-[26px] leading-none">1:24</span>
        </span>
        <span className="hairline rounded-full px-3 py-1.5 text-[12px] font-medium text-ink-muted">
          {t('mock.plus30')}
        </span>
      </Card>
      <p className="flex items-center gap-2 px-1 text-[12px] text-ink-muted">
        <Sparkles className="size-3.5 text-volt" />
        {t('mock.coach')}
      </p>
    </div>
  )
}

function RestRing({ ratio }: { ratio: number }) {
  const r = 17
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 40 40" className="size-11 -rotate-90">
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--color-raised)" strokeWidth="4" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="var(--color-volt)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${c * ratio} ${c}`}
      />
    </svg>
  )
}

/* 3. Track: the day logbook with its entry chips. */
function Track() {
  const { t } = useTranslation('tour')
  const u = useUnits()
  const n = useNumber()
  const days = useWeekdays()
  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {days.map((d, i) => (
          <span key={i} className="flex flex-col items-center gap-1">
            <span className="text-[11px] text-ink-faint">{d}</span>
            <span
              className={cn(
                'tabular flex size-9 items-center justify-center rounded-full text-[14px] font-medium',
                i === 3 ? 'bg-volt font-semibold text-volt-ink' : i < 3 ? 'text-ink' : 'text-ink-faint',
              )}
            >
              {2 + i}
            </span>
            <span className={cn('size-1 rounded-full', i < 3 ? 'bg-volt' : 'bg-transparent')} />
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Card className="space-y-1">
          <span className="flex items-center gap-1.5 text-[12px] text-ink-faint">
            <Scale className="size-3.5" />
            {t('mock.weight')}
          </span>
          <span className="tabular block text-[18px] font-semibold">
            {u.body(78.4)} <span className="text-[13px] font-normal text-ink-muted">{u.weightLabel}</span>
          </span>
        </Card>
        <Card className="space-y-1">
          <span className="flex items-center gap-1.5 text-[12px] text-ink-faint">
            <Moon className="size-3.5" />
            {t('mock.sleep')}
          </span>
          <span className="tabular block text-[18px] font-semibold">
            {t('mock.sleepValue', { h: 7, m: 20 })}
          </span>
        </Card>
      </div>
      <Card className="space-y-2">
        <span className="flex items-baseline justify-between text-[12px]">
          <span className="text-ink-faint">{t('mock.nutrition')}</span>
          <span className="tabular text-ink-muted">{t('mock.kcal', { v: n(1840), goal: n(2300) })}</span>
        </span>
        <span className="block h-1 overflow-hidden rounded-full bg-raised">
          <span className="block h-full w-[80%] rounded-full bg-volt" />
        </span>
        <span className="flex gap-1.5 pt-0.5">
          <span className="hairline flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-ink-muted">
            <Search className="size-3" />
            {t('mock.foodSearch')}
          </span>
          <span className="hairline flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-ink-muted">
            <Sparkles className="size-3 text-volt" />
            {t('mock.aiEstimate')}
          </span>
        </span>
      </Card>
      <Card className="flex items-center gap-3">
        <Droplets className="size-4 text-ink-faint" />
        <span className="flex flex-1 gap-1">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={cn('h-5 flex-1 rounded-[5px]', i < 6 ? 'bg-volt/80' : 'bg-raised')} />
          ))}
        </span>
        <span className="tabular text-[13px] font-medium">{t('mock.water', { v: n(1750) })}</span>
      </Card>
      <Card className="space-y-2.5 py-3">
        {[
          { label: t('mock.habitStretch'), done: true },
          { label: t('mock.todoGroceries'), done: false },
        ].map((h) => (
          <span key={h.label} className="flex items-center gap-2.5 text-[14px]">
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full',
                h.done ? 'bg-volt text-volt-ink' : 'border border-line-strong',
              )}
            >
              {h.done && <Check className="size-3" strokeWidth={3} />}
            </span>
            <span className={cn(h.done && 'text-ink-muted line-through decoration-ink-faint')}>
              {h.label}
            </span>
          </span>
        ))}
      </Card>
      <p className="flex items-center gap-2 px-1 text-[12px] text-ink-muted">
        <Lock className="size-3.5 text-volt" />
        {t('mock.photosEncrypted')}
      </p>
    </div>
  )
}

/* 4. Home summary + points: the stat strip, today's points ledger and the badge shelf. */
const WEEK = [0.7, 0, 0.9, 0.5, 1, 0, 0]

function Progress() {
  const { t } = useTranslation('tour')
  const n = useNumber()
  const days = useWeekdays()
  const ledger = [
    { label: t('mock.ptsWorkout'), pts: 40 },
    { label: t('mock.ptsWater'), pts: 10 },
    { label: t('mock.ptsMeal'), pts: 5 },
  ]
  return (
    <div className="space-y-3 p-5">
      <div className="flex divide-x divide-line">
        <Stat label={t('mock.levelLabel')} value="4" />
        <Stat label={t('mock.pointsLabel')} value={n(1240)} />
        <div className="flex-1 pl-4">
          <p className="eyebrow">{t('mock.streakLabel')}</p>
          <p className="mt-1.5 flex items-center gap-1">
            <StreakFlame days={12} />
            <span className="display tabular text-[30px] leading-none">12</span>
          </p>
        </div>
      </div>
      <div>
        <span className="block h-1 overflow-hidden rounded-full bg-raised">
          <span className="block h-full w-[48%] rounded-full bg-volt" />
        </span>
        <p className="tabular mt-1.5 text-[12px] text-ink-faint">{t('mock.toNext', { n: 260, level: 5 })}</p>
      </div>
      <Card>
        <p className="text-[12px] text-ink-faint">{t('mock.thisWeek', { n: 4 })}</p>
        <div className="mt-2.5 grid grid-cols-7 items-end gap-2">
          {days.map((d, i) => (
            <span key={i} className="flex flex-col items-center gap-1.5">
              <span className="flex h-12 w-full items-end">
                <span
                  className={cn('block w-full rounded-[4px]', WEEK[i]! > 0 ? 'bg-volt' : 'bg-raised')}
                  style={{ height: `${Math.max(WEEK[i]!, 0.12) * 100}%` }}
                />
              </span>
              <span className="text-[10.5px] text-ink-faint">{d}</span>
            </span>
          ))}
        </div>
      </Card>
      <Card className="divide-y divide-line py-1">
        {ledger.map((l) => (
          <span key={l.label} className="flex items-center justify-between py-2 text-[14px]">
            <span className="text-ink-muted">{l.label}</span>
            <span className="tabular font-semibold text-volt">+{l.pts}</span>
          </span>
        ))}
      </Card>
      <div>
        <p className="mb-2.5 px-1 text-[12px] text-ink-faint">{t('mock.badges', { n: 3, total: 32 })}</p>
        <div className="flex justify-between">
          <BadgeMedal code="first_workout" earned size={50} />
          <BadgeMedal code="streak_7" earned size={50} />
          <BadgeMedal code="sets_100" earned size={50} />
          <BadgeMedal code="habit_30" earned={false} ratio={0.6} size={50} />
          <BadgeMedal code="pr_10" earned={false} ratio={0.3} size={50} />
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 px-4 first:pl-0">
      <p className="eyebrow">{label}</p>
      <p className="display tabular mt-1.5 text-[30px] leading-none">{value}</p>
    </div>
  )
}

/* 5. Community: Home | Discover, a feed post with a finished workout, private by default. */
function Social() {
  const { t } = useTranslation(['tour', 'social'])
  const u = useUnits()
  const n = useNumber()
  return (
    <div className="space-y-3 p-5">
      {/* the real section switch: two words split by a hairline, the active one on a volt dot */}
      <div className="flex items-center text-center text-[13px] font-semibold">
        <span className="relative flex-1 pb-2.5 text-ink">
          {t('social:tabs.home')}
          <span className="absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-volt" />
        </span>
        <span className="mb-2.5 h-3.5 w-px bg-line-strong" />
        <span className="flex-1 pb-2.5 text-ink-faint">{t('social:tabs.discover')}</span>
      </div>
      {/* a timeline row like the real feed: avatar column, no card */}
      <div className="flex gap-3 border-b border-line pb-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-[13px] font-semibold">
          DK
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="truncate text-[13px] leading-tight">
            <span className="font-semibold">{t('tour:mock.postAuthor')}</span>
            <span className="text-ink-faint"> · {t('tour:mock.postTime')}</span>
          </p>
          <p className="text-[14px] leading-snug">{t('tour:mock.postText')}</p>
          <div className="hairline grid grid-cols-3 divide-x divide-line rounded-[12px] py-2 text-center">
            <PostStat value="42" unit={t('tour:mock.min')} />
            <PostStat value={u.volume(12400)} unit={u.weightLabel} />
            <PostStat value="3" unit={t('tour:mock.prs')} />
          </div>
          <span className="flex items-center gap-1.5 text-[13px] text-volt">
            <Heart className="size-4 fill-volt" />
            <span className="tabular">18</span>
          </span>
        </div>
      </div>
      <Card className="divide-y divide-line py-1">
        {[
          { rank: 1, name: t('tour:mock.rank1'), pts: 2480 },
          { rank: 2, name: t('tour:mock.you'), pts: 2135, me: true },
          { rank: 3, name: t('tour:mock.rank3'), pts: 1990 },
        ].map((r) => (
          <span key={r.rank} className="tabular flex items-center gap-3 py-2 text-[14px]">
            <span className="w-4 text-ink-faint">{r.rank}</span>
            <span className={cn('flex-1', r.me && 'font-semibold text-volt')}>{r.name}</span>
            <span className="text-ink-muted">{n(r.pts)}</span>
          </span>
        ))}
      </Card>
      <p className="flex items-center gap-2 px-1 text-[12px] text-ink-muted">
        <Lock className="size-3.5 text-volt" />
        {t('tour:mock.privateDefault')}
      </p>
    </div>
  )
}

function PostStat({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="tabular leading-tight">
      <span className="block text-[16px] font-semibold">{value}</span>
      <span className="block text-[11px] text-ink-faint">{unit}</span>
    </span>
  )
}

/* 6. Privacy: where the controls live, as the Settings rows look. */
function Privacy() {
  // the real Settings labels, so the user recognises the rows later
  const { t } = useTranslation(['tour', 'legal', 'settings', 'common'])
  const rows: { icon: typeof Lock; label: string; on?: boolean; danger?: boolean; value?: string }[] = [
    { icon: Lock, label: t('tour:mock.onlyYou'), value: t('tour:mock.onlyYouValue') },
    { icon: Download, label: t('legal:settings.export'), value: 'JSON' },
    { icon: Sparkles, label: t('legal:ai.setting'), on: false },
    { icon: Heart, label: t('legal:settings.health'), on: true },
    { icon: Trash2, label: t('legal:settings.delete'), danger: true },
  ]
  return (
    <div className="space-y-3 p-5">
      <p className="px-1 text-[12px] text-ink-faint">
        {[t('common:nav.profile'), t('settings:title'), t('legal:settings.section')].join(' › ')}
      </p>
      <div className="hairline divide-y divide-line overflow-hidden rounded-[16px] bg-bg/60">
        {rows.map(({ icon: Icon, label, on, danger, value }) => (
          <div key={label} className="flex min-h-12 items-center gap-3 px-3.5 py-2.5">
            <Icon className={cn('size-[18px] shrink-0', danger ? 'text-danger' : 'text-ink-muted')} />
            <span className={cn('min-w-0 flex-1 text-[14px]', danger && 'text-danger')}>{label}</span>
            {value && <span className="text-[13px] text-ink-faint">{value}</span>}
            {on !== undefined && (
              <span
                className={cn(
                  'flex h-6 w-10 items-center rounded-full p-0.5',
                  on ? 'justify-end bg-volt' : 'bg-raised',
                )}
              >
                <span className={cn('size-5 rounded-full', on ? 'bg-volt-ink' : 'bg-ink-faint')} />
              </span>
            )}
          </div>
        ))}
      </div>
      <Card className="flex items-center gap-3">
        <span className="tabular flex gap-1 font-mono text-[13px] text-ink-faint">
          {['a9', 'f3', '0c', '7e'].map((b) => (
            <span key={b} className="rounded-[5px] bg-raised px-1.5 py-0.5">
              {b}
            </span>
          ))}
        </span>
        <span className="text-[12px] leading-snug text-ink-muted">{t('tour:mock.encryptedNote')}</span>
      </Card>
    </div>
  )
}

/* 7. Install: Safari's share button, "Add to Home Screen", and the icon on the Home Screen. */
function Install() {
  const { t } = useTranslation('tour')
  const host = typeof window === 'undefined' ? '' : window.location.host
  return (
    <div className="space-y-3 p-5">
      <Card className="flex items-center gap-3 py-2.5">
        <span className="min-w-0 flex-1 truncate rounded-[10px] bg-raised px-3 py-2 text-center text-[13px] text-ink-muted">
          {host}
        </span>
        <span className="relative flex size-10 items-center justify-center rounded-full ring-2 ring-volt">
          <Share className="size-5 text-volt" />
          <Num n={1} />
        </span>
      </Card>
      <Card className="divide-y divide-line overflow-hidden p-0">
        <span className="flex items-center gap-3 px-3.5 py-3 text-[14px] text-ink-faint">
          <Share className="size-[18px]" />
          {t('mock.copyLink')}
        </span>
        <span className="relative flex items-center gap-3 bg-raised/70 px-3.5 py-3 text-[14px] font-semibold">
          <PlusSquare className="size-[18px] text-volt" />
          <span className="flex-1">{t('mock.addToHome')}</span>
          <Num n={2} inline />
        </span>
      </Card>
      <Card className="relative">
        <div className="grid grid-cols-4 gap-x-3 gap-y-3">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="aspect-square rounded-[14px] bg-raised" />
          ))}
          <span className="flex flex-col items-center gap-1">
            <span className="relative">
              <img
                src="/pwa-192x192.png"
                alt=""
                className="aspect-square w-full rounded-[14px] ring-2 ring-volt"
              />
              <Num n={3} />
            </span>
            <span className="max-w-full truncate text-[10px] text-ink-muted">{APP_NAME}</span>
          </span>
        </div>
      </Card>
      <div className="flex gap-2">
        <span className="hairline flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-ink-muted">
          <Bell className="size-3.5 text-volt" />
          {t('mock.reminders')}
        </span>
        <span className="hairline flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-ink-muted">
          <WifiOff className="size-3.5 text-volt" />
          {t('mock.offline')}
        </span>
      </div>
    </div>
  )
}

function Num({ n, inline }: { n: number; inline?: boolean }) {
  return (
    <span
      className={cn(
        'tabular flex size-5 items-center justify-center rounded-full bg-volt text-[11px] font-bold text-volt-ink',
        !inline && 'absolute -right-1.5 -top-1.5 ring-2 ring-surface',
      )}
    >
      {n}
    </span>
  )
}
