import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronRight, Download, FileText, HeartPulse, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { BottomSheet } from '@/features/nutrition/components/BottomSheet'
import { useAuth } from '@/features/auth/AuthProvider'
import { useConsents, useDeleteMyAccount, useExportMyData, useWithdrawAiConsent, useWithdrawHealthConsent } from '../hooks'
import { AiConsentCard } from './AiConsent'
import { HealthConsentScreen } from './Gates'
import { cn } from '@/lib/utils'

const row = 'hairline flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3.5 text-left transition-colors hover:bg-raised'

/** Settings > Privacy & data: notice, health consent, export (KVKK art. 11), account deletion. */
export function PrivacySection() {
  const { t } = useTranslation('legal')
  const { profile } = useAuth()
  const consents = useConsents()
  const exporter = useExportMyData()
  const [sheet, setSheet] = useState<'grant' | 'withdraw' | 'aiGrant' | 'aiWithdraw' | 'delete' | null>(null)
  const close = () => setSheet(null)

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t('settings.section')}</h2>

      <Link to="/privacy" className={row}>
        <FileText className="size-5 text-ink-muted" aria-hidden />
        <span className="flex-1 text-[15px]">{t('settings.notice')}</span>
        <ChevronRight className="size-4 text-ink-faint" aria-hidden />
      </Link>

      <button type="button" className={row} onClick={() => setSheet(consents.health ? 'withdraw' : 'grant')}>
        <HeartPulse className="size-5 text-ink-muted" aria-hidden />
        <span className="flex-1 text-[15px]">{t('settings.health')}</span>
        <span className={cn('text-[13px] font-medium', consents.health ? 'text-volt' : 'text-ink-faint')}>
          {consents.health ? t('settings.healthOn') : t('settings.healthOff')}
        </span>
        <ChevronRight className="size-4 text-ink-faint" aria-hidden />
      </button>

      <button type="button" className={row} onClick={() => setSheet(consents.ai ? 'aiWithdraw' : 'aiGrant')}>
        <Sparkles className="size-5 text-ink-muted" aria-hidden />
        <span className="flex-1 text-[15px]">{t('ai.setting')}</span>
        <span className={cn('text-[13px] font-medium', consents.ai ? 'text-volt' : 'text-ink-faint')}>
          {consents.ai ? t('settings.healthOn') : t('settings.healthOff')}
        </span>
        <ChevronRight className="size-4 text-ink-faint" aria-hidden />
      </button>

      <button type="button" className={row} disabled={exporter.isPending} onClick={() => exporter.mutate()}>
        {exporter.isPending ? <Loader2 className="size-5 animate-spin text-ink-muted" aria-hidden /> : <Download className="size-5 text-ink-muted" aria-hidden />}
        <span className="flex-1">
          <span className="block text-[15px]">{exporter.isPending ? t('settings.exporting') : t('settings.export')}</span>
          <span className="block text-[12px] leading-snug text-ink-faint">{t('settings.exportHint')}</span>
        </span>
      </button>
      <ErrorNote error={exporter.error} />

      <button type="button" className={cn(row, 'text-danger')} onClick={() => setSheet('delete')}>
        <Trash2 className="size-5" aria-hidden />
        <span className="flex-1 text-[15px] font-medium">{t('settings.delete')}</span>
      </button>

      <BottomSheet open={sheet === 'grant'} label={t('health.title')} closeLabel={t('notice.close')} onClose={close}>
        <GrantSheetBody onDone={close} granted={consents.health} />
      </BottomSheet>
      <BottomSheet open={sheet === 'withdraw'} label={t('settings.withdrawTitle')} closeLabel={t('notice.close')} onClose={close}>
        <WithdrawSheetBody onCancel={close} />
      </BottomSheet>
      <BottomSheet open={sheet === 'aiGrant'} label={t('ai.title')} closeLabel={t('notice.close')} onClose={close}>
        <div className="pb-5">
          <AiConsentCard onDone={close} />
        </div>
      </BottomSheet>
      <BottomSheet open={sheet === 'aiWithdraw'} label={t('ai.withdrawTitle')} closeLabel={t('notice.close')} onClose={close}>
        <AiWithdrawBody onCancel={close} />
      </BottomSheet>
      <BottomSheet open={sheet === 'delete'} label={t('settings.deleteTitle')} closeLabel={t('notice.close')} onClose={close}>
        <DeleteSheetBody username={profile?.username ?? ''} onCancel={close} />
      </BottomSheet>
    </section>
  )
}

function GrantSheetBody({ granted, onDone }: { granted: boolean; onDone: () => void }) {
  // the screen's own mutation flips consent; close once it is on
  useEffect(() => {
    if (granted) onDone()
  }, [granted, onDone])
  return (
    <div className="pb-5">
      <HealthConsentScreen onLater={onDone} />
    </div>
  )
}

function WithdrawSheetBody({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation('legal')
  const withdraw = useWithdrawHealthConsent()
  return (
    <div className="space-y-4 pb-5">
      <h2 className="text-[20px] font-semibold tracking-tight">{t('settings.withdrawTitle')}</h2>
      <p className="text-[14px] leading-relaxed text-ink-muted">{t('settings.withdrawBody')}</p>
      <ErrorNote error={withdraw.error} />
      <Button size="lg" variant="danger" className="w-full" disabled={withdraw.isPending} onClick={() => withdraw.mutate(undefined, { onSuccess: onCancel })}>
        {withdraw.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
        {withdraw.isPending ? t('settings.withdrawing') : t('settings.withdrawConfirm')}
      </Button>
      <Button size="lg" variant="ghost" className="w-full" onClick={onCancel}>
        {t('settings.cancel')}
      </Button>
    </div>
  )
}

function DeleteSheetBody({ username, onCancel }: { username: string; onCancel: () => void }) {
  const { t } = useTranslation('legal')
  const del = useDeleteMyAccount()
  const [typed, setTyped] = useState('')
  const ok = username.length > 0 && typed.trim().toLowerCase() === username.toLowerCase()
  return (
    <div className="space-y-4 pb-5">
      <h2 className="text-[20px] font-semibold tracking-tight">{t('settings.deleteTitle')}</h2>
      <p className="text-[14px] leading-relaxed text-ink-muted">{t('settings.deleteBody')}</p>
      <label className="block">
        <span className="mb-1.5 block text-[13px] text-ink-muted">{t('settings.deleteType', { username })}</span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          className="hairline h-12 w-full rounded-[var(--radius-input)] bg-bg px-3 text-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-danger"
        />
      </label>
      <ErrorNote error={del.error} />
      <Button size="lg" variant="danger" className="w-full" disabled={!ok || del.isPending} onClick={() => del.mutate()}>
        {del.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
        {del.isPending ? t('settings.deleting') : t('settings.deleteConfirm')}
      </Button>
      <Button size="lg" variant="ghost" className="w-full" onClick={onCancel}>
        {t('settings.cancel')}
      </Button>
    </div>
  )
}

function AiWithdrawBody({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation('legal')
  const withdraw = useWithdrawAiConsent()
  return (
    <div className="space-y-4 pb-5">
      <h2 className="text-[20px] font-semibold tracking-tight">{t('ai.withdrawTitle')}</h2>
      <p className="text-[14px] leading-relaxed text-ink-muted">{t('ai.withdrawBody')}</p>
      <ErrorNote error={withdraw.error} />
      <Button size="lg" variant="danger" className="w-full" disabled={withdraw.isPending} onClick={() => withdraw.mutate(undefined, { onSuccess: onCancel })}>
        {withdraw.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
        {t('ai.withdrawConfirm')}
      </Button>
      <Button size="lg" variant="ghost" className="w-full" onClick={onCancel}>
        {t('settings.cancel')}
      </Button>
    </div>
  )
}
