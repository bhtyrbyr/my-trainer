import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useMutationState, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { AlertCircle, CloudOff, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'
import { useSyncState, type SyncState } from './hooks'
import { discardQueued, failedQueued, isQueuedMutation, retryQueued } from './queue'

// One sheet for the whole app, opened from the floating chip or from a screen's inline status.
let sheetOpen = false
const sheetListeners = new Set<() => void>()
function setSheet(open: boolean) {
  sheetOpen = open
  sheetListeners.forEach((l) => l())
}
const subscribeSheet = (cb: () => void) => {
  sheetListeners.add(cb)
  return () => void sheetListeners.delete(cb)
}
const useSheetOpen = () => useSyncExternalStore(subscribeSheet, () => sheetOpen, () => false)

/** Writes that settle within a moment never flash a "syncing" chip: show it only when the queue lingers. */
function useLingering(active: boolean, ms = 1500): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!active) return
    const id = window.setTimeout(() => setShown(true), ms)
    return () => {
      window.clearTimeout(id)
      setShown(false)
    }
  }, [active, ms])
  return active && shown
}

type Tone = 'offline' | 'syncing' | 'weak' | 'failed'

function toneOf(s: SyncState, lingering: boolean): Tone | null {
  if (s.failed > 0) return 'failed'
  if (!s.online) return 'offline'
  if (s.pending > 0 && s.struggling) return 'weak'
  if (lingering) return 'syncing'
  return null
}

/**
 * Floating sync chip, docked above the tab bar. Silent while online and in sync; appears when the device
 * is offline, when queued writes linger, or when the server rejected one (then it opens the review
 * sheet). Full-screen layers (the live session) cover it and show `SyncInline` in their own header.
 */
export function OfflineChip() {
  const { t } = useTranslation('offline')
  const s = useSyncState()
  const lingering = useLingering(s.online && s.pending > 0)
  const tone = toneOf(s, lingering)

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-h)+var(--sab)+1.5rem)] z-40 flex justify-center px-4 lg:bottom-4 lg:justify-end"
    >
      {tone && (
        <button
          type="button"
          onClick={() => setSheet(true)}
          aria-label={`${chipText(t, tone, s)}. ${t('chip.open')}`}
          className={cn(
            'rise-in pointer-events-auto flex h-11 max-w-full items-center gap-2 rounded-full bg-raised/90 pl-3.5 pr-4 text-[13px] font-medium backdrop-blur',
            'transition-colors hover:bg-raised',
            tone === 'failed' ? 'border border-danger/40 text-ink' : 'hairline text-ink',
          )}
        >
          <ToneIcon tone={tone} />
          <span className="tabular truncate">{chipText(t, tone, s)}</span>
        </button>
      )}
    </div>
  )
}

function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  if (tone === 'failed') return <AlertCircle className={cn('size-4 shrink-0 text-danger', className)} aria-hidden />
  if (tone === 'syncing') return <Loader2 className={cn('size-4 shrink-0 animate-spin text-volt', className)} aria-hidden />
  return <CloudOff className={cn('size-4 shrink-0 text-ink-muted', className)} aria-hidden />
}

function chipText(t: TFunction, tone: Tone, s: SyncState): string {
  if (tone === 'failed') return t('chip.failed', { count: s.failed })
  if (tone === 'offline') return s.pending ? t('chip.offlinePending', { count: s.pending }) : t('chip.offline')
  if (tone === 'weak') return t('chip.weak', { count: s.pending })
  return t('chip.syncing', { count: s.pending })
}

/** Compact status for screens that hide the tab bar (live session header). Renders nothing when in sync. */
export function SyncInline({ className }: { className?: string }) {
  const { t } = useTranslation('offline')
  const s = useSyncState()
  if (s.online && !s.pending && !s.failed) return null
  const text = s.failed ? t('inline.failed', { count: s.failed }) : !s.online ? t('inline.offline') : t('inline.waiting', { count: s.pending })
  const extra = !s.failed && !s.online && s.pending ? ` · ${t('inline.waiting', { count: s.pending })}` : ''
  return (
    <button
      type="button"
      onClick={() => setSheet(true)}
      className={cn('tabular inline-flex items-center gap-1 rounded-full hover:text-ink', s.failed ? 'text-danger' : 'text-ink-muted', className)}
    >
      {s.failed ? <AlertCircle className="size-3" aria-hidden /> : <CloudOff className="size-3" aria-hidden />}
      {text}
      {extra}
    </button>
  )
}

type Row = { id: number; op: string; at: string | null; status: 'pending' | 'error'; error: unknown }

/** Review sheet: what is waiting, what failed (with the usual error note and report button), retry / discard. */
export function SyncSheet() {
  const { t } = useTranslation('offline')
  const qc = useQueryClient()
  const open = useSheetOpen()
  const s = useSyncState()
  const [confirming, setConfirming] = useState<number | null>(null)
  const rows = useMutationState({
    filters: { predicate: (m) => isQueuedMutation(m) && (m.state.status === 'pending' || m.state.status === 'error') },
    select: (m): Row => ({
      id: m.mutationId,
      op: String(m.options.mutationKey?.[2] ?? 'unknown'),
      at: (m.state.variables as { at?: string } | undefined)?.at ?? null,
      status: m.state.status as Row['status'],
      error: m.state.error,
    }),
  })
  const waiting = new Map<string, number>()
  for (const r of rows) if (r.status === 'pending') waiting.set(r.op, (waiting.get(r.op) ?? 0) + 1)
  const failed = rows.filter((r) => r.status === 'error')

  const close = () => {
    setConfirming(null)
    setSheet(false)
  }
  const find = (id: number) => failedQueued(qc).find((m) => m.mutationId === id)
  const retry = (id: number) => {
    const m = find(id)
    if (m) retryQueued(qc, m)
  }
  const retryAll = () => failedQueued(qc).forEach((m) => retryQueued(qc, m))
  const discard = (id: number) => {
    if (confirming !== id) return setConfirming(id)
    const m = find(id)
    if (m) discardQueued(qc, m)
    setConfirming(null)
  }
  const opLabel = (op: string) => t(`op.${op}`, { defaultValue: t('op.unknown') })
  const title = failed.length ? t('sheet.titleFailed') : !s.online ? t('sheet.titleOffline') : s.pending ? t('sheet.titleSyncing') : t('sheet.titleIdle')

  return (
    <Sheet open={open} label={t('sheet.label')} closeLabel={t('sheet.close')} onClose={close}>
      <p className="eyebrow">{s.online ? t('sheet.eyebrowOnline') : t('sheet.eyebrowOffline')}</p>
      <h2 className="display mt-2 text-[26px] leading-tight">{title}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{t('sheet.body')}</p>

      {waiting.size > 0 && (
        <section className="mt-6" aria-labelledby="sync-waiting">
          <h3 id="sync-waiting" className="eyebrow flex items-center gap-2">
            {s.online && <Loader2 className="size-3.5 animate-spin text-volt" aria-hidden />}
            {t('sheet.waiting')}
          </h3>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {[...waiting].map(([op, n]) => (
              <li key={op} className="flex h-11 items-center justify-between text-[15px]">
                <span>{t(`ops.${op}`, { defaultValue: t('ops.unknown') })}</span>
                <span className="tabular font-semibold text-ink-muted">{n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {failed.length > 0 && (
        <section className="mt-6" aria-labelledby="sync-failed">
          <h3 id="sync-failed" className="eyebrow text-danger">
            {t('sheet.failed')}
          </h3>
          <ul className="mt-2 space-y-3">
            {failed.map((r) => (
              <li key={r.id} className="hairline rounded-[var(--radius-input)] bg-bg/60 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-semibold">{opLabel(r.op)}</span>
                  {r.at && <span className="tabular text-[12px] text-ink-faint">{format(new Date(r.at), 'HH:mm')}</span>}
                </div>
                <ErrorNote error={r.error} className="mt-2" />
                <div className="mt-2 flex justify-end gap-1">
                  <Button variant="ghost" size="md" className={cn(confirming === r.id && 'text-danger hover:text-danger')} onClick={() => discard(r.id)}>
                    {confirming === r.id ? t('sheet.discardConfirm') : t('sheet.discard')}
                  </Button>
                  <Button variant="secondary" size="md" onClick={() => retry(r.id)}>
                    <RotateCcw className="size-4" aria-hidden />
                    {t('sheet.retry')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 grid gap-2 pb-5">
        {failed.length > 1 && (
          <Button size="lg" onClick={retryAll}>
            <RotateCcw className="size-5" aria-hidden />
            {t('sheet.retryAll')}
          </Button>
        )}
        <Button size="lg" variant={failed.length > 1 ? 'ghost' : 'secondary'} onClick={close}>
          {t('sheet.done')}
        </Button>
      </div>
    </Sheet>
  )
}
