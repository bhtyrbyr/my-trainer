/**
 * Third-party notices shown on /settings/licenses (see docs/LICENSING.md).
 * Content sources carry translated copy (licenses:sources.<id>.*); fonts and libraries are proper
 * names with SPDX licence ids, so they live here as data.
 */

export const LICENSE_TEXTS = {
  MIT: 'https://opensource.org/license/mit',
  ISC: 'https://opensource.org/license/isc-license-txt',
  'Apache-2.0': 'https://www.apache.org/licenses/LICENSE-2.0',
  'OFL-1.1': 'https://openfontlicense.org/open-font-license-official-text/',
} as const

export type LicenseId = keyof typeof LICENSE_TEXTS

export const LICENSE_NAMES: Record<LicenseId, string> = {
  MIT: 'MIT',
  ISC: 'ISC',
  'Apache-2.0': 'Apache 2.0',
  'OFL-1.1': 'SIL OFL 1.1',
}

/** Data and artwork the app shows; title, holder, licence wording and notes come from the locale files. */
export type SourceNotice = { id: string; url: string; licenseUrl: string }

export const SOURCE_GROUPS: { id: 'exercises' | 'food'; items: SourceNotice[] }[] = [
  {
    id: 'exercises',
    items: [
      { id: 'wger', url: 'https://wger.de', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      { id: 'workoutGuide', url: 'https://github.com/bryllim/workout-guide', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      { id: 'muscles', url: 'https://commons.wikimedia.org/wiki/File:Muscular_system.svg', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/' },
    ],
  },
  {
    id: 'food',
    items: [
      { id: 'usda', url: 'https://fdc.nal.usda.gov', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
      { id: 'off', url: 'https://world.openfoodfacts.org', licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/' },
    ],
  },
]

/** Bundled software and fonts: name, copyright holder, licence. */
export type SoftwareNotice = { name: string; holder: string; license: LicenseId; url: string }

export const FONTS: SoftwareNotice[] = [
  { name: 'Inter', holder: 'The Inter Project Authors (Rasmus Andersson)', license: 'OFL-1.1', url: 'https://github.com/rsms/inter' },
  { name: 'Bricolage Grotesque', holder: 'The Bricolage Grotesque Project Authors (Mathieu Triay)', license: 'OFL-1.1', url: 'https://github.com/ateliertriay/bricolage' },
]

export const LIBRARIES: SoftwareNotice[] = [
  { name: 'React', holder: 'Meta Platforms, Inc. and affiliates', license: 'MIT', url: 'https://github.com/facebook/react' },
  { name: 'TanStack Query', holder: 'Tanner Linsley', license: 'MIT', url: 'https://github.com/TanStack/query' },
  { name: 'React Router', holder: 'Remix Software Inc.', license: 'MIT', url: 'https://github.com/remix-run/react-router' },
  { name: 'i18next, react-i18next', holder: 'i18next authors', license: 'MIT', url: 'https://github.com/i18next/i18next' },
  { name: 'Recharts', holder: 'recharts contributors', license: 'MIT', url: 'https://github.com/recharts/recharts' },
  { name: 'hash-wasm', holder: 'Dani Biró', license: 'MIT', url: 'https://github.com/Daninet/hash-wasm' },
  { name: 'supabase-js', holder: 'Supabase', license: 'MIT', url: 'https://github.com/supabase/supabase-js' },
  { name: 'date-fns', holder: 'Sasha Koss, Lesha Koss', license: 'MIT', url: 'https://github.com/date-fns/date-fns' },
  { name: 'Zod', holder: 'Colin McDonnell', license: 'MIT', url: 'https://github.com/colinhacks/zod' },
  { name: 'React Hook Form', holder: 'Beier (Bill) Luo', license: 'MIT', url: 'https://github.com/react-hook-form/react-hook-form' },
  { name: 'Tailwind CSS', holder: 'Tailwind Labs, Inc.', license: 'MIT', url: 'https://github.com/tailwindlabs/tailwindcss' },
  { name: 'Workbox', holder: 'Google LLC', license: 'MIT', url: 'https://github.com/GoogleChrome/workbox' },
  { name: 'clsx', holder: 'Luke Edwards', license: 'MIT', url: 'https://github.com/lukeed/clsx' },
  { name: 'tailwind-merge', holder: 'Dany Castillo', license: 'MIT', url: 'https://github.com/dcastil/tailwind-merge' },
  { name: 'class-variance-authority', holder: 'Joe Bell', license: 'Apache-2.0', url: 'https://github.com/joe-bell/cva' },
  { name: 'Lucide', holder: 'Lucide Contributors', license: 'ISC', url: 'https://github.com/lucide-icons/lucide' },
]
