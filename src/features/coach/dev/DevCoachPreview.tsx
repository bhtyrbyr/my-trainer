// DEV ONLY (registered under /__dev/coach in router.tsx behind import.meta.env.DEV).
// The coach against a seeded query cache: sending appends locally and a canned reply arrives after
// ?delay ms. Nothing is written to Supabase and no model is called.
//   ?consent=0 consent card · ?blocked=user_daily|app_daily|google_daily|google_minute · ?empty=1
//   ?fail=AI_UNDERAGE|COACH_AI_UNAVAILABLE|COACH_AI_QUOTA · ?delay=1800 · ?left=37
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/app/AppShell'
import { useAuth } from '@/features/auth/AuthProvider'
import { NutritionPreviewContext, nutritionKeys, type AiAvailability } from '@/features/nutrition'
import { settingsKeys } from '@/features/settings/hooks'
import type { UserSettings } from '@/lib/database.types'
import { coachKeys } from '../hooks'
import { CoachPreviewContext, type CoachPreview } from '../previewContext'
import type { CoachMessage, Conversation } from '../schema'

const REPLY_TR = `Güzel bir hafta: **3 antrenman**, 46 set ve yaklaşık 9,2 ton hacim. Geçen haftadan bir antrenman fazla.

İyi gidenler:
- Göğüs ve bacak düzenli çalışılmış, bench press'te yeni rekorun var.
- Alışkanlıklarda planlı günlerin %86'sını tamamlamışsın.

Geliştirebileceklerin:
- Sırtı en son 6 gün önce çalıştın; yarın çekiş ağırlıklı bir gün iyi olur.
- Uyku ortalaman 7 saat 17 dakika; 7,5 saate çıkmak toparlanmayı hızlandırır.

Gelecek hafta için:
1. 3 antrenmanı koru, birini sırt günü yap.
2. Her gün en az 130 g protein hedefle.
3. Hafta içi iki gece 23:30'dan önce yat.`

const REPLY_EN = `A solid week: **3 workouts**, 46 sets and about 9.2 t of volume, one more workout than last week.

What went well:
- Chest and legs were trained regularly, with a new bench press record.
- You completed 86% of your planned habit days.

What to improve:
- Back was last trained 6 days ago; a pull-focused day tomorrow fits.
- Sleep averaged 7 h 17 min; getting to 7.5 h helps recovery.

For next week:
1. Keep 3 workouts and make one a back day.
2. Aim for at least 130 g protein a day.
3. Be in bed before 23:30 on two weeknights.`

function seed(params: URLSearchParams, userId: string, en: boolean): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnMount: false } },
  })
  const now = Date.now()
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()
  const empty = params.get('empty') === '1'

  const conversations: Conversation[] = empty
    ? []
    : [
        { id: 'c1', title: en ? 'Can you review my week?' : 'Haftamı değerlendirir misin?', created_at: at(40), updated_at: at(38) },
        { id: 'c2', title: en ? 'What should I train tomorrow?' : 'Yarın ne çalışayım?', created_at: at(60 * 26), updated_at: at(60 * 26) },
        { id: 'c3', title: en ? 'How can I get more protein?' : 'Proteinimi nasıl artırırım?', created_at: at(60 * 24 * 4), updated_at: at(60 * 24 * 4) },
      ]
  qc.setQueryData(coachKeys.conversations, conversations)
  const msg = (id: string, role: CoachMessage['role'], content: string, minutesAgo: number): CoachMessage => ({ id, role, content, created_at: at(minutesAgo) })
  qc.setQueryData<CoachMessage[]>(coachKeys.messages('c1'), [
    msg('m1', 'user', en ? 'Can you review my week? What went well, what could I improve? Suggest 2-3 concrete goals for next week.' : 'Haftamı değerlendirir misin? Neler iyi gitti, neyi geliştirebilirim? Gelecek hafta için 2-3 somut hedef öner.', 40),
    msg('m2', 'assistant', en ? REPLY_EN : REPLY_TR, 39),
    msg('m3', 'user', en ? 'My shoulder hurts a bit on bench press, what should I do?' : 'Bench press yaparken omzum biraz ağrıyor, ne yapayım?', 38.5),
    msg(
      'm4',
      'assistant',
      en
        ? 'Pain is a signal to stop, not to push through. Skip bench press until it is checked, and see a doctor or physiotherapist, especially if it lasts more than a few days or gets worse.\n\nUntil then you can keep training what does not hurt, for example legs and core.'
        : 'Ağrı, zorlamak için değil durmak için bir işaret. Kontrol ettirene kadar bench press’e ara ver ve özellikle birkaç günden uzun sürer ya da artarsa bir doktora veya fizyoterapiste görün.\n\nO zamana kadar ağrı yapmayan bölgeleri, örneğin bacak ve core çalışmaya devam edebilirsin.',
      38,
    ),
  ])
  qc.setQueryData<CoachMessage[]>(coachKeys.messages('c2'), [
    msg('n1', 'user', en ? 'What should I train tomorrow?' : 'Yarın ne çalışayım?', 60 * 26),
    msg('n2', 'assistant', en ? 'Back has rested longest (6 days). Tomorrow: rows, pull-ups or lat pulldown, and face pulls, 3-4 sets each.' : 'En uzun dinlenen bölgen sırt (6 gün). Yarın: row, barfiks ya da lat pulldown ve face pull, her biri 3-4 set.', 60 * 26),
  ])
  // last question without a reply: the retry state
  qc.setQueryData<CoachMessage[]>(coachKeys.messages('c3'), [msg('p1', 'user', en ? 'How can I get more protein?' : 'Proteinimi nasıl artırırım?', 60 * 24 * 4)])

  const blocked = params.get('blocked') as AiAvailability['reason'] | null
  const resets = new Date(now)
  resets.setHours(24, 0, 0, 0)
  qc.setQueryData<AiAvailability>(nutritionKeys.ai, {
    available: !blocked,
    reason: blocked ?? 'ok',
    resets_at: blocked ? resets.toISOString() : null,
    user_left: blocked === 'user_daily' ? 0 : Number(params.get('left') ?? 37),
  })
  qc.setQueryData(['consents'], [
    { kind: 'privacy_notice', version: 'preview', granted: true, created_at: at(9999) },
    { kind: 'ai_processing', version: 'preview', granted: params.get('consent') !== '0', created_at: at(9999) },
  ])
  if (userId) {
    qc.setQueryData(settingsKeys.me(userId), { user_id: userId, locale: en ? 'en' : 'tr', theme: 'system', daily_water_ml: 2500, unit_weight: 'kg', unit_length: 'cm' } as UserSettings)
  }
  return qc
}

/** Layout route: sample cache + preview contexts + the normal app frame (tab bar). */
export function DevCoachLayout() {
  const [params] = useSearchParams()
  const { user } = useAuth()
  const en = document.documentElement.lang === 'en'
  const [client] = useState(() => seed(params, user?.id ?? '', en))
  const [preview] = useState<CoachPreview>(() => ({
    reply: en ? REPLY_EN : REPLY_TR,
    delayMs: Number(params.get('delay') ?? 1800),
    fail: params.get('fail') ?? undefined,
    base: '/__dev',
  }))
  return (
    <QueryClientProvider client={client}>
      <NutritionPreviewContext.Provider value={true}>
        <CoachPreviewContext.Provider value={preview}>
          <AppShell />
        </CoachPreviewContext.Provider>
      </NutritionPreviewContext.Provider>
    </QueryClientProvider>
  )
}
