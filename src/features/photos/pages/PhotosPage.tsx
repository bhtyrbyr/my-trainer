import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Columns2, Loader2, Lock, Plus, Settings2 } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useAuth } from '@/features/auth/AuthProvider'
import { WrongSecretError } from '@/lib/crypto/vault'
import { AddPhotoSheet, CompareSheet, PhotoViewer, Timeline } from '../components/Gallery'
import { PasswordField, RecoveryReveal, UnlockScreen, VaultSetup } from '../components/VaultScreens'
import { useChangePassword, usePhotoList, useVault } from '../hooks'
import { lockVault, restoreSessionKey, useSessionKey } from '../keyStore'
import type { PhotoRow } from '../types'

/**
 * Progress photos. Point of view: a private darkroom. Nothing is visible until the album is unlocked
 * on this device; once open it is a quiet month-by-month contact sheet with a before/after viewer.
 */
export function PhotosPage() {
  const { t } = useTranslation('photos')
  const { user } = useAuth()
  const qc = useQueryClient()
  const vault = useVault()
  const key = useSessionKey(user?.id)
  const [restoring, setRestoring] = useState(true)
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const unlocked = Boolean(key) && !recoveryCode
  const photos = usePhotoList(unlocked)
  const [adding, setAdding] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [settings, setSettings] = useState(false)
  const [open, setOpen] = useState<PhotoRow | null>(null)

  useEffect(() => {
    if (!user) return
    void restoreSessionKey(user.id).finally(() => setRestoring(false))
  }, [user])

  const list = photos.data ?? []
  const canCompare = (['front', 'side', 'back', 'other'] as const).some((p) => list.filter((x) => x.pose === p).length >= 2)

  return (
    <PageShell
      title={t('title')}
      leading={
        <div className="flex items-center gap-1">
          <Link to="/track" aria-label={t('back')} className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="text-lg font-bold tracking-tight">{t('title')}</span>
        </div>
      }
      actions={
        unlocked ? (
          <>
            <Button variant="ghost" size="icon" aria-label={t('gallery.settings')} title={t('gallery.settings')} onClick={() => setSettings(true)}>
              <Settings2 className="size-5" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" aria-label={t('gallery.lock')} title={t('gallery.lock')} onClick={() => {
                if (!user) return
                // decrypted notes leave memory with the key
                qc.removeQueries({ queryKey: ['photos', 'meta'] })
                void lockVault(user.id)
              }}>
              <Lock className="size-5" aria-hidden />
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="mx-auto max-w-2xl pb-6">
        <ErrorNote error={vault.error} className="mb-4" />
        {vault.isLoading || restoring ? (
          <div className="flex h-40 items-center justify-center" aria-busy="true">
            <Loader2 className="size-6 animate-spin text-ink-faint" aria-hidden />
          </div>
        ) : recoveryCode ? (
          <RecoveryReveal code={recoveryCode} onDone={() => setRecoveryCode(null)} />
        ) : !vault.data ? (
          <VaultSetup onCreated={setRecoveryCode} />
        ) : !key ? (
          <UnlockScreen />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button size="lg" onClick={() => setAdding(true)}>
                <Plus className="size-5" aria-hidden />
                {t('gallery.add')}
              </Button>
              <Button size="lg" variant="secondary" disabled={!canCompare} onClick={() => setComparing(true)}>
                <Columns2 className="size-5" aria-hidden />
                {t('gallery.compare')}
              </Button>
            </div>
            <ErrorNote error={photos.error} />
            {photos.isLoading ? (
              <div className="grid grid-cols-3 gap-1.5" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="aspect-[3/4] animate-pulse rounded-[var(--radius-input)] bg-surface" />
                ))}
              </div>
            ) : list.length === 0 ? (
              <p className="hairline rounded-[var(--radius-card)] bg-surface px-4 py-6 text-[14px] text-ink-muted">{t('gallery.empty')}</p>
            ) : (
              <Timeline photos={list} cryptoKey={key} onOpen={setOpen} />
            )}
            <p className="text-center text-[12px] text-ink-faint">{t('gallery.points')}</p>
          </div>
        )}
      </div>

      {unlocked && key && adding && <AddPhotoSheet cryptoKey={key} onClose={() => setAdding(false)} />}
      {unlocked && key && open && <PhotoViewer photo={open} cryptoKey={key} onClose={() => setOpen(null)} />}
      {unlocked && key && comparing && <CompareSheet photos={list} cryptoKey={key} onClose={() => setComparing(false)} />}
      {unlocked && settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </PageShell>
  )
}

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('photos')
  const change = useChangePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center" role="presentation">
      <button type="button" aria-label={t('actions.cancel')} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t('settings.title')} className="rise-in hairline relative w-full max-w-md space-y-4 rounded-t-[var(--radius-sheet)] bg-surface px-5 pb-safe pt-6 lg:rounded-[var(--radius-sheet)]">
        <h2 className="display text-[24px]">{t('settings.change')}</h2>
        <PasswordField label={t('settings.current')} value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField label={t('settings.next')} value={next} onChange={setNext} autoComplete="new-password" />
        {next.length > 0 && next.length < 10 && <p className="text-[12px] text-danger">{t('setup.tooShort')}</p>}
        {change.error && (change.error instanceof WrongSecretError ? <p className="text-[13px] text-danger">{t('settings.wrong')}</p> : <ErrorNote error={change.error} />)}
        {change.isSuccess && <p className="text-[13px] font-semibold text-volt">{t('settings.done')}</p>}
        <div className="grid gap-2 pb-5">
          <Button size="lg" disabled={!current || next.length < 10 || change.isPending} onClick={() => change.mutate({ current, next })}>
            {change.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {t('settings.save')}
          </Button>
          <Button size="lg" variant="ghost" onClick={onClose}>
            {t('actions.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}
