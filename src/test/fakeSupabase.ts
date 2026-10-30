// Minimal in-memory stand-in for the supabase-js calls the offline-queue api functions make
// (insert/upsert/delete/select by equality, rpc). Enough to test idempotent replays; not a PostgREST.
type Row = Record<string, unknown>
type Result = { data: unknown; error: { code?: string; message: string } | null }

export function createFakeSupabase() {
  const tables = new Map<string, Row[]>()
  const rpcs = new Map<string, (args: Row) => Result>()
  /** per-table hook that can reject an insert like a DB trigger would (return an error to reject) */
  const guards = new Map<string, (row: Row, rows: Row[]) => Result['error']>()
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, [])
    return tables.get(name)!
  }

  function query(name: string, filters: [string, unknown][] = []) {
    const rows = () => table(name).filter((r) => filters.every(([c, v]) => r[c] === v))
    const self = {
      eq: (col: string, val: unknown) => query(name, [...filters, [col, val]]),
      order: () => self,
      single: async (): Promise<Result> => {
        const r = rows()
        return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not found' } }
      },
      then: (ok: (r: Result) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok, ko),
    }
    return self
  }

  const single = (result: Result) => ({ select: () => ({ single: async () => result }) })

  const client = {
    from(name: string) {
      return {
        insert(row: Row) {
          const rows = table(name)
          const guardError = guards.get(name)?.(row, rows)
          if (guardError) return single({ data: null, error: guardError })
          if (rows.some((r) => r.id === row.id)) return single({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
          const stored = { id: row.id ?? `srv-${rows.length + 1}`, ...row }
          rows.push(stored)
          return single({ data: stored, error: null })
        },
        upsert(row: Row, opts: { onConflict: string }) {
          const cols = opts.onConflict.split(',')
          const rows = table(name)
          const existing = rows.find((r) => cols.every((c) => r[c] === row[c]))
          const stored = existing ? Object.assign(existing, row) : { id: `srv-${rows.length + 1}`, ...row }
          if (!existing) rows.push(stored)
          return single({ data: stored, error: null })
        },
        delete() {
          const filters: [string, unknown][] = []
          const self = {
            eq(col: string, val: unknown) {
              filters.push([col, val])
              return self
            },
            then(ok: (r: Result) => unknown) {
              tables.set(
                name,
                table(name).filter((r) => !filters.every(([c, v]) => r[c] === v)),
              )
              return Promise.resolve({ data: null, error: null }).then(ok)
            },
          }
          return self
        },
        select: () => query(name),
      }
    },
    rpc: async (fn: string, args: Row): Promise<Result> => rpcs.get(fn)?.(args) ?? { data: null, error: { message: `no rpc ${fn}` } },
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  }
  return { client, tables, table, rpcs, guards }
}
