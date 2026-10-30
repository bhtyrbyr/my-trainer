import { useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useMediaUrls, useMuscleCatalog } from '../hooks'
import { muscleMapPaths, resolveMuscleMap, SILHOUETTE_BACK, SILHOUETTE_FRONT, type Muscle } from '../muscles'
import { useVocab } from '../vocab'

type Props = { target: string[]; secondary: string[]; className?: string }

/**
 * "What it works": wger front and back silhouettes side by side. The wger overlays are used as CSS
 * masks so the muscles paint in the app's own volt (target full, assisting muscles faint) instead of
 * wger's red/orange. Names without a wger overlay are listed as text under the figures.
 */
export function MuscleMap({ target, secondary, className }: Props) {
  const { t } = useTranslation('exercises')
  const vocab = useVocab()
  const catalog = useMuscleCatalog()
  const map = useMemo(() => resolveMuscleMap(target, secondary, catalog.data), [target, secondary, catalog.data])
  const paths = useMemo(() => (catalog.data ? muscleMapPaths(map) : []), [catalog.data, map])
  const urls = useMediaUrls(paths)
  const u = urls.data

  const mappedTarget = target.filter((n) => !map.unmapped.includes(n))
  const mappedSecondary = secondary.filter((n) => !map.unmapped.includes(n) && !mappedTarget.includes(n))
  const label = t('detail.muscles.diagramLabel', { muscles: [...target, ...secondary].map(vocab.muscle).join(', ') })
  const ready = Boolean(u[SILHOUETTE_FRONT] || u[SILHOUETTE_BACK])
  const failed = Boolean(catalog.error || urls.error)

  return (
    <div className={cn('hairline overflow-hidden rounded-[var(--radius-card)] bg-surface', className)}>
      {!failed && (
        <div role="img" aria-label={label} className="relative grid grid-cols-2 gap-2 px-6 pb-3 pt-5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-2/3"
            style={{ background: 'radial-gradient(60% 55% at 50% 30%, color-mix(in oklch, var(--color-volt) 7%, transparent), transparent 75%)' }}
          />
          <Figure side="front" caption={t('detail.muscles.front')} silhouette={u[SILHOUETTE_FRONT]} muscles={map} urls={u} ready={ready} />
          <Figure side="back" caption={t('detail.muscles.back')} silhouette={u[SILHOUETTE_BACK]} muscles={map} urls={u} ready={ready} />
        </div>
      )}

      <dl className={cn('space-y-2.5 px-5 pb-5 text-sm', failed ? 'pt-5' : 'border-t border-line pt-4')}>
        {mappedTarget.length > 0 && (
          <Legend swatch="bg-volt" term={t('detail.muscles.target')} names={mappedTarget.map(vocab.muscle)} />
        )}
        {mappedSecondary.length > 0 && (
          <Legend swatch="bg-volt/45" term={t('detail.muscles.secondary')} names={mappedSecondary.map(vocab.muscle)} />
        )}
        {map.unmapped.length > 0 && (
          <Legend swatch="hairline bg-transparent" term={t('detail.muscles.unmapped')} names={map.unmapped.map(vocab.muscle)} />
        )}
      </dl>
    </div>
  )
}

function Figure({
  side,
  caption,
  silhouette,
  muscles,
  urls,
  ready,
}: {
  side: 'front' | 'back'
  caption: string
  silhouette: string | undefined
  muscles: { main: Muscle[]; secondary: Muscle[] }
  urls: Record<string, string>
  ready: boolean
}) {
  const isFront = side === 'front'
  const main = muscles.main.filter((m) => m.is_front === isFront)
  const secondary = muscles.secondary.filter((m) => m.is_front === isFront)
  return (
    <figure className="relative flex flex-col items-center">
      {/* wger silhouettes are 200 x 369; overlays share the origin and scale, so width-fit keeps them aligned */}
      <div className="relative aspect-[200/369] w-full max-w-[150px]">
        {ready && silhouette ? (
          <>
            <img src={silhouette} alt="" className="absolute inset-x-0 top-0 w-full opacity-45 grayscale" draggable={false} />
            {secondary.map((m) => (
              <Overlay key={`s${m.wger_id}`} url={m.svg_secondary_path ? urls[m.svg_secondary_path] : undefined} className="bg-volt/75" />
            ))}
            {main.map((m) => (
              <Overlay key={`m${m.wger_id}`} url={m.svg_main_path ? urls[m.svg_main_path] : undefined} className="bg-volt" strong />
            ))}
          </>
        ) : (
          <div className="absolute inset-0 animate-pulse rounded-[40%_40%_20%_20%] bg-raised/60" />
        )}
      </div>
      <figcaption className="eyebrow mt-3">{caption}</figcaption>
    </figure>
  )
}

/**
 * The muscle figure without legend or card: the stand-in illustration when an exercise has no frames.
 * `auto` shows the side its target muscles are on (front when nothing maps), `both` puts front and back side by side.
 */
export function MuscleGlyph({
  target,
  secondary,
  sides = 'auto',
  className,
}: {
  target: string[]
  secondary: string[]
  sides?: 'auto' | 'both'
  className?: string
}) {
  const catalog = useMuscleCatalog()
  const map = useMemo(() => resolveMuscleMap(target, secondary, catalog.data), [target, secondary, catalog.data])
  const paths = useMemo(() => (catalog.data ? muscleMapPaths(map) : []), [catalog.data, map])
  const { data: u } = useMediaUrls(paths)
  const lead = map.main.length ? map.main : map.secondary
  const showFront = lead.length === 0 || lead.some((m) => m.is_front)
  const shown: ('front' | 'back')[] = sides === 'both' ? ['front', 'back'] : [showFront ? 'front' : 'back']
  return (
    <span aria-hidden className={cn('flex h-full items-center justify-center gap-[6%]', className)}>
      {shown.map((side) => {
        const silhouette = u[side === 'front' ? SILHOUETTE_FRONT : SILHOUETTE_BACK]
        const isFront = side === 'front'
        return (
          <span key={side} className="relative block aspect-[200/369] h-full">
            {silhouette ? (
              <>
                <img src={silhouette} alt="" className="absolute inset-x-0 top-0 w-full opacity-45 grayscale" draggable={false} />
                {map.secondary
                  .filter((m) => m.is_front === isFront)
                  .map((m) => (
                    <Overlay key={`s${m.wger_id}`} url={m.svg_secondary_path ? u[m.svg_secondary_path] : undefined} className="bg-volt/75" />
                  ))}
                {map.main
                  .filter((m) => m.is_front === isFront)
                  .map((m) => (
                    <Overlay key={`m${m.wger_id}`} url={m.svg_main_path ? u[m.svg_main_path] : undefined} className="bg-volt" strong />
                  ))}
              </>
            ) : (
              <span className="absolute inset-0 animate-pulse rounded-[40%_40%_20%_20%] bg-raised/60" />
            )}
          </span>
        )
      })}
    </span>
  )
}

/** A coloured layer cut out by the wger overlay SVG. wger paints overlays at ~50% alpha; "strong" doubles the layer. */
function Overlay({ url, className, strong }: { url: string | undefined; className: string; strong?: boolean }) {
  if (!url) return null
  const style: CSSProperties = {
    maskImage: `url("${url}")`,
    WebkitMaskImage: `url("${url}")`,
    maskSize: '100% auto',
    WebkitMaskSize: '100% auto',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'top left',
    WebkitMaskPosition: 'top left',
  }
  return (
    <>
      <span aria-hidden className={cn('absolute inset-0', className)} style={style} />
      {strong && <span aria-hidden className={cn('absolute inset-0', className)} style={style} />}
    </>
  )
}

function Legend({ swatch, term, names }: { swatch: string; term: string; names: string[] }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="flex w-[44%] shrink-0 items-baseline gap-2.5 text-ink-faint">
        <span aria-hidden className={cn('size-2.5 shrink-0 translate-y-[1px] rounded-full', swatch)} />
        {term}
      </dt>
      <dd className="min-w-0 flex-1 text-ink">{names.join(', ')}</dd>
    </div>
  )
}
