import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWeightUnit } from '../hooks'
import { formatClock } from '../logic'
import type { FinishSummary } from '../schema'

type Props = {
  title: string
  summary: FinishSummary
  exerciseLabel: (exerciseId: string) => string
  onDone: () => void
  onHistory?: () => void
}

/**
 * Finish line. Points are the hero (volt, display size); duration / sets / volume sit beneath as a
 * three-figure scoreboard; new PRs are listed with a trophy. The celebration is the staggered rise and
 * the ambient glow, nothing more.
 */
export function SessionSummary({ title, summary, exerciseLabel, onDone, onHistory }: Props) {
  const { t } = useTranslation('workouts')
  const w = useWeightUnit()
  const stagger = (i: number) => ({ ['--i' as string]: i })

  return (
    <div className="bg-atmosphere flex min-h-dvh flex-col pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-4 pt-10">
        <p className="eyebrow rise-in text-volt">{t('summary.eyebrow')}</p>
        <h1 className="display rise-in mt-3 text-[30px]" style={stagger(1)}>
          {title}
        </h1>

        <div className="rise-in mt-10" style={stagger(2)}>
          <p className="display tabular text-[104px] leading-[0.9] tracking-[-0.05em] text-volt">+{summary.points_awarded}</p>
          <p className="mt-3 text-sm text-ink-muted">{summary.points_awarded > 0 ? t('summary.pointsLabel') : t('summary.noPoints')}</p>
        </div>

        <dl className="rise-in mt-10 grid grid-cols-3 border-y border-line" style={stagger(3)}>
          <Stat label={t('summary.duration')} value={formatClock(summary.duration_sec)} />
          <Stat label={t('summary.sets')} value={String(summary.total_sets)} border />
          <Stat label={t('summary.volume', { unit: w.unit })} value={w.formatTotal(summary.total_volume_kg)} border />
        </dl>

        {summary.new_prs.length > 0 && (
          <section className="mt-8" aria-labelledby="prs">
            <h2 id="prs" className="eyebrow rise-in flex items-center gap-2 text-ink" style={stagger(4)}>
              <Trophy className="size-4 text-volt" aria-hidden />
              {t('summary.prs', { count: summary.new_prs.length })}
            </h2>
            <ul className="mt-3 space-y-2">
              {summary.new_prs.map((pr, i) => (
                <li
                  key={pr.exercise_id}
                  className="rise-in hairline flex items-center justify-between gap-3 rounded-[var(--radius-input)] border-l-2 border-l-volt bg-surface px-4 py-3"
                  style={stagger(5 + i)}
                >
                  <span className="min-w-0 truncate text-[15px] font-semibold">{exerciseLabel(pr.exercise_id)}</span>
                  <span className="tabular shrink-0 text-right text-[13px] text-ink-muted">
                    {pr.weight_kg != null && pr.reps != null && (
                      <span className="font-semibold text-ink">
                        {w.format(pr.weight_kg)} {w.unit} × {pr.reps}
                      </span>
                    )}
                    <span className="block text-[11px] text-ink-faint">{t('summary.e1rm', { value: w.formatEstimate(pr.e1rm), unit: w.unit })}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-auto grid gap-2 pt-10">
          <Button size="lg" onClick={onDone}>
            {t('common.done')}
          </Button>
          {onHistory && (
            <Button size="lg" variant="ghost" onClick={onHistory}>
              {t('summary.viewDetail')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={border ? 'flex flex-col-reverse border-l border-line py-4 pl-4' : 'flex flex-col-reverse py-4 pr-2'}>
      <dt className="mt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">{label}</dt>
      <dd className="display tabular text-[30px] leading-none">{value}</dd>
    </div>
  )
}
