import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, ImagePlus, Loader2, X } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { loadImage } from '@/lib/image'
import { classifyError } from '@/lib/errors'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { AvatarCropper } from '../components/AvatarCropper'
import { cn } from '@/lib/utils'
import { isUnderage, onboardingSchema, suggestUsername, type OnboardingInput, type OnboardingValues } from '../schema'
import { completeOnboarding, isUsernameAvailable, uploadAvatar } from '../api'
import { acknowledgeNotice, confirmAdult } from '@/features/privacy/api'
import { NoticeContent } from '@/features/privacy/components/NoticeContent'
import { BottomSheet } from '@/features/nutrition/components/BottomSheet'

type AvatarState = { blob: Blob; previewUrl: string } | null

const SEX_OPTIONS = ['male', 'female', 'other'] as const
const GOAL_OPTIONS = ['lose_fat', 'build_muscle', 'maintain', 'performance'] as const

/**
 * Point of view: the form IS the leaderboard row. The live preview card at the top shows exactly
 * what others will see; everything below is grouped, borderless rows (iOS inset-grouped rhythm),
 * one accent, one primary action pinned in the thumb zone.
 */
export function OnboardingPage() {
  const { t } = useTranslation(['onboarding', 'common', 'legal'])
  const { user, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const [avatar, setAvatar] = useState<AvatarState>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [cropSource, setCropSource] = useState<HTMLImageElement | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle')
  const [submitError, setSubmitError] = useState<unknown>(null)
  // KVKK: the privacy notice is read and acknowledged before any profile data is stored
  const [noticeOk, setNoticeOk] = useState(false)
  const [adultOk, setAdultOk] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)

  const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string; avatar_url?: string; picture?: string }
  const googlePhoto = meta.avatar_url ?? meta.picture

  const form = useForm<OnboardingInput, unknown, OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      username: suggestUsername(meta.full_name ?? meta.name, user?.email),
      displayName: (meta.full_name ?? meta.name ?? '').slice(0, 40),
      showOnLeaderboard: true,
      birthYear: '',
      heightCm: '',
      weightKg: '',
      sex: '',
      goal: '',
    },
  })
  const { register, handleSubmit, watch, setValue, formState, setError: setFieldError } = form
  const username = watch('username')
  const displayName = watch('displayName')
  const sex = watch('sex')
  const goal = watch('goal')
  const showOnLeaderboard = watch('showOnLeaderboard')
  // a birth year that makes the person under 18 overrides the self-declaration
  const underage = isUnderage(watch('birthYear'))

  // Debounced availability check
  useEffect(() => {
    const value = username?.trim().toLowerCase() ?? ''
    if (!/^[a-z0-9_]{3,20}$/.test(value)) {
      setUsernameStatus('idle')
      return
    }
    setUsernameStatus('checking')
    const id = window.setTimeout(() => {
      isUsernameAvailable(value, user?.id)
        .then((ok) => setUsernameStatus(ok ? 'ok' : 'taken'))
        .catch(() => setUsernameStatus('idle'))
    }, 400)
    return () => window.clearTimeout(id)
  }, [username, user?.id])

  useEffect(() => () => { if (avatar) URL.revokeObjectURL(avatar.previewUrl) }, [avatar])

  /** Load the picked file / Google photo and open the cropper so the user chooses the framing. */
  const setAvatarFrom = async (src: Blob | string) => {
    setAvatarBusy(true)
    setAvatarError(null)
    try {
      const url = typeof src === 'string' ? src : URL.createObjectURL(src)
      setCropSource(await loadImage(url))
    } catch {
      setAvatarError(t('onboarding:avatar.error'))
    } finally {
      setAvatarBusy(false)
    }
  }
  const closeCropper = () => {
    if (cropSource?.src.startsWith('blob:')) URL.revokeObjectURL(cropSource.src)
    setCropSource(null)
  }
  const onCropConfirm = (blob: Blob) => {
    setAvatar((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return { blob, previewUrl: URL.createObjectURL(blob) }
    })
    closeCropper()
  }
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) void setAvatarFrom(f)
  }

  const onSubmit = async (values: OnboardingValues) => {
    setSubmitError(null)
    if (!user) return
    if (!avatar) {
      setAvatarError(t('onboarding:avatar.required'))
      return
    }
    if (usernameStatus === 'taken') {
      setFieldError('username', { message: 'username_taken' })
      return
    }
    try {
      await confirmAdult()
      await acknowledgeNotice()
      const path = await uploadAvatar(user.id, avatar.blob)
      await completeOnboarding(user.id, path, values)
      await refreshProfile()
      navigate('/', { replace: true })
    } catch (err) {
      const info = classifyError(err)
      if (info.key === 'errors.duplicate' && (info.detail === 'username' || !info.detail)) {
        setFieldError('username', { message: 'username_taken' })
      } else {
        setSubmitError(err)
      }
    }
  }

  const fieldError = (key: keyof OnboardingInput) => {
    const m = formState.errors[key]?.message
    return m ? t(`onboarding:errors.${m}`) : null
  }
  const usernameError = fieldError('username') ?? (usernameStatus === 'taken' ? t('onboarding:errors.username_taken') : null)
  const canSubmit = noticeOk && adultOk && !underage && Boolean(avatar) && usernameStatus !== 'taken' && usernameStatus !== 'checking' && !formState.isSubmitting

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col pt-safe lg:max-w-lg">
      {/* Header */}
      <header className="flex items-start justify-between px-6 pt-5">
        <div>
          <p className="eyebrow">{t('onboarding:eyebrow')}</p>
          <h1 className="display mt-2 text-[32px] text-ink">{t('onboarding:title')}</h1>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          aria-label={t('onboarding:cancel')}
          className="touch-target -mr-2 -mt-1 flex items-center justify-center rounded-full text-ink-faint hover:text-ink"
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col gap-7 px-6 pt-6 pb-52" noValidate>
        {/* Live leaderboard-row preview = avatar picker */}
        <section className="space-y-2">
          <div className="hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
            <div className="flex items-center gap-4 p-4">
              <button
                type="button"
                onClick={() => (avatar ? fileRef.current?.click() : cameraRef.current?.click())}
                aria-label={t('onboarding:avatar.label')}
                className={cn(
                  'relative size-[72px] shrink-0 rounded-full',
                  !avatar && 'border border-dashed border-line-strong bg-raised',
                )}
              >
                {avatar ? (
                  <img src={avatar.previewUrl} alt="" className="size-full rounded-full object-cover" />
                ) : (
                  <Camera className="absolute inset-0 m-auto size-6 text-ink-faint" aria-hidden />
                )}
                <span className="inner-glow absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full bg-volt text-volt-ink ring-[3px] ring-surface">
                  {avatarBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Camera className="size-3.5" aria-hidden />}
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-[17px] font-semibold leading-tight', !displayName && 'text-ink-faint')}>
                  {displayName || t('onboarding:preview.namePlaceholder')}
                </p>
                <p className="truncate text-sm text-ink-muted">@{username || '…'}</p>
                <p className="tabular mt-1 text-xs text-ink-faint">
                  {t('common:level', { n: 1 })} · {t('common:points', { n: 0 })}
                </p>
              </div>
            </div>
            <div className="flex divide-x divide-line border-t border-line">
              <SourceButton icon={Camera} label={t('onboarding:avatar.takePhoto')} onClick={() => cameraRef.current?.click()} />
              <SourceButton icon={ImagePlus} label={t('onboarding:avatar.choose')} onClick={() => fileRef.current?.click()} />
              {googlePhoto && (
                <SourceButton icon={GoogleG} label={t('onboarding:avatar.google')} onClick={() => void setAvatarFrom(googlePhoto)} />
              )}
            </div>
          </div>
          <p className={cn('px-1 text-xs', avatarError ? 'text-danger' : 'text-ink-faint')} role={avatarError ? 'alert' : undefined}>
            {avatarError ?? t('onboarding:subtitle')}
          </p>
          <input ref={cameraRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFile} />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </section>

        {/* Identity */}
        <Group>
          <Row label={t('onboarding:fields.username')} required error={usernameError} hint={t('onboarding:hints.username')}>
            <input
              {...register('username')}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={rowInput}
              aria-invalid={Boolean(usernameError)}
            />
            <span className="flex size-6 shrink-0 items-center justify-center">
              {usernameStatus === 'checking' && <Loader2 className="size-4 animate-spin text-ink-faint" aria-hidden />}
              {usernameStatus === 'ok' && <Check className="size-4 text-success" aria-hidden />}
              {usernameStatus === 'taken' && <X className="size-4 text-danger" aria-hidden />}
            </span>
          </Row>
          <Row label={t('onboarding:fields.displayName')} required error={fieldError('displayName')}>
            <input {...register('displayName')} className={rowInput} maxLength={40} />
          </Row>
        </Group>

        {/* Optional */}
        <section className="space-y-3">
          <p className="eyebrow px-1">{t('onboarding:about')}</p>
          <Group>
            <div className="grid grid-cols-3 divide-x divide-line">
              <Cell label={t('onboarding:fields.birthYear')} error={fieldError('birthYear')}>
                <input {...register('birthYear')} inputMode="numeric" placeholder="1990" className={cellInput} />
              </Cell>
              <Cell label={t('onboarding:fields.heightCm')} error={fieldError('heightCm')}>
                <input {...register('heightCm')} inputMode="decimal" placeholder="178" className={cellInput} />
              </Cell>
              <Cell label={t('onboarding:fields.weightKg')} error={fieldError('weightKg')}>
                <input {...register('weightKg')} inputMode="decimal" placeholder="80" className={cellInput} />
              </Cell>
            </div>
            <ChipRow label={t('onboarding:fields.sex')} required error={fieldError('sex')}>
              {SEX_OPTIONS.map((v) => (
                <Chip key={v} active={sex === v} onClick={() => setValue('sex', sex === v ? '' : v, { shouldDirty: true })}>
                  {t(`onboarding:sex.${v}`)}
                </Chip>
              ))}
            </ChipRow>
            <ChipRow label={t('onboarding:fields.goal')} required error={fieldError('goal')}>
              {GOAL_OPTIONS.map((v) => (
                <Chip key={v} active={goal === v} onClick={() => setValue('goal', goal === v ? '' : v, { shouldDirty: true })}>
                  {t(`onboarding:goal.${v}`)}
                </Chip>
              ))}
            </ChipRow>
            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[15px]">{t('onboarding:fields.showOnLeaderboard')}</p>
                <p className="text-xs text-ink-faint">{t('onboarding:hints.leaderboard')}</p>
              </div>
              <input type="checkbox" className="sr-only" tabIndex={-1} aria-hidden {...register('showOnLeaderboard')} />
              <Switch checked={Boolean(showOnLeaderboard)} onChange={(v) => setValue('showOnLeaderboard', v, { shouldDirty: true })} />
            </div>
          </Group>
        </section>

        <ErrorNote error={submitError} />

        {/* Primary action pinned in the thumb zone */}
        <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-bg from-70% to-bg/0 px-6 pt-10 pb-safe">
          <div className="mx-auto max-w-md space-y-2 pb-5 lg:max-w-lg">
            <label className="flex min-h-11 items-center gap-3 px-1 text-[13px] leading-snug text-ink-muted">
              <input type="checkbox" checked={adultOk && !underage} disabled={underage} onChange={(e) => setAdultOk(e.target.checked)} className="size-5 shrink-0 accent-[var(--color-volt)] disabled:opacity-40" />
              <span>{t('legal:ack.adult')}</span>
            </label>
            <label className="flex min-h-11 items-center gap-3 px-1 text-[13px] leading-snug text-ink-muted">
              <input type="checkbox" checked={noticeOk} onChange={(e) => setNoticeOk(e.target.checked)} className="size-5 shrink-0 accent-[var(--color-volt)]" />
              <span>
                <Trans
                  i18nKey="legal:ack.label"
                  components={[
                    <button
                      key="notice"
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        setNoticeOpen(true)
                      }}
                      className="font-medium text-ink underline underline-offset-2"
                    />,
                  ]}
                />
              </span>
            </label>
            <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
              {formState.isSubmitting ? <Loader2 className="size-5 animate-spin" aria-hidden /> : t('onboarding:submit')}
            </Button>
            <p className="text-center text-[11.5px] text-ink-faint">
              {underage ? t('onboarding:errors.too_young') : !avatar ? t('onboarding:avatar.required') : !adultOk ? t('legal:ack.adultRequired') : !noticeOk ? t('legal:ack.required') : t('onboarding:ready')}
            </p>
          </div>
        </div>
      </form>

      {cropSource && <AvatarCropper image={cropSource} onConfirm={onCropConfirm} onCancel={closeCropper} />}
      <BottomSheet open={noticeOpen} label={t('legal:notice.title')} closeLabel={t('legal:notice.close')} onClose={() => setNoticeOpen(false)}>
        <div className="pb-6">
          <NoticeContent />
          <Button
            size="lg"
            className="mt-6 w-full"
            onClick={() => {
              setNoticeOk(true)
              setNoticeOpen(false)
            }}
          >
            {t('legal:ack.gateConfirm')}
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}

/* ---------- local building blocks (grouped-list rhythm) ---------- */

const rowInput =
  'min-w-0 flex-1 bg-transparent text-[17px] text-ink placeholder:text-ink-faint focus:outline-none'
const cellInput =
  'w-full bg-transparent text-[17px] text-ink tabular placeholder:text-ink-faint focus:outline-none'

function Group({ children }: { children: ReactNode }) {
  return <div className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface">{children}</div>
}

function Row({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string
  required?: boolean
  error?: string | null
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block px-4 py-3">
      <span className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        {label}
        {required && <span className="size-1.5 rounded-full bg-volt" aria-hidden />}
      </span>
      <span className="mt-1 flex items-center gap-2">{children}</span>
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-faint">{hint}</span>
      ) : null}
    </label>
  )
}

function Cell({ label, error, children }: { label: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block px-4 py-3">
      <span className="block text-xs font-medium text-ink-muted">{label}</span>
      <span className="mt-1 block">{children}</span>
      {error && <span className="mt-1 block text-[11px] text-danger">{error}</span>}
    </label>
  )
}

function ChipRow({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string | null
  children: ReactNode
}) {
  return (
    <div className="px-4 py-3" role="radiogroup" aria-label={label} aria-invalid={Boolean(error)}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        {label}
        {required && <span className="size-1.5 rounded-full bg-volt" aria-hidden />}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'h-9 rounded-full border px-3.5 text-sm font-medium transition-colors',
        active ? 'border-volt bg-volt text-volt-ink' : 'border-line-strong text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full transition-colors',
        checked ? 'bg-volt' : 'bg-raised',
      )}
    >
      <span
        className={cn(
          'absolute left-0 top-0.5 size-6 rounded-full shadow transition-[translate] duration-200',
          checked ? 'translate-x-[22px] bg-volt-ink' : 'translate-x-0.5 bg-ink',
        )}
      />
    </button>
  )
}

function SourceButton({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 flex-1 items-center justify-center gap-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-raised hover:text-ink"
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  )
}

function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.6-2.6C16.9 3.1 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z"
      />
    </svg>
  )
}
