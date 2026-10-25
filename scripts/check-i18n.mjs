// Verifies TR/EN locale parity: same namespaces, same keys, same {{placeholders}}.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../src/locales/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const langs = ['tr', 'en']
const files = Object.fromEntries(langs.map((l) => [l, new Set(readdirSync(join(root, l)).filter((f) => f.endsWith('.json')))]))
let errors = 0
const report = (msg) => { console.error('  ✗ ' + msg); errors++ }

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]],
  )
const placeholders = (s) => (s.match(/{{\s*[\w.]+\s*}}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort().join(',')

for (const f of new Set([...files.tr, ...files.en])) {
  for (const l of langs) if (!files[l].has(f)) report(`${l}/${f} missing`)
  if (!files.tr.has(f) || !files.en.has(f)) continue
  const tr = new Map(flatten(JSON.parse(readFileSync(join(root, 'tr', f), 'utf8'))))
  const en = new Map(flatten(JSON.parse(readFileSync(join(root, 'en', f), 'utf8'))))
  for (const k of tr.keys()) if (!en.has(k)) report(`en/${f}: missing key "${k}"`)
  for (const k of en.keys()) if (!tr.has(k)) report(`tr/${f}: missing key "${k}"`)
  for (const [k, v] of tr) {
    if (v.trim() === '') report(`tr/${f}: empty value "${k}"`)
    if (en.has(k) && placeholders(v) !== placeholders(en.get(k))) report(`${f}: placeholder mismatch in "${k}"`)
  }
  for (const [k, v] of en) if (v.trim() === '') report(`en/${f}: empty value "${k}"`)
}
if (errors) { console.error(`\ni18n check failed with ${errors} problem(s).`); process.exit(1) }
console.log('i18n check passed: tr/en in parity.')
