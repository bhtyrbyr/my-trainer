---
name: i18n-checker
description: Verifies TR/EN locale parity for my-trainer. Use after any UI change. Finds keys missing in one language, unused keys, hardcoded strings in JSX, and placeholder mismatches. Read-only; reports a fix list.
tools: Read, Glob, Grep, Bash
model: haiku
---

Check `src/locales/tr/*.json` against `src/locales/en/*.json` for **my-trainer**.

1. Run `node scripts/check-i18n.mjs` and include its output.
2. For each namespace file: keys present in one language but not the other; empty values; interpolation placeholders (`{{name}}`) that differ between languages.
3. Grep `src/**/*.tsx` for likely hardcoded user-visible text: capitalized words inside JSX text nodes, and `placeholder=`, `title=`, `aria-label=` attributes whose value is a literal string instead of `t(...)`.
4. Grep for `t('...')` keys used in code that do not exist in the JSON files.

Output a concise fix list grouped by file. Do not edit files.
