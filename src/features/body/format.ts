import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { format, parseISO } from 'date-fns'
import { enUS, tr } from 'date-fns/locale'

/** One decimal for kg / cm, signed variant for changes, localized dates from YYYY-MM-DD keys. */
export function useBodyFormat() {
  const { i18n } = useTranslation()
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'tr'
  return useMemo(() => {
    const locale = lang === 'tr' ? tr : enUS
    const one = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    const signed = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' })
    return {
      lang,
      num: (n: number) => one.format(n),
      signed: (n: number) => signed.format(n).replace('-', '−'),
      day: (day: string, pattern: string) => format(parseISO(day), pattern, { locale }),
      time: (t: number, pattern: string) => format(t, pattern, { locale }),
    }
  }, [lang])
}
