import { format } from 'date-fns'

/** Local calendar date as YYYY-MM-DD. Never use toISOString() for "today": it is UTC and shifts after 21:00 in Turkey. */
export function toLocalDateISO(d: Date = new Date()): string {
  return format(d, 'yyyy-MM-dd')
}
