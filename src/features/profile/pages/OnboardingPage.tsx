import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, ImagePlus, Loader2, X } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { toSquareJpeg } from '@/lib/image'
import { cn } from '@/lib/utils'
import { onboardingSchema, suggestUsername, type OnboardingInput, type OnboardingValues } from '../schema'
import { completeOnboarding, isUsernameAvailable, uploadAvatar } from '../api'

type AvatarState = { blob: Blob; previewUrl: string } | null

export function OnboardingPage() {
  const { t } = useTranslation(['onboarding', 'common'])
  const { user, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const [avatar, setAvatar] = useState<AvatarState>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)

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
      sex: '',
      goal: '',
    },
  })
  const { register, handleSubmit, watch, formState, setError: setFieldError } = form
  const username = watch('username')

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

  const setAvatarFrom = async (src: Blob | string) => {
    setAvatarBusy(true)
    setAvatarError(null)
    try {
      const blob = await toSquareJpeg(src, 512)
      setAvatar((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl)
        return { blob, previewUrl: URL.createObjectURL(blob) }
      })
    } catch {
      setAvatarError(t('onboarding:avatar.error'))
    } finally {
      setAvatarBusy(false)
    }
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
      const path = await uploadAvatar(user.id, avatar.blob)
      await completeOnboarding(user.id, path, values)
      await refreshProfile()
      navigate('/', { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/duplicate key|unique/i.test(msg)) setFieldError('username', { message: 'username_taken' })
      else setSubmitError(msg)
    }
  }

  const fieldError = (key: keyof OnboardingInput) => {
    const m = formState.errors[key]?.message
    return m ? t(`onboarding:errors.${m}`) : null
  }

  const canSubmit = Boolean(avatar) && usernameStatus !== 'taken' && usernameStatus !== 'checking' && !formState.isSubmitting

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col pt-safe pb-safe">
      <header className="flex items-center justify-between px-6 pt-4">
        <div>
          <h1 className="text-2xl font-bold">{t('onboarding:title')}</h1>
          <p className="text-sm text-slate-400">{t('onboarding:subtitle')}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label={t('onboarding:cancel')} onClick={() => void signOut()}>
          <X className="size-5" aria-hidden />
        </Button>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col gap-6 px-6 py-6" noValidate>
        {/* Avatar (required) */}
        <section className="flex flex-col items-center gap-3">
          <div
            className={cn(
              'relative flex size-32 items-center justify-center overflow-hidden rounded-full border-2 bg-slate-900',
              avatar ? 'border-brand-500' : 'border-dashed border-slate-700',
            )}
          >
            {avatar ? (
              <img src={avatar.previewUrl} alt="" className="size-full object-cover" />
            ) : (
              <Camera className="size-10 text-slate-500" aria-hidden />
            )}
            {avatarBusy && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60">
                <Loader2 className="size-8 animate-spin text-brand-400" aria-hidden />
              </div>
            )}
          </div>
          <p className="text-sm font-medium">
            {t('onboarding:avatar.label')} <span className="text-red-400">*</span>
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="secondary" size="sm" className="gap-2" onClick={() => cameraRef.current?.click()}>
              <Camera className="size-4" aria-hidden /> {t('onboarding:avatar.takePhoto')}
            </Button>
            <Button type="button" variant="secondary" size="sm" className="gap-2" onClick={() => fileRef.current?.click()}>
              <ImagePlus className="size-4" aria-hidden /> {t('onboarding:avatar.choose')}
            </Button>
            {googlePhoto && (
              <Button type="button" variant="ghost" size="sm" onClick={() => void setAvatarFrom(googlePhoto)}>
                {t('onboarding:avatar.useGoogle')}
              </Button>
            )}
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFile} />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          {avatarError && <p role="alert" className="text-sm text-red-400">{avatarError}</p>}
        </section>

        {/* Identity */}
        <section className="space-y-4">
          <Field label={t('onboarding:fields.username')} required error={fieldError('username')} hint={t('onboarding:hints.username')}>
            <div className="relative">
              <input
                {...register('username')}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                className={inputCls}
                aria-invalid={Boolean(formState.errors.username) || usernameStatus === 'taken'}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                {usernameStatus === 'checking' && <Loader2 className="size-4 animate-spin text-slate-500" aria-hidden />}
                {usernameStatus === 'ok' && <Check className="size-4 text-emerald-400" aria-hidden />}
                {usernameStatus === 'taken' && <X className="size-4 text-red-400" aria-hidden />}
              </span>
            </div>
            {usernameStatus === 'taken' && !formState.errors.username && (
              <p className="text-sm text-red-400">{t('onboarding:errors.username_taken')}</p>
            )}
          </Field>
          <Field label={t('onboarding:fields.displayName')} required error={fieldError('displayName')}>
            <input {...register('displayName')} className={inputCls} maxLength={40} />
          </Field>
        </section>

        {/* Optional */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t('onboarding:optional')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('onboarding:fields.birthYear')} error={fieldError('birthYear')}>
              <input {...register('birthYear')} inputMode="numeric" placeholder="1990" className={inputCls} />
            </Field>
            <Field label={t('onboarding:fields.heightCm')} error={fieldError('heightCm')}>
              <input {...register('heightCm')} inputMode="decimal" placeholder="178" className={inputCls} />
            </Field>
          </div>
          <Field label={t('onboarding:fields.sex')}>
            <select {...register('sex')} className={inputCls}>
              <option value="">{t('onboarding:choose')}</option>
              <option value="male">{t('onboarding:sex.male')}</option>
              <option value="female">{t('onboarding:sex.female')}</option>
              <option value="other">{t('onboarding:sex.other')}</option>
            </select>
          </Field>
          <Field label={t('onboarding:fields.goal')}>
            <select {...register('goal')} className={inputCls}>
              <option value="">{t('onboarding:choose')}</option>
              <option value="lose_fat">{t('onboarding:goal.lose_fat')}</option>
              <option value="build_muscle">{t('onboarding:goal.build_muscle')}</option>
              <option value="maintain">{t('onboarding:goal.maintain')}</option>
              <option value="performance">{t('onboarding:goal.performance')}</option>
            </select>
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
            <span className="text-sm">{t('onboarding:fields.showOnLeaderboard')}</span>
            <input type="checkbox" {...register('showOnLeaderboard')} className="size-5 accent-cyan-500" />
          </label>
        </section>

        {submitError && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {t('common:error')} {submitError}
          </p>
        )}

        <div className="mt-auto pt-2">
          <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
            {formState.isSubmitting ? <Loader2 className="size-5 animate-spin" aria-hidden /> : t('onboarding:submit')}
          </Button>
          {!avatar && <p className="mt-2 text-center text-xs text-slate-500">{t('onboarding:avatar.required')}</p>}
        </div>
      </form>
    </div>
  )
}

const inputCls =
  'w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-base text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none aria-[invalid=true]:border-red-500'

function Field({
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
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      {children}
      {error ? <p className="text-sm text-red-400">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </label>
  )
}
