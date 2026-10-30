import { useTranslation } from 'react-i18next'
import type { RecurrenceRule } from '@/lib/recurrence'
import { Stepper } from '@/features/workouts'
import { cn } from '@/lib/utils'

type Kind = RecurrenceRule['type'] | 'none'

const DEFAULTS: Record<RecurrenceRule['type'], RecurrenceRule> = {
  daily: { type: 'daily' },
  weekly: { type: 'weekly', days: [1, 3, 5] },
  weekly_count: { type: 'weekly_count', n: 3 },
  monthly: { type: 'monthly', day: 1 },
  every: { type: 'every', n: 2 },
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-10 rounded-full px-4 text-[14px] font-medium transition-colors',
        active ? 'bg-volt text-volt-ink' : 'hairline bg-bg text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Schedule chooser shared by habits (no "none", weekly quota allowed) and to-dos ("none" = one-off,
 * no weekly quota).
 */
export function RulePicker({ value, onChange, kinds }: { value: RecurrenceRule | null; onChange: (r: RecurrenceRule | null) => void; kinds: Kind[] }) {
  const { t } = useTranslation('today')
  const kind: Kind = value?.type ?? 'none'
  const names = t('form.weekdays', { returnObjects: true }) as string[]
  const longNames = t('form.weekdaysLong', { returnObjects: true }) as string[]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <Chip key={k} active={kind === k} onClick={() => onChange(k === 'none' ? null : kind === k ? value : DEFAULTS[k])}>
            {t(`form.rules.${k}`)}
          </Chip>
        ))}
      </div>
      {value?.type === 'weekly' && (
        <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={t('form.rules.weekly')}>
          {names.map((n, i) => {
            const d = i + 1
            const on = value.days.includes(d)
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={longNames[i]}
                onClick={() => {
                  const days = on ? value.days.filter((x) => x !== d) : [...value.days, d].sort()
                  if (days.length) onChange({ type: 'weekly', days })
                }}
                className={cn(
                  'h-11 rounded-[var(--radius-input)] text-[13px] font-semibold transition-colors',
                  on ? 'bg-volt text-volt-ink' : 'hairline bg-bg text-ink-muted',
                )}
              >
                {n}
              </button>
            )
          })}
        </div>
      )}
      {value?.type === 'weekly_count' && (
        <Stepper label={t('form.timesPerWeek')} value={value.n} onChange={(n) => onChange({ type: 'weekly_count', n: n ?? 1 })} step={1} min={1} max={7} unit={t('form.timesPerWeekUnit')} decLabel={t('form.dec')} incLabel={t('form.inc')} size="sm" />
      )}
      {value?.type === 'every' && (
        <Stepper label={t('form.everyN')} value={value.n} onChange={(n) => onChange({ type: 'every', n: n ?? 2 })} step={1} min={2} max={365} unit={t('form.everyNUnit')} decLabel={t('form.dec')} incLabel={t('form.inc')} size="sm" />
      )}
      {value?.type === 'monthly' && (
        <Stepper label={t('form.monthDay')} value={value.day} onChange={(n) => onChange({ type: 'monthly', day: n ?? 1 })} step={1} min={1} max={31} unit={t('form.monthDayUnit')} decLabel={t('form.dec')} incLabel={t('form.inc')} size="sm" />
      )}
    </div>
  )
}
