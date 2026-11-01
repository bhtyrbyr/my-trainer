import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileText, HeartPulse, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow } from '@/components/ui/GroupedList'
import { BottomSheet } from '@/features/nutrition/components/BottomSheet'
import { useAuth } from '@/features/auth/AuthProvider'
import { useConsents, useDeleteMyAccount, useExportMyData, useWithdrawAiConsent, useWithdrawHealthConsent } from '../hooks'
import { AiConsentCard } from './AiConsent'
import { HealthConsentScreen } from './Gates'
import { cn } from '@/lib/utils'

/**
 * Settings > Privacy & data: optional leading rows (leaderboard visibility), the notice, health and AI
 * consent, export (KVKK art. 11). Account deletion lives in the Account group (DeleteAccountSheet).
 */
export function PrivacySection({ leading }: { leading?: ReactNode }) {
  const { t } = useTranslation('legal')
  const consents = useConsents()
  const exporter = useExportMyData()
  const [sheet, setSheet] = useState<'grant' | 'withdraw' | 'aiGrant' | 'aiWithdraw' | null>(null)
  const close = () => setSheet(null)
  const onOff = (on: boolean) => (
    <span className={cn('text-[15px]', on ? 'text-volt' : 'text-ink-muted')}>{on ? t('settings.healthOn') : t('settings.healthOff')}</span>
  )

  return (
    <>
      <GroupedList title={t('settings.section')}>
        {leading}
        <ListRow icon={FileText} label={t('settings.notice')} to="/privacy" />
        <ListRow icon={HeartPulse} label={t('settings.health')} value={onOff(consents.health)} onClick={() => setSheet(consents.health ? 'withdraw' : 'grant')} />
        <ListRow icon={Sparkles} label={t('ai.setting')} value={onOff(consents.ai)} onClick={() => setSheet(consents.ai ? 'aiWithdraw' : 'aiGrant')} />
        <ListRow
          icon={exporter.isPending ? Spinner : Download}
          label={exporter.isPending ? t('settings.exporting') : t('settings.export')}
          hint={t('settings.exportHint')}
          disabled={exporter.isPending}
          chevron={false}
          onClick={() => exporter.mutate()}
        />
      </GroupedList>
      <ErrorNote error={exporter.error} />

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
    </>
  )
}

function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn(className, 'animate-spin')} aria-hidden />
}

/** Account deletion (KVKK): typed-username confirmation in a bottom sheet. */
export function DeleteAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('legal')
  const { profile } = useAuth()
  return (
    <BottomSheet open={open} label={t('settings.deleteTitle')} closeLabel={t('notice.close')} onClose={onClose}>
      <DeleteSheetBody username={profile?.username ?? ''} onCancel={onClose} />
    </BottomSheet>
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
