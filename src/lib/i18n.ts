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
import trLeaderboard from '@/locales/tr/leaderboard.json'
import enLeaderboard from '@/locales/en/leaderboard.json'
import trExercises from '@/locales/tr/exercises.json'
import enExercises from '@/locales/en/exercises.json'
import trWorkouts from '@/locales/tr/workouts.json'
import enWorkouts from '@/locales/en/workouts.json'
import trBody from '@/locales/tr/body.json'
import enBody from '@/locales/en/body.json'
import trTrack from '@/locales/tr/track.json'
import enTrack from '@/locales/en/track.json'
import trNutrition from '@/locales/tr/nutrition.json'
import enNutrition from '@/locales/en/nutrition.json'

export const SUPPORTED_LOCALES = ['tr', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const resources = {
  tr: { common: trCommon, auth: trAuth, settings: trSettings, onboarding: trOnboarding, admin: trAdmin, leaderboard: trLeaderboard, exercises: trExercises, workouts: trWorkouts, body: trBody, track: trTrack, nutrition: trNutrition },
  en: { common: enCommon, auth: enAuth, settings: enSettings, onboarding: enOnboarding, admin: enAdmin, leaderboard: enLeaderboard, exercises: enExercises, workouts: enWorkouts, body: enBody, track: enTrack, nutrition: enNutrition },
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
// init() may resolve the detected language before the listener above exists; CSS uppercase depends on lang (tr: i -> İ)
if (i18n.resolvedLanguage) document.documentElement.lang = i18n.resolvedLanguage

export default i18n
