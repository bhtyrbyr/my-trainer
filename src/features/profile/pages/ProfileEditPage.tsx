import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'
import { Camera, Check, ImagePlus, Info, Loader2, X } from 'lucide-react'
import { BackTitle } from '@/components/layout/BackTitle'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList } from '@/components/ui/GroupedList'
import { useAuth } from '@/features/auth/AuthProvider'
import { useUnits } from '@/features/settings/useUnits'
import { classifyError } from '@/lib/errors'
import { loadImage } from '@/lib/image'
import { parseDecimal } from '@/lib/units'
import { cn } from '@/lib/utils'
import { avatarUrl, isUsernameAvailable } from '../api'
import { AvatarCropper } from '../components/AvatarCropper'
import { useProfilePrivate, useSaveProfile } from '../hooks'
import {
  USERNAME_RE,
  isMinorBirthYear,
  nextUsernameChange,
  profileEditSchema,
  type ProfileEditValues,
} from '../schema'

const SEX_OPTIONS = ['male', 'female', 'other'] as const
const GOAL_OPTIONS = ['lose_fat', 'build_muscle', 'maintain', 'performance'] as const
const KNOWN_ERRORS = new Set(['username_invalid', 'username_taken', 'display_name_required', 'display_name_too_long', 'sex_required', 'goal_required'])

/** What the form holds: text in the user's own units (height cm/in, target kg/lb). */
type FormValues = {
  username: string
  displayName: string
  birthYear: string
  height: string
  targetWeight: string
  sex: '' | (typeof SEX_OPTIONS)[number]
  goal: '' | (typeof GOAL_OPTIONS)[number]
}

/**
 * Profile edit (/me/edit). Point of view: the same inset-grouped rhythm as onboarding, split by who
 * sees it: "public" (photo, name, username) and "only you" (body and goal). Height and target weight
 * are typed in the user's units and validated in metric with the onboarding schema.
 */
export function ProfileEditPage() {
  const { t, i18n } = useTranslation(['profile', 'onboarding', 'common'])
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const u = useUnits()
  const priv = useProfilePrivate(Boolean(profile))
  const save = useSaveProfile()
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const [avatar, setAvatar] = useState<{ blob: Blob; previewUrl: string } | null>(null)
  const [cropSource, setCropSource] = useState<HTMLImageElement | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle')

  const nextChange = nextUsernameChange(profile?.username_changed_at)
  const dateLocale = i18n.resolvedLanguage === 'en' ? enUS : tr
  const googlePhoto = ((user?.user_metadata ?? {}) as { avatar_url?: string; picture?: string }).avatar_url

  // display text -> metric numbers, then the shared zod rules (ranges are metric); errors map back
  const resolver = useMemo<Resolver<FormValues, unknown, ProfileEditValues>>(() => {
    const zod = zodResolver(profileEditSchema)
    const metric = (raw: string, conv: (n: number) => number) => {
      if (raw.trim() === '') return ''
      const n = parseDecimal(raw)
      return n === null ? raw : conv(n)
    }
    return async (values, ctx, opts) => {
      const input = {
        username: values.username,
        displayName: values.displayName,
        birthYear: values.birthYear.trim(),
        heightCm: metric(values.height, u.toCm),
        targetWeightKg: metric(values.targetWeight, (n) => u.toKg(n, 'body')),
        sex: values.sex,
        goal: values.goal,
      }
      const r = await zod(input, ctx, opts as never)
      if (Object.keys(r.errors).length === 0) return { values: r.values as ProfileEditValues, errors: {} }
      const { heightCm, targetWeightKg, ...rest } = r.errors as Record<string, unknown>
      const errors = { ...rest, ...(heightCm ? { height: heightCm } : {}), ...(targetWeightKg ? { targetWeight: targetWeightKg } : {}) }
      return { values: {}, errors: errors as never }
    }
  }, [u])

  const form = useForm<FormValues, unknown, ProfileEditValues>({ resolver })
  const { register, handleSubmit, watch, setValue, reset, formState, setError } = form

  // fill once both the public and private rows are here
  const filled = useRef(false)
  useEffect(() => {
    if (filled.current || !profile || !priv.data) return
    filled.current = true
    const p = priv.data
    reset({
      username: profile.username,
      displayName: profile.display_name,
      birthYear: p.birth_year != null ? String(p.birth_year) : '',
      height: p.height_cm != null ? String(u.cm(p.height_cm)) : '',
      targetWeight: p.target_weight_kg != null ? String(u.kg(p.target_weight_kg, 'body')) : '',
      sex: p.sex ?? '',
      goal: p.goal ?? '',
    })
  }, [profile, priv.data, reset, u])

  const username = watch('username')
  const sex = watch('sex')
  const goal = watch('goal')
  const birthYear = watch('birthYear')
  const minor = isMinorBirthYear(birthYear ? Number(birthYear) : '')

  useEffect(() => {
    const value = username?.trim().toLowerCase() ?? ''
    if (!profile || value === profile.username.toLowerCase() || !USERNAME_RE.test(value)) {
      setUsernameStatus('idle')
      return
    }
    setUsernameStatus('checking')
    const id = window.setTimeout(() => {
      isUsernameAvailable(value, profile.user_id)
        .then((ok) => setUsernameStatus(ok ? 'ok' : 'taken'))
        .catch(() => setUsernameStatus('idle'))
    }, 400)
    return () => window.clearTimeout(id)
  }, [username, profile])

  useEffect(() => () => { if (avatar) URL.revokeObjectURL(avatar.previewUrl) }, [avatar])

  const openCropper = async (src: Blob | string) => {
    setAvatarBusy(true)
    setAvatarError(null)
    try {
      setCropSource(await loadImage(typeof src === 'string' ? src : URL.createObjectURL(src)))
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
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) void openCropper(f)
  }

  const onSubmit = (values: ProfileEditValues) => {
    if (usernameStatus === 'taken') {
      setError('username', { message: 'username_taken' })
      return
    }
    save.mutate(
      { values, avatar: avatar?.blob ?? null },
      {
        onSuccess: () => navigate('/me', { replace: true }),
        onError: (err) => {
          const info = classifyError(err)
          if (info.key === 'errors.duplicate') setError('username', { message: 'username_taken' })
        },
      },
    )
  }

  const fieldError = (key: keyof FormValues) => {
    const m = formState.errors[key]?.message
    if (!m) return null
    return KNOWN_ERRORS.has(m) ? t(`onboarding:errors.${m}`) : t('profile:editPage.errors.range')
  }
  const usernameError = fieldError('username') ?? (usernameStatus === 'taken' ? t('onboarding:errors.username_taken') : null)
  const loading = !profile || priv.isLoading
  const dirty = formState.isDirty || Boolean(avatar)
  const shownAvatar = avatar?.previewUrl ?? avatarUrl(profile?.avatar_path, profile?.updated_at)

  return (
    <PageShell
      title={t('profile:editPage.title')}
      leading={<BackTitle to="/me" label={t('profile:title')} title={t('profile:editPage.title')} />}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mx-auto max-w-xl space-y-7 pb-6">
        {/* photo */}
        <section className="flex flex-col items-center" aria-label={t('onboarding:avatar.label')}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label={t('profile:editPage.changePhoto')}
            className="relative size-24 rounded-full"
          >
            {shownAvatar ? (
              <img src={shownAvatar} alt="" className="size-full rounded-full object-cover" />
            ) : (
              <span className="block size-full rounded-full bg-raised" />
            )}
            <span className="absolute -bottom-0.5 -right-0.5 flex size-8 items-center justify-center rounded-full bg-raised text-ink ring-4 ring-bg">
              {avatarBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
            </span>
          </button>
          <div className="mt-3 flex flex-wrap justify-center gap-1">
            <SourceButton icon={Camera} label={t('onboarding:avatar.takePhoto')} onClick={() => cameraRef.current?.click()} />
            <SourceButton icon={ImagePlus} label={t('onboarding:avatar.choose')} onClick={() => fileRef.current?.click()} />
            {googlePhoto && <SourceButton icon={ImagePlus} label={t('onboarding:avatar.google')} onClick={() => void openCropper(googlePhoto)} />}
          </div>
          {avatarError && (
            <p role="alert" className="mt-1 text-[13px] text-danger">
              {avatarError}
            </p>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFile} />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </section>

        {loading ? (
          <FormSkeleton />
        ) : (
          <>
            <GroupedList title={t('profile:editPage.public')}>
              <Row label={t('onboarding:fields.displayName')} error={fieldError('displayName')}>
                <input {...register('displayName')} maxLength={40} autoComplete="nickname" className={rowInput} />
              </Row>
              <Row
                label={t('onboarding:fields.username')}
                error={usernameError}
                hint={
                  nextChange
                    ? t('profile:editPage.usernameLocked', { date: format(nextChange, 'd MMMM yyyy', { locale: dateLocale }) })
                    : t('profile:editPage.usernameRule')
                }
              >
                <span className="text-[17px] text-ink-faint">@</span>
                <input
                  {...register('username')}
                  readOnly={Boolean(nextChange)}
                  aria-readonly={Boolean(nextChange)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(usernameError)}
                  className={cn(rowInput, nextChange && 'text-ink-muted')}
                />
                <span className="flex size-6 shrink-0 items-center justify-center">
                  {usernameStatus === 'checking' && <Loader2 className="size-4 animate-spin text-ink-faint" aria-hidden />}
                  {usernameStatus === 'ok' && <Check className="size-4 text-success" aria-hidden />}
                  {usernameStatus === 'taken' && <X className="size-4 text-danger" aria-hidden />}
                </span>
              </Row>
            </GroupedList>

            <GroupedList title={t('profile:editPage.private')} footer={t('profile:editPage.privateHint')}>
              <div className="grid grid-cols-3 divide-x divide-line">
                <Cell label={t('onboarding:fields.birthYear')} error={fieldError('birthYear')}>
                  <input {...register('birthYear')} inputMode="numeric" placeholder="1990" className={cellInput} />
                </Cell>
                <Cell label={t('profile:editPage.height', { unit: u.lengthLabel })} error={fieldError('height')}>
                  <input {...register('height')} inputMode="decimal" placeholder={u.lengthLabel === 'cm' ? '178' : '70'} className={cellInput} />
                </Cell>
                <Cell label={t('profile:editPage.target', { unit: u.weightLabel })} error={fieldError('targetWeight')}>
                  <input {...register('targetWeight')} inputMode="decimal" placeholder={u.weightLabel === 'kg' ? '75' : '165'} className={cellInput} />
                </Cell>
              </div>
              <div className={cn('flex gap-2.5 px-4 py-3 text-[13px] leading-snug', minor ? 'text-ink' : 'text-ink-muted')}>
                <Info className={cn('mt-0.5 size-4 shrink-0', minor ? 'text-volt' : 'text-ink-faint')} aria-hidden />
                <p>{minor ? t('profile:editPage.minorOn') : t('profile:editPage.minorHint')}</p>
              </div>
              <ChipRow label={t('onboarding:fields.sex')} error={fieldError('sex')}>
                {SEX_OPTIONS.map((v) => (
                  <Chip key={v} active={sex === v} onClick={() => setValue('sex', v, { shouldDirty: true })}>
                    {t(`onboarding:sex.${v}`)}
                  </Chip>
                ))}
              </ChipRow>
              <ChipRow label={t('onboarding:fields.goal')} error={fieldError('goal')}>
                {GOAL_OPTIONS.map((v) => (
                  <Chip key={v} active={goal === v} onClick={() => setValue('goal', v, { shouldDirty: true })}>
                    {t(`onboarding:goal.${v}`)}
                  </Chip>
                ))}
              </ChipRow>
            </GroupedList>
          </>
        )}

        <ErrorNote error={priv.error ?? (save.error && classifyError(save.error).key === 'errors.duplicate' ? null : save.error)} />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={loading || !dirty || save.isPending || usernameStatus === 'checking' || usernameStatus === 'taken'}
        >
          {save.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {save.isPending ? t('profile:editPage.saving') : t('profile:editPage.save')}
        </Button>
      </form>

      {cropSource && (
        <AvatarCropper
          image={cropSource}
          onCancel={closeCropper}
          onConfirm={(blob) => {
            setAvatar((prev) => {
              if (prev) URL.revokeObjectURL(prev.previewUrl)
              return { blob, previewUrl: URL.createObjectURL(blob) }
            })
            closeCropper()
          }}
        />
      )}
    </PageShell>
  )
}

/* ---------- local rows (onboarding rhythm) ---------- */

const rowInput = 'min-w-0 flex-1 bg-transparent text-[17px] text-ink placeholder:text-ink-faint focus:outline-none'
const cellInput = 'w-full bg-transparent text-[17px] text-ink tabular placeholder:text-ink-faint focus:outline-none'

function Row({ label, error, hint, children }: { label: string; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <label className="block px-4 py-3">
      <span className="block text-xs font-medium text-ink-muted">{label}</span>
      <span className="mt-1 flex items-center gap-1">{children}</span>
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
    <label className="block min-w-0 px-4 py-3">
      <span className="block truncate text-xs font-medium text-ink-muted">{label}</span>
      <span className="mt-1 block">{children}</span>
      {error && <span className="mt-1 block text-[11px] leading-tight text-danger">{error}</span>}
    </label>
  )
}

function ChipRow({ label, error, children }: { label: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="px-4 py-3" role="radiogroup" aria-label={label} aria-invalid={Boolean(error)}>
      <p className="text-xs font-medium text-ink-muted">{label}</p>
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
        'h-11 rounded-full border px-4 text-sm font-medium transition-colors',
        active ? 'border-volt bg-volt text-volt-ink' : 'border-line-strong text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function SourceButton({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-raised hover:text-ink"
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  )
}

function FormSkeleton() {
  return (
    <div className="space-y-7" aria-busy="true">
      <span className="block h-[148px] animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" />
      <span className="block h-[260px] animate-pulse rounded-[var(--radius-card)] bg-surface motion-reduce:animate-none" />
    </div>
  )
}
