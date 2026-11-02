import { useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { cropViewBox, glyphBand, type BodyBand } from '../bodymap/crop'
import { useBodyFigures } from '../bodymap/load'
import { resolveBodyHighlight, type BodyHighlight } from '../bodymap/slugs'
import { SKIN_SLUGS, type BodyFigure, type BodyFigures, type BodySide } from '../bodymap/types'
import { useBodySex } from '../bodymap/useBodySex'
import { useVocab } from '../vocab'

/**
 * Colours of the flat figure, from theme tokens (index.css: --color-body-muscle / --color-body-skin, set
 * per theme): every muscle a neutral step off the page, non-muscle parts (head, hands, feet, knees, neck)
 * a quieter skin tone between page and muscle, target muscles volt, assisting muscles volt mixed into the
 * muscle tone. The gaps between shapes are a stroke in the colour of whatever the figure sits on (`gap`).
 */
const BODY_COLORS = {
  '--bm-muscle': 'var(--color-body-muscle)',
  '--bm-skin': 'var(--color-body-skin)',
  '--bm-target': 'var(--color-volt)',
  '--bm-secondary': 'color-mix(in oklch, var(--color-volt) 42%, var(--bm-muscle))',
} as CSSProperties

function figureStyle(gap: string, width: number): CSSProperties {
  return {
    ...BODY_COLORS,
    stroke: gap,
    strokeWidth: width,
    strokeLinejoin: 'round',
  } as CSSProperties
}

type Role = 'target' | 'secondary' | 'skin' | 'muscle'

function Figure({
  figure,
  highlight,
  gap,
  gapWidth,
  band = 'full',
  className,
}: {
  figure: BodyFigure
  highlight: BodyHighlight
  gap: string
  gapWidth: number
  band?: BodyBand
  className?: string
}) {
  const roles = useMemo(() => {
    const target = new Set<string>(highlight.target)
    const secondary = new Set<string>(highlight.secondary)
    return (slug: string): Role =>
      target.has(slug) ? 'target' : secondary.has(slug) ? 'secondary' : SKIN_SLUGS.has(slug) ? 'skin' : 'muscle'
  }, [highlight])
  return (
    <svg viewBox={cropViewBox(figure.viewBox, band)} aria-hidden focusable="false" className={className} style={figureStyle(gap, gapWidth)}>
      <path d={figure.outline} vectorEffect="non-scaling-stroke" style={{ fill: 'none', stroke: 'var(--color-line)' }} />
      {figure.parts.map((p) => (
        <g key={p.slug} style={{ fill: `var(--bm-${roles(p.slug)})` }}>
          {p.d.map((d, i) => (
            <path key={i} d={d} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      ))}
    </svg>
  )
}

/** Number of highlighted shapes on one side (target counts double): picks the side a single glyph shows. */
function weight(figure: BodyFigure, h: BodyHighlight): number {
  const t = new Set<string>(h.target)
  const s = new Set<string>(h.secondary)
  return figure.parts.reduce((n, p) => n + (t.has(p.slug) ? 2 : s.has(p.slug) ? 1 : 0), 0)
}

function useFigures() {
  const { sex, pending } = useBodySex()
  const figures = useBodyFigures(sex)
  return { figures: pending ? undefined : figures.data, failed: Boolean(figures.error) }
}

type Props = { target: string[]; secondary: string[]; className?: string }

/**
 * "What it works": front and back figures (the user's own body type) straight on the page, the worked
 * muscles in volt; below, flat legend rows (target, assisting, and names with no shape on the figure).
 */
export function BodyMap({ target, secondary, className }: Props) {
  const { t } = useTranslation('exercises')
  const vocab = useVocab()
  const { figures, failed } = useFigures()
  const highlight = useMemo(() => resolveBodyHighlight(target, secondary), [target, secondary])

  const mappedTarget = target.filter((n) => !highlight.unmapped.includes(n))
  const mappedSecondary = secondary.filter((n) => !highlight.unmapped.includes(n) && !mappedTarget.includes(n))
  const label = t('detail.muscles.diagramLabel', { muscles: [...target, ...secondary].map(vocab.muscle).join(', ') })
  const showFigures = !failed && (highlight.target.length > 0 || highlight.secondary.length > 0)

  return (
    <div className={className} style={BODY_COLORS}>
      {showFigures && (
        <div role="img" aria-label={label} className="grid grid-cols-2 gap-4 pb-5 pt-1">
          {(['front', 'back'] as BodySide[]).map((side) => (
            <figure key={side} className="flex flex-col items-center">
              <div className="flex h-[min(76vw,300px)] w-full items-center justify-center">
                {figures ? (
                  <Figure figure={figures[side]} highlight={highlight} gap="var(--color-bg)" gapWidth={1.2} className="size-full" />
                ) : (
                  <span aria-hidden className="h-[94%] w-[46%] animate-pulse rounded-[40%_40%_18%_18%] bg-raised/60 motion-reduce:animate-none" />
                )}
              </div>
              <figcaption className="eyebrow mt-3">{t(side === 'front' ? 'detail.muscles.front' : 'detail.muscles.back')}</figcaption>
            </figure>
          ))}
        </div>
      )}

      <dl className="-mx-4 divide-y divide-line border-y border-line text-sm lg:mx-0">
        {mappedTarget.length > 0 && <Legend swatch="bg-volt" term={t('detail.muscles.target')} names={mappedTarget.map(vocab.muscle)} />}
        {mappedSecondary.length > 0 && (
          <Legend swatch="bg-(--bm-secondary)" term={t('detail.muscles.secondary')} names={mappedSecondary.map(vocab.muscle)} />
        )}
        {highlight.unmapped.length > 0 && (
          <Legend swatch="hairline bg-transparent" term={t('detail.muscles.unmapped')} names={highlight.unmapped.map(vocab.muscle)} />
        )}
      </dl>
    </div>
  )
}

function Legend({ swatch, term, names }: { swatch: string; term: string; names: string[] }) {
  return (
    <div className="flex items-baseline gap-3 px-4 py-3 lg:px-0">
      <dt className="flex w-[44%] shrink-0 items-baseline gap-2.5 text-ink-faint">
        <span aria-hidden className={cn('size-2.5 shrink-0 translate-y-[1px] rounded-full', swatch)} />
        {term}
      </dt>
      <dd className="min-w-0 flex-1 text-ink">{names.join(', ')}</dd>
    </div>
  )
}

/**
 * The figure without legend: the stand-in picture when an exercise has neither GIF nor frames.
 * `auto` (thumbnails) shows the side most of the worked muscles are on (front on a tie), cropped to the
 * upper or lower half when all of them sit there, so the figure is large enough to read at 44-56 px;
 * `both` puts the whole front and back side by side. `gap` is the colour of the plate it sits on.
 */
export function BodyGlyph({
  target,
  secondary,
  sides = 'auto',
  gap = 'var(--color-bg)',
  className,
}: {
  target: string[]
  secondary: string[]
  sides?: 'auto' | 'both'
  gap?: string
  className?: string
}) {
  const { figures } = useFigures()
  const highlight = useMemo(() => resolveBodyHighlight(target, secondary), [target, secondary])
  const shown = useMemo(() => pickSides(figures, highlight, sides), [figures, highlight, sides])
  const band = sides === 'both' ? 'full' : glyphBand(highlight.target, highlight.secondary)
  return (
    // a cropped half bleeds off the plate at the cut (upper: bottom edge, lower: top edge)
    <span
      aria-hidden
      className={cn(
        'flex h-full w-full justify-center gap-[4%]',
        band === 'upper' ? 'items-end' : band === 'lower' ? 'items-start' : 'items-center',
        className,
      )}
    >
      {figures ? (
        shown.map((side) => (
          <Figure
            key={side}
            figure={figures[side]}
            highlight={highlight}
            gap={gap}
            gapWidth={sides === 'both' ? 0.8 : 0.7}
            band={band}
            className={cn('w-auto', sides === 'both' ? 'h-full max-w-[50%]' : band === 'full' ? 'h-[88%]' : 'h-[90%]')}
          />
        ))
      ) : (
        <span className="h-[88%] w-[30%] self-center animate-pulse rounded-[40%_40%_18%_18%] bg-raised/60 motion-reduce:animate-none" />
      )}
    </span>
  )
}

function pickSides(figures: BodyFigures | undefined, h: BodyHighlight, sides: 'auto' | 'both'): BodySide[] {
  if (sides === 'both') return ['front', 'back']
  if (!figures) return ['front']
  return weight(figures.back, h) > weight(figures.front, h) ? ['back'] : ['front']
}
