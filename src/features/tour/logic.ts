/**
 * First-run tour: which steps to show and when. Pure, so the rules are unit-tested (logic.test.ts).
 */
export const TOUR_STEPS = [
  'welcome',
  'workouts',
  'track',
  'progress',
  'social',
  'privacy',
  'install',
] as const
export type TourStep = (typeof TOUR_STEPS)[number]

type DisplayEnv = {
  matchMedia?: (query: string) => { matches: boolean }
  navigator?: object & { standalone?: boolean }
}

/** Running as an installed app (iOS Home Screen or an installed PWA)? */
export function isStandalone(
  env: DisplayEnv | undefined = typeof window === 'undefined' ? undefined : (window as DisplayEnv),
): boolean {
  if (!env) return false
  if (env.navigator?.standalone === true) return true
  return Boolean(env.matchMedia?.('(display-mode: standalone)').matches)
}

/** The install step only makes sense in the browser; an installed app already has it. */
export function tourSteps({ standalone }: { standalone: boolean }): TourStep[] {
  return standalone ? TOUR_STEPS.filter((s) => s !== 'install') : [...TOUR_STEPS]
}

/**
 * Show the tour once: settings are loaded, the row exists and tour_completed_at is empty, and it was
 * not dismissed earlier in this session (the write can fail offline; the tour must not come back then).
 */
export function shouldShowTour(
  settings: { tour_completed_at: string | null } | null | undefined,
  dismissed: boolean,
): boolean {
  if (dismissed || !settings) return false
  return settings.tour_completed_at === null
}

/** Keeps a step index inside the deck. */
export function clampStep(index: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(Math.max(Math.round(index), 0), count - 1)
}

/** The step a horizontal scroll position snaps to. */
export function stepFromScroll(scrollLeft: number, width: number, count: number): number {
  if (width <= 0) return 0
  return clampStep(Math.abs(scrollLeft) / width, count)
}
