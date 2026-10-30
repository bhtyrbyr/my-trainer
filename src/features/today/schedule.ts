import type { TFunction } from 'i18next'
import type { RecurrenceRule } from '@/lib/recurrence'

/** "Every day", "Mon, Wed, Fri", "3 days a week" ... */
export function describeRule(rule: RecurrenceRule, t: TFunction): string {
  switch (rule.type) {
    case 'daily':
      return t('today:schedule.daily')
    case 'weekly': {
      const days = [...rule.days].sort()
      if (days.join() === '1,2,3,4,5') return t('today:schedule.weekdays')
      if (days.join() === '6,7') return t('today:schedule.weekend')
      if (days.length === 7) return t('today:schedule.daily')
      const names = t('today:form.weekdays', { returnObjects: true }) as string[]
      return t('today:schedule.weekly', { days: days.map((d) => names[d - 1]).join(', ') })
    }
    case 'weekly_count':
      return t('today:schedule.weekly_count', { n: rule.n })
    case 'monthly':
      return t('today:schedule.monthly', { day: rule.day })
    case 'every':
      return t('today:schedule.every', { n: rule.n })
  }
}

/** Priority marks: high = muted dot, urgent = danger dot. */
export const PRIORITY_DOT = ['', 'bg-ink-muted', 'bg-danger'] as const
