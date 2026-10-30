import { supabase } from '@/lib/supabase'
import { toLocalDateISO } from '@/lib/dates'
import { weekSummarySchema, type WeekSummary } from './schema'

/** The caller's week (any day of it; the server normalises to Monday, Istanbul). RLS-scoped, invoker. */
export async function fetchWeekSummary(day: string): Promise<WeekSummary> {
  const { data, error } = await supabase.rpc('get_week_summary', { p_week_start: day })
  if (error) throw error
  return weekSummarySchema.parse(data)
}

/** Finished strength sessions since `sinceISO`, as local day + the body parts of their exercises. */
export async function fetchTrainedParts(sinceISO: string): Promise<{ day: string; parts: string[] }[]> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('started_at, session_exercises(exercises(body_parts))')
    .eq('kind', 'strength')
    .not('ended_at', 'is', null)
    .gte('started_at', sinceISO)
  if (error) throw error
  return (data ?? []).map((s) => ({
    day: toLocalDateISO(new Date(s.started_at)),
    parts: (s.session_exercises ?? []).flatMap((se) => se.exercises?.body_parts ?? []),
  }))
}
