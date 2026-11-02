import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { Dumbbell, SearchX } from 'lucide-react'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { ExerciseMediaAdminAction } from '@/features/admin/components/ExerciseMediaAdminAction'
import { cn } from '@/lib/utils'
import { useExercise } from '../hooks'
import { exerciseCredits, type Credit, type ExerciseMedia } from '../media'
import { exerciseName, exerciseSteps } from '../name'
import type { Exercise } from '../types'
import { useExerciseMedia } from '../useExerciseMedia'
import { useVocab } from '../vocab'
import { BackButton } from '../components/BackButton'
import { BodyMap } from '../components/BodyMap'
import { ExerciseGif } from '../components/ExerciseGif'
import { Flipbook } from '../components/Flipbook'
import { ExerciseProgress } from '../components/ExerciseProgress'

/**
 * Point of view: a coach's card. The movement (ExerciseDB animation on a light plate, else the illustration
 * flipbook on a quiet plate) and a large display name lead; without either the name leads and the body
 * map right under it is the picture.
 * The user's own numbers follow; one faint credit line closes the page. Mobile is one column;
 * desktop puts progress in a second column next to the how-to.
 */
export function ExerciseDetailPage() {
  const { id } = useParams()
  const { t, i18n } = useTranslation('exercises')
  const query = useExercise(id)
  const ex = query.data
  const { media, onGifError } = useExerciseMedia(ex)

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <div className="flex-1 px-4 pb-8 pt-2">
        <div className="-ml-2 mb-1">
          <BackButton fallback="/exercises" label={t('detail.back')} />
        </div>

        <ErrorNote error={query.error} className="mb-4" />

        {query.isLoading ? (
          <DetailSkeleton />
        ) : ex ? (
          <div className="flex flex-col gap-9 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-10">
            <Hero ex={ex} media={media} onGifError={onGifError} className="lg:col-start-1 lg:row-start-1" />

            <section aria-labelledby="muscles-title" className="lg:col-start-1 lg:row-start-2">
              <h2 id="muscles-title" className="display mb-3 text-[22px]">
                {t('detail.muscles.title')}
              </h2>
              <BodyMap target={ex.target_muscles} secondary={ex.secondary_muscles} />
            </section>

            <div className="lg:col-start-2 lg:row-span-3 lg:row-start-1">
              <ExerciseProgress exerciseId={ex.id} />
            </div>

            <div className="lg:col-start-1 lg:row-start-3">
              <Steps steps={exerciseSteps(ex, i18n.resolvedLanguage)} />
              {/* attribution.media credits the illustration frames; they are not shown while the GIF is */}
              <Credits
                credits={exerciseCredits(ex.attribution, i18n.resolvedLanguage).filter((c) => media.kind !== 'gif' || c.role !== 'media')}
              />
            </div>
          </div>
        ) : (
          !query.error && <NotFound />
        )}
      </div>
    </div>
  )
}

function Hero({ ex, media, onGifError, className }: { ex: Exercise; media: ExerciseMedia; onGifError: () => void; className?: string }) {
  const { t } = useTranslation('exercises')
  const vocab = useVocab()
  const name = exerciseName(ex)
  return (
    <header className={cn('rise-in', className)}>
      {media.kind === 'gif' && (
        <figure className="mb-6">
          {/* 180 px source GIFs: shown at most ~1.4x so the drawing stays crisp; the plate carries the width */}
          <div className="isolate flex h-[268px] items-center justify-center overflow-hidden rounded-[var(--radius-card)] bg-plate">
            <ExerciseGif url={media.url} label={t('detail.gifLabel', { name })} onError={onGifError} className="h-[252px]" />
          </div>
          <figcaption className="mt-2 flex items-center justify-between gap-3 text-[12px] text-ink-faint">
            {t('detail.credit.gif')}
            {/* admins only: fix a wrong match (renders nothing for everyone else) */}
            <ExerciseMediaAdminAction exercise={ex} className="-my-3 -mr-2" />
          </figcaption>
        </figure>
      )}
      {media.kind === 'frames' && (
        <div className="mb-6">
          <div className="hairline flex h-[280px] items-center justify-center overflow-hidden rounded-[var(--radius-card)] bg-surface">
            <Flipbook paths={media.paths} label={t('detail.mediaLabel', { name })} className="aspect-square h-[88%]" />
          </div>
          <div className="mt-2 flex justify-end empty:hidden">
            <ExerciseMediaAdminAction exercise={ex} className="-my-3 -mr-2" />
          </div>
        </div>
      )}

      {ex.body_parts.length > 0 && <p className="eyebrow">{ex.body_parts.map(vocab.bodyPart).join(' · ')}</p>}
      <h1 className="display mt-2 text-[32px] lg:text-[40px]">{name}</h1>

      <ul className="mt-4 flex flex-wrap gap-2">
        {ex.target_muscles.map((m) => (
          <Tag key={`t-${m}`} kind="target" label={t('detail.target')}>
            {vocab.muscle(m)}
          </Tag>
        ))}
        {ex.secondary_muscles.map((m) => (
          <Tag key={`s-${m}`} kind="secondary" label={t('detail.secondary')}>
            {vocab.muscle(m)}
          </Tag>
        ))}
        {ex.equipment.map((e) => (
          <Tag key={`e-${e}`} kind="equipment" label={t('detail.equipment')}>
            {vocab.equipment(e)}
          </Tag>
        ))}
      </ul>
      {media.kind === 'none' && (
        <div className="mt-3 empty:hidden">
          <ExerciseMediaAdminAction exercise={ex} className="-ml-2" />
        </div>
      )}
    </header>
  )
}


/** "Text: wger contributors, CC BY-SA 4.0 · Illustration: Bryl Lim / Everkinetic, CC BY-SA 4.0 · Turkish: machine translation" */
function Credits({ credits }: { credits: Credit[] }) {
  const { t } = useTranslation('exercises')
  if (!credits.length) return null
  return (
    <p className="mt-8 max-w-[60ch] border-t border-line pt-4 text-[12px] leading-relaxed text-ink-faint">
      <span className="sr-only">{t('detail.credit.label')}: </span>
      {credits.map((c, i) => (
        <span key={c.role}>
          {i > 0 && <span aria-hidden> · </span>}
          {c.role === 'translation' ? (
            t('detail.credit.translation')
          ) : (
            <>
              {t(c.role === 'text' ? 'detail.credit.text' : 'detail.credit.media')}:{' '}
              <CreditWho credit={c} />
            </>
          )}
        </span>
      ))}
    </p>
  )
}

function CreditWho({ credit }: { credit: Extract<Credit, { role: 'text' | 'media' }> }) {
  const who = [credit.author, credit.license].filter(Boolean).join(', ')
  if (!credit.url) return <>{who}</>
  return (
    <a
      href={credit.url}
      target="_blank"
      rel="noreferrer noopener"
      className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink-muted"
    >
      {who}
    </a>
  )
}

function Tag({ kind, label, children }: { kind: 'target' | 'secondary' | 'equipment'; label: string; children: React.ReactNode }) {
  return (
    <li
      title={label}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium',
        kind === 'target' && 'border-volt/35 bg-volt/12 text-volt',
        kind === 'secondary' && 'border-line text-ink-muted',
        kind === 'equipment' && 'border-transparent bg-raised text-ink-muted',
      )}
    >
      {kind === 'equipment' && <Dumbbell className="size-3.5" aria-hidden />}
      <span className="sr-only">{label}: </span>
      {children}
    </li>
  )
}

function Steps({ steps }: { steps: string[] }) {
  const { t } = useTranslation('exercises')
  return (
    <section aria-labelledby="steps-title">
      <h2 id="steps-title" className="display mb-4 text-[22px]">
        {t('detail.steps.title')}
      </h2>
      {steps.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('detail.steps.empty')}</p>
      ) : (
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-4">
              <span aria-hidden className="display tabular w-6 shrink-0 pt-px text-right text-[17px] leading-6 text-ink-faint">
                {i + 1}
              </span>
              <p className="max-w-[60ch] text-[15px] leading-6 text-ink-muted">{s}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function NotFound() {
  const { t } = useTranslation('exercises')
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-raised text-ink-muted">
        <SearchX className="size-6" aria-hidden />
      </span>
      <h1 className="text-[17px] font-semibold">{t('detail.notFound.title')}</h1>
      <p className="max-w-[30ch] text-sm text-ink-muted">{t('detail.notFound.body')}</p>
      <Link
        to="/exercises"
        className="hairline mt-2 inline-flex h-11 items-center rounded-[var(--radius-button)] bg-raised px-4 text-[15px] font-semibold text-ink hover:bg-raised/70"
      >
        {t('detail.notFound.cta')}
      </Link>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div aria-hidden className="space-y-5">
      <div className="h-[280px] animate-pulse rounded-[var(--radius-card)] bg-surface" />
      <div className="h-3 w-24 animate-pulse rounded bg-raised" />
      <div className="h-8 w-3/4 animate-pulse rounded bg-raised" />
      <div className="flex gap-2">
        <div className="h-8 w-20 animate-pulse rounded-full bg-raised" />
        <div className="h-8 w-24 animate-pulse rounded-full bg-raised" />
      </div>
    </div>
  )
}
