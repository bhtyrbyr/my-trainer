import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { vocabKey } from './name'

type Kind = 'bodyPart' | 'muscle' | 'equipment'

/**
 * Localised labels for catalog vocabulary (`exercises:bodyPart.*`, `muscle.*`, `equipment.*`).
 * Unknown values (custom exercises, a new source term) fall back to the raw value with a capital letter.
 */
export function useVocab() {
  const { t } = useTranslation('exercises')
  const label = useCallback(
    (kind: Kind, name: string) => {
      const fallback = name.charAt(0).toLocaleUpperCase() + name.slice(1)
      const key = vocabKey(name)
      return key ? t(`${kind}.${key}`, { defaultValue: fallback }) : fallback
    },
    [t],
  )
  return useMemo(
    () => ({
      bodyPart: (name: string) => label('bodyPart', name),
      muscle: (name: string) => label('muscle', name),
      equipment: (name: string) => label('equipment', name),
    }),
    [label],
  )
}
