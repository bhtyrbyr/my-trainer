import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { isRecoveryCodeShape } from '@/lib/crypto/encoding'
import { WrongSecretError } from '@/lib/crypto/vault'
import { useCreateVault, useRecover, useUnlock } from '../hooks'

const MIN_LEN = 10

export function PasswordField({ label, value, onChange, autoComplete, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean }) {
  const { t } = useTranslation('photos')
  const id = useId()
  const [show, setShow] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
        {label}
      </label>
      <div className="hairline flex h-12 items-center rounded-[var(--radius-input)] bg-bg pl-3 focus-within:ring-2 focus-within:ring-volt">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-[16px] text-ink outline-none"
        />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('setup.hide') : t('setup.show')} aria-pressed={show} className="flex size-12 shrink-0 items-center justify-center text-ink-faint hover:text-ink">
          {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  )
}

function Remember({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation('photos')
  return (
    <label className="flex min-h-11 gap-3 py-1 text-[14px]">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--color-volt)]" />
      <span>
        <span className="block font-medium">{t('setup.remember')}</span>
        <span className="block text-[12px] leading-snug text-ink-faint">{t('setup.rememberHint')}</span>
      </span>
    </label>
  )
}

/** First run: what zero-knowledge means, the one risk, and the password. */
export function VaultSetup({ onCreated }: { onCreated: (code: string) => void }) {
  const { t } = useTranslation('photos')
  const create = useCreateVault()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [remember, setRemember] = useState(false)
  const tooShort = pw.length > 0 && pw.length < MIN_LEN
  const mismatch = pw2.length > 0 && pw !== pw2
  const ok = pw.length >= MIN_LEN && pw === pw2
  const points = t('setup.points', { returnObjects: true }) as string[]

  return (
    <section className="rise-in space-y-5">
      <div>
        <ShieldCheck className="size-8 text-volt" aria-hidden />
        <h2 className="display mt-3 text-[28px] leading-tight">{t('setup.title')}</h2>
        <ul className="mt-4 space-y-2.5">
          {points.map((p) => (
            <li key={p} className="flex gap-2.5 text-[14px] leading-snug text-ink-muted">
              <Check className="mt-0.5 size-4 shrink-0 text-volt" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-[var(--radius-input)] border border-danger/30 bg-danger/10 px-3.5 py-3 text-[13px] leading-snug text-ink">{t('setup.warning')}</p>
      </div>
      <div className="hairline space-y-4 rounded-[var(--radius-card)] bg-surface p-4">
        <PasswordField label={t('setup.password')} value={pw} onChange={setPw} autoComplete="new-password" />
        <PasswordField label={t('setup.confirm')} value={pw2} onChange={setPw2} autoComplete="new-password" />
        <p className={tooShort || mismatch ? 'text-[12px] text-danger' : 'text-[12px] text-ink-faint'}>{tooShort ? t('setup.tooShort') : mismatch ? t('setup.mismatch') : t('setup.hint')}</p>
        <Remember value={remember} onChange={setRemember} />
        <ErrorNote error={create.error} />
        <Button size="lg" className="w-full" disabled={!ok || create.isPending} onClick={() => create.mutate({ password: pw, remember }, { onSuccess: (code) => code && onCreated(code) })}>
          {create.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {create.isPending ? t('setup.creating') : t('setup.create')}
        </Button>
      </div>
    </section>
  )
}

/** The recovery code, shown exactly once. */
export function RecoveryReveal({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useTranslation('photos')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  // the code must be read from the top; the setup form above was scrolled
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])
  return (
    <section className="rise-in space-y-5">
      <div>
        <h2 className="display text-[28px]">{t('recovery.title')}</h2>
        <p className="mt-2 text-[14px] leading-snug text-ink-muted">{t('recovery.body')}</p>
      </div>
      <div className="hairline rounded-[var(--radius-card)] bg-surface p-5">
        <p className="tabular select-all text-center font-mono text-[19px] font-semibold leading-relaxed tracking-[0.08em]">{code}</p>
        <Button
          variant="secondary"
          className="mt-4 w-full"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => setCopied(true))
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? t('recovery.copied') : t('recovery.copy')}
        </Button>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-[15px] font-medium">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-5 accent-[var(--color-volt)]" />
        {t('recovery.saved')}
      </label>
      <Button size="lg" className="w-full" disabled={!saved} onClick={onDone}>
        {t('recovery.continue')}
      </Button>
    </section>
  )
}

/** Locked: password, or the recovery code with a new password. */
export function UnlockScreen() {
  const { t } = useTranslation('photos')
  const unlock = useUnlock()
  const recover = useRecover()
  const [mode, setMode] = useState<'password' | 'recovery'>('password')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [next, setNext] = useState('')
  const [remember, setRemember] = useState(false)
  const wrong = (e: unknown) => e instanceof WrongSecretError

  if (mode === 'recovery') {
    const codeOk = isRecoveryCodeShape(code)
    return (
      <section className="rise-in space-y-5">
        <div>
          <h2 className="display text-[28px]">{t('recover.title')}</h2>
          <p className="mt-2 text-[14px] text-ink-muted">{t('recover.body')}</p>
        </div>
        <div className="hairline space-y-4 rounded-[var(--radius-card)] bg-surface p-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">{t('recover.code')}</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="hairline h-12 w-full rounded-[var(--radius-input)] bg-bg px-3 font-mono text-[16px] uppercase tracking-[0.06em] text-ink outline-none focus-visible:ring-2 focus-visible:ring-volt"
            />
            {code && !codeOk && <span className="mt-1 block text-[12px] text-ink-faint">{t('recover.codeShape')}</span>}
          </label>
          <PasswordField label={t('recover.newPassword')} value={next} onChange={setNext} autoComplete="new-password" />
          {next.length > 0 && next.length < MIN_LEN && <p className="text-[12px] text-danger">{t('setup.tooShort')}</p>}
          <Remember value={remember} onChange={setRemember} />
          {recover.error && (wrong(recover.error) ? <p className="text-[13px] text-danger">{t('recover.wrong')}</p> : <ErrorNote error={recover.error} />)}
          <Button size="lg" className="w-full" disabled={!codeOk || next.length < MIN_LEN || recover.isPending} onClick={() => recover.mutate({ code, newPassword: next, remember })}>
            {recover.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {t('recover.submit')}
          </Button>
        </div>
        <button type="button" onClick={() => setMode('password')} className="h-11 text-[14px] font-medium text-ink-muted hover:text-ink">
          {t('recover.back')}
        </button>
      </section>
    )
  }

  return (
    <section className="rise-in space-y-5">
      <div>
        <LockKeyhole className="size-8 text-ink-muted" aria-hidden />
        <h2 className="display mt-3 text-[28px]">{t('unlock.title')}</h2>
        <p className="mt-2 text-[14px] text-ink-muted">{t('unlock.body')}</p>
      </div>
      <form
        className="hairline space-y-4 rounded-[var(--radius-card)] bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (pw) unlock.mutate({ password: pw, remember })
        }}
      >
        <PasswordField label={t('unlock.password')} value={pw} onChange={setPw} autoComplete="current-password" autoFocus />
        <Remember value={remember} onChange={setRemember} />
        {unlock.error && (wrong(unlock.error) ? <p className="text-[13px] text-danger">{t('unlock.wrong')}</p> : <ErrorNote error={unlock.error} />)}
        <Button type="submit" size="lg" className="w-full" disabled={!pw || unlock.isPending}>
          {unlock.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {unlock.isPending ? t('unlock.working') : t('unlock.submit')}
        </Button>
      </form>
      <button type="button" onClick={() => setMode('recovery')} className="h-11 text-[14px] font-medium text-ink-muted hover:text-ink">
        {t('unlock.forgot')}
      </button>
    </section>
  )
}
