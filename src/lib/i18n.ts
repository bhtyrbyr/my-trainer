import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import trCommon from '@/locales/tr/common.json'
import trAuth from '@/locales/tr/auth.json'
import trSettings from '@/locales/tr/settings.json'
import trOnboarding from '@/locales/tr/onboarding.json'
import enCommon from '@/locales/en/common.json'
import enAuth from '@/locales/en/auth.json'
import enSettings from '@/locales/en/settings.json'
import enOnboarding from '@/locales/en/onboarding.json'
import trAdmin from '@/locales/tr/admin.json'
import enAdmin from '@/locales/en/admin.json'

export const SUPPORTED_LOCALES = ['tr', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const resources = {
  tr: { common: trCommon, auth: trAuth, settings: trSettings, onboarding: trOnboarding, admin: trAdmin },
  en: { common: enCommon, auth: enAuth, settings: enSettings, onboarding: enOnboarding, admin: enAdmin },
} as const

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: SUPPORTED_LOCALES,
    fallbackLng: 'tr',
    defaultNS: 'common',
    ns: Object.keys(resources.tr),
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'], lookupLocalStorage: 'mt.locale' },
  })

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
})

export default i18n
