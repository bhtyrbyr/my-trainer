import brand from './brand.json'

/**
 * Product name and KVKK data-controller details live in brand.json only; the UI (i18n {{app}},
 * {{controller}}, {{email}}), index.html and the PWA manifest all read it, so a rename is a one-file change.
 *
 * Bump legal.noticeVersion when the privacy notice text changes (every user acknowledges it again) and
 * legal.healthConsentVersion when the health-consent wording changes.
 *
 * Do NOT derive technical identifiers from the name: the photo AAD prefix (`my-trainer/photo/v1`),
 * IndexedDB `mt-vault` and the `mt.*` localStorage keys must stay as they are, or existing encrypted
 * photos and device settings stop working.
 */
export const BRAND = brand
export const APP_NAME = brand.appName
export const LEGAL = brand.legal
