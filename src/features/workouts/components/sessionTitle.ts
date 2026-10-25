import type { TFunction } from 'i18next'

type Titled = {
  kind: string
  title: string | null
  templateName?: string | null
  cardio?: { activity: string }[]
}

/** Display title: explicit title, else the plan name, else the cardio activity, else "Free workout". */
export function sessionTitle(s: Titled, t: TFunction): string {
  if (s.title) return s.title
  if (s.templateName) return s.templateName
  if (s.kind === 'cardio') {
    const a = s.cardio?.[0]?.activity
    return a ? t('workouts:cardio.activity.' + a) : t('workouts:cardio.title')
  }
  return t('workouts:session.freeTitle')
}
