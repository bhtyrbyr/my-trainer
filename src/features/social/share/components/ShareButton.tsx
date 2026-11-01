import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Share } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { cn } from '@/lib/utils'
import { useSocialEnabled } from '../hooks'
import { prepareImage, renderCompare } from '../image'
import type { ComposerInitial, ShareSource } from '../types'
import { ComposerSheet } from './ComposerSheet'

type Props = {
  source: ShareSource
  /** "icon": a 44 pt round icon button for headers and rows; "button": a labelled secondary button */
  variant?: 'icon' | 'button'
  size?: 'md' | 'lg'
  className?: string
}

/**
 * Opens the composer pre-filled with a source. Social not enabled: goes to /social (consent, age gate).
 * Progress and compare first show the unencrypted-copy warning, then decrypt and downscale in memory.
 */
export function ShareButton({ source, variant = 'button', size = 'md', className }: Props) {
  const { t } = useTranslation('share')
  const navigate = useNavigate()
  const social = useSocialEnabled()
  const [warn, setWarn] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [initial, setInitial] = useState<ComposerInitial | null>(null)

  const start = () => {
    if (!social.enabled) return navigate('/social')
    if (source.kind === 'progress' || source.kind === 'compare') {
      setError(null)
      setWarn(true)
      return
    }
    setInitial(source)
  }

  const confirmPhoto = async () => {
    setWorking(true)
    setError(null)
    try {
      let image
      if (source.kind === 'progress') image = await prepareImage(await source.getImage())
      else if (source.kind === 'compare') {
        const [a, b] = await source.getImages()
        image = await renderCompare(a, b, source.labels)
      } else return
      setWarn(false)
      setInitial({ kind: source.kind, image })
    } catch (e) {
      setError(e)
    } finally {
      setWorking(false)
    }
  }

  const label = t('buttonLabel')
  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={start}
          disabled={social.loading}
          aria-label={label}
          className={cn('flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50', className)}
        >
          <Share className="size-5" aria-hidden />
        </button>
      ) : (
        <Button variant="secondary" size={size} onClick={start} disabled={social.loading} aria-label={label} className={className}>
          <Share className={size === 'lg' ? 'size-5' : 'size-4'} aria-hidden />
          {t('button')}
        </Button>
      )}

      <ConfirmSheet
        open={warn}
        title={source.kind === 'compare' ? t('warning.compareTitle') : t('warning.progressTitle')}
        body={
          <ul className="space-y-2">
            <li>{t('warning.copy')}</li>
            <li>{t('warning.who')}</li>
            <li>{t('warning.remove')}</li>
          </ul>
        }
        confirmLabel={t('warning.confirm')}
        pending={working}
        error={error}
        onCancel={() => setWarn(false)}
        onConfirm={() => void confirmPhoto()}
      />
      <ComposerSheet open={initial !== null} initial={initial ?? undefined} onClose={() => setInitial(null)} />
    </>
  )
}
