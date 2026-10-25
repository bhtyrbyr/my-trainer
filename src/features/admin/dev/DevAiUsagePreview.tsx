import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { adminKeys } from '../hooks'
import { dayIn, QUOTA_TZ, type UsageRow } from '../aiUsageLogic'
import { AiUsagePage } from '../pages/AiUsagePage'

/** Dev-only: the AI usage dashboard with 30 days of sample rows (queries stay disabled without an admin session). */
function seed() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  const today = dayIn(QUOTA_TZ)
  const [y, m, d] = today.split('-').map(Number)
  const rows: UsageRow[] = []
  const people = [
    ['u1', 'bahtiyar', 'Bahtiyar'],
    ['u2', 'ayse', 'Ayşe'],
  ] as const
  for (let i = 0; i < 30; i++) {
    const day = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10)
    people.forEach(([id, username, name], k) => {
      const req = Math.max(0, Math.round(4 + 3 * Math.sin(i / 3 + k) + (i % 7 === 5 ? 6 : 0)))
      if (req === 0) return
      rows.push({ day_pt: day, user_id: id, username, display_name: name, action: k ? 'food_estimate_photo' : 'food_estimate_text', model: 'gemini-3.8-flash', requests: req, failed: i === 3 && k === 0 ? 1 : 0, prompt_tokens: req * (k ? 1400 : 320), output_tokens: req * 180, total_tokens: req * (k ? 1580 : 500) })
    })
  }
  rows.push({ day_pt: today, user_id: null, username: null, display_name: null, action: 'catalog_translate', model: 'gemini-3.5-flash-lite', requests: 19, failed: 0, prompt_tokens: 61000, output_tokens: 22000, total_tokens: 83000 })
  for (const days of [7, 30, 90]) qc.setQueryData(adminKeys.aiUsage(days), rows)
  qc.setQueryData(adminKeys.aiLive, [
    { model: 'gemini-3.8-flash', requests_today: 9, tokens_today: 8600, requests_last_minute: 1, tokens_last_minute: 1580 },
    { model: 'gemini-3.5-flash-lite', requests_today: 19, tokens_today: 83000, requests_last_minute: 0, tokens_last_minute: 0 },
  ])
  qc.setQueryData(adminKeys.aiApp, { used: 9, limit: 200 })
  qc.setQueryData(adminKeys.aiLimits, { 'gemini-3.8-flash': { rpm: 10, tpm: 250000, rpd: 250 }, 'gemini-3.5-flash-lite': { rpm: 15, tpm: 250000, rpd: 1000 } })
  return qc
}

export function DevAiUsagePreview() {
  const [client] = useState(seed)
  return (
    <QueryClientProvider client={client}>
      <AiUsagePage />
    </QueryClientProvider>
  )
}
