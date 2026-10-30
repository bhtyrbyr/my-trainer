import { useTranslation } from 'react-i18next'
import { LEGAL } from '@/config/brand'

type Section = { title: string; items: string[] }

/** The privacy notice itself (text in locales/<lng>/legal.json, names from config/brand.json). */
export function NoticeContent() {
  const { t } = useTranslation('legal')
  const sections = t('notice.sections', { returnObjects: true }) as Section[]
  return (
    <article className="space-y-6">
      <header>
        <p className="eyebrow">{t('notice.eyebrow')}</p>
        <h1 className="display mt-2 text-[30px] leading-tight">{t('notice.title')}</h1>
        <p className="tabular mt-1 text-[12px] text-ink-faint">{t('notice.version', { version: LEGAL.noticeVersion })}</p>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">{t('notice.intro')}</p>
      </header>
      {sections.map((s, i) => (
        <section key={s.title} className="grid grid-cols-[28px_1fr] gap-x-2">
          <span className="tabular pt-0.5 text-[12px] font-semibold text-volt">{String(i + 1).padStart(2, '0')}</span>
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight">{s.title}</h2>
            <ul className="mt-2 space-y-2">
              {s.items.map((item) => (
                <li key={item} className="text-[14px] leading-relaxed text-ink-muted">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </article>
  )
}
