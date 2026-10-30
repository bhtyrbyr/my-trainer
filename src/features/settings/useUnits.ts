import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { asLengthUnit, asWeightUnit, createUnitFormat, feetInches } from '@/lib/units'
import { useUserSettings } from './hooks'

/**
 * The user's units (user_settings.unit_weight / unit_length, kg and cm until set) plus formatters and
 * converters bound to them. Values stay metric in storage; use this at display and input only.
 *
 *   const u = useUnits()
 *   `${u.load(set.weight_kg)} ${u.weightLabel}`   // "135 lb"
 *   save({ weight_kg: u.toKg(stepperValue, 'body') })
 */
export function useUnits() {
  const { settings } = useUserSettings()
  const { t, i18n } = useTranslation('common')
  const weight = asWeightUnit(settings?.unit_weight)
  const length = asLengthUnit(settings?.unit_length)
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'tr'

  return useMemo(() => {
    const f = createUnitFormat(weight, length, lang)
    const weightLabel = t(`common:units.${weight}`)
    const lengthLabel = t(`common:units.${length}`)
    return {
      ...f,
      weightLabel,
      lengthLabel,
      /** "178 cm" or "5′ 10″" */
      height: (cm: number) => (length === 'cm' ? `${f.heightCm(cm)} ${lengthLabel}` : t('common:units.feetInches', feetInches(cm))),
    }
  }, [weight, length, lang, t])
}

export type Units = ReturnType<typeof useUnits>
