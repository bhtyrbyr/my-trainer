// Queued water writes (offline queue, src/lib/offline) and the pure overlay for the day's list.
import { queuedKey, type QueuedOp, type QueuedVars } from '@/lib/offline/queue'
import type { WaterEntry } from './types'

export const waterQueue = {
  add: queuedKey('sleepwater', 'addWater'),
  remove: queuedKey('sleepwater', 'deleteWater'),
}

export type AddWaterVars = QueuedVars & { id: string; day: string; ml: number }
export type DeleteWaterVars = QueuedVars & { id: string; day: string }
export type WaterVars = AddWaterVars | DeleteWaterVars

export function pendingWaterRow(v: AddWaterVars): WaterEntry {
  return { id: v.id, user_id: v.userId, drunk_on: v.day, amount_ml: v.ml, logged_at: v.at, created_at: v.at }
}

/** The day's drinks with queued adds/removes applied in order (ids make replays no-ops). */
export function applyWaterOps(rows: WaterEntry[] | undefined, day: string, ops: readonly QueuedOp<WaterVars>[]): WaterEntry[] | undefined {
  const mine = ops.filter((o) => o.vars.day === day)
  if (!mine.length) return rows
  let out = rows ?? []
  for (const { op, vars } of mine) {
    if (op === 'addWater') {
      if (!out.some((r) => r.id === vars.id)) out = [...out, pendingWaterRow(vars as AddWaterVars)]
    } else if (op === 'deleteWater') out = out.filter((r) => r.id !== vars.id)
  }
  return out
}
