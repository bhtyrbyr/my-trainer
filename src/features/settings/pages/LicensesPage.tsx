import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowUpRight, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FONTS, LIBRARIES, LICENSE_NAMES, LICENSE_TEXTS, SOURCE_GROUPS, type LicenseId, type SoftwareNotice, type SourceNotice } from '../licenses'

/**
 * Profile > About > Licences. Point of view: a book's colophon. One large title, then numbered,
 * ruled sections (volt numerals as in the privacy notice): what we show (exercises, food data) with
 * holder, licence and what we changed; then fonts and software as compact name / holder / licence rows.
 */
export function LicensesPage() {
  const { t } = useTranslation('licenses')
  const navigate = useNavigate()
  const location = useLocation()
  const canGoBack = location.key !== 'default'

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-2">
        <div className="-ml-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('back')}
            className="text-ink"
            onClick={() => (canGoBack ? navigate(-1) : navigate('/settings'))}
          >
            <ChevronLeft className="size-6" aria-hidden />
          </Button>
        </div>

        <header className="rise-in mt-3">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 className="display mt-2 text-[40px]">{t('title')}</h1>
          <p className="mt-4 max-w-[54ch] text-[15px] leading-relaxed text-ink-muted">{t('intro')}</p>
        </header>

        {SOURCE_GROUPS.map((g, i) => (
          <Section key={g.id} n={i + 1} title={t(`groups.${g.id}`)}>
            {g.items.map((s) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </Section>
        ))}

        <Section n={SOURCE_GROUPS.length + 1} title={t('groups.fonts')} note={t('fontsNote')}>
          {FONTS.map((f) => (
            <SoftwareRow key={f.name} item={f} />
          ))}
        </Section>

        <Section n={SOURCE_GROUPS.length + 2} title={t('groups.libraries')}>
          {LIBRARIES.map((l) => (
            <SoftwareRow key={l.name} item={l} />
          ))}
        </Section>

        <footer className="mt-10">
          <h2 className="eyebrow">{t('texts')}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(LICENSE_TEXTS) as LicenseId[]).map((id) => (
              <li key={id}>
                <ExternalLink
                  href={LICENSE_TEXTS[id]}
                  className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-[14px] font-medium text-ink-muted transition-colors hover:text-ink"
                >
                  {LICENSE_NAMES[id]}
                  <ArrowUpRight className="size-3.5 text-ink-faint" aria-hidden />
                </ExternalLink>
              </li>
            ))}
          </ul>
        </footer>
      </div>
    </div>
  )
}

function Section({ n, title, note, children }: { n: number; title: string; note?: string; children: ReactNode }) {
  const id = `licenses-${n}`
  return (
    <section aria-labelledby={id} className="mt-10">
      <div className="flex items-baseline gap-3">
        <span aria-hidden className="tabular text-[12px] font-semibold text-volt">
          {String(n).padStart(2, '0')}
        </span>
        <h2 id={id} className="display text-[22px]">
          {title}
        </h2>
      </div>
      {note && <p className="mt-1.5 pl-[30px] text-[13px] text-ink-faint">{note}</p>}
      <ul className="mt-3 divide-y divide-line border-y border-line">{children}</ul>
    </section>
  )
}

function SourceRow({ source }: { source: SourceNotice }) {
  const { t } = useTranslation('licenses')
  const k = (field: string) => t(`sources.${source.id}.${field}`)
  return (
    <li className="py-4">
      <ExternalLink href={source.url} className="group flex min-h-11 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[16px] font-semibold tracking-tight text-ink">{k('title')}</span>
          <span className="mt-0.5 block text-[13px] text-ink-muted">{k('holder')}</span>
        </span>
        <ArrowUpRight className="mt-1 size-4 shrink-0 text-ink-faint transition-colors group-hover:text-ink" aria-hidden />
      </ExternalLink>
      <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-ink-muted">{k('note')}</p>
      <ExternalLink href={source.licenseUrl} className="mt-1 inline-flex min-h-11 items-center gap-2.5 text-[13px] text-ink-muted hover:text-ink">
        <span className="eyebrow">{t('licenseLabel')}</span>
        <span className="underline decoration-line-strong underline-offset-4">{k('license')}</span>
      </ExternalLink>
    </li>
  )
}

function SoftwareRow({ item }: { item: SoftwareNotice }) {
  return (
    <li>
      <ExternalLink href={item.url} className="group flex min-h-14 items-center gap-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-ink">{item.name}</span>
          <span className="block truncate text-[12px] text-ink-faint">{item.holder}</span>
        </span>
        <span className="tabular shrink-0 text-[12px] font-medium text-ink-muted">{LICENSE_NAMES[item.license]}</span>
        <ArrowUpRight className="size-4 shrink-0 text-ink-faint transition-colors group-hover:text-ink" aria-hidden />
      </ExternalLink>
    </li>
  )
}

function ExternalLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const { t } = useTranslation('licenses')
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
      {children}
      <span className="sr-only"> ({t('opens')})</span>
    </a>
  )
}
