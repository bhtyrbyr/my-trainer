import { useCallback, useSyncExternalStore } from 'react'
import { onlineManager, useMutation, useMutationState, type MutateOptions, type MutationKey, type UseMutationOptions } from '@tanstack/react-query'
import { failureKind, isQueuedMutation, QUEUE_ROOT, type QueuedOp } from './queue'

/** Queued (pending or failed) writes of one feature, in submission order. Stable between renders while unchanged. */
export function useQueuedOps<V>(feature: string): QueuedOp<V>[] {
  return useMutationState({
    filters: { mutationKey: [QUEUE_ROOT, feature], predicate: (m) => m.state.status === 'pending' || m.state.status === 'error' },
    select: (m) => ({
      mutationId: m.mutationId,
      op: String(m.options.mutationKey?.[2] ?? ''),
      vars: m.state.variables as V,
      status: m.state.status as 'pending' | 'error',
    }),
  })
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  )
}

export type SyncState = {
  online: boolean
  /** writes waiting or being sent */
  pending: number
  /** writes the server rejected (or that ran out of retries): the user decides */
  failed: number
  /** online but the head of the queue keeps failing on the network (weak signal) */
  struggling: boolean
}

export function useSyncState(): SyncState {
  const online = useOnline()
  const rows = useMutationState({
    filters: { predicate: isQueuedMutation },
    select: (m) => `${m.state.status}:${m.state.failureCount > 0 && failureKind(m.state.failureReason) === 'network' ? 1 : 0}`,
  })
  let pending = 0
  let failed = 0
  let struggling = false
  for (const r of rows) {
    if (r.startsWith('pending')) {
      pending++
      if (r.endsWith(':1')) struggling = true
    } else if (r.startsWith('error')) failed++
  }
  return { online, pending, failed, struggling }
}

/**
 * useMutation for a queued write. `mutate` takes the screen's input and stamps it with a client id,
 * the owner and the time (`stamp`). `isPending` is true only while the first attempt is on the wire:
 * a write that waits for the network is the queue's business (offline banner), not the button's.
 * In preview mode (`previewOptions`) the write never touches the queue or the backend.
 */
export function useQueuedMutation<TData, TInput, TVars>(
  key: MutationKey,
  stamp: (input: TInput) => TVars,
  previewOptions?: UseMutationOptions<TData, Error, TVars>,
) {
  const m = useMutation<TData, Error, TVars>(previewOptions ?? { mutationKey: key })
  const { mutate: rawMutate } = m
  const mutate = useCallback(
    (input: TInput, opts?: MutateOptions<TData, Error, TVars>) => {
      const vars = stamp(input)
      rawMutate(vars, opts)
      return vars
    },
    [rawMutate, stamp],
  )
  const sending = m.isPending && !m.isPaused && m.failureCount === 0
  return { ...m, mutate, isPending: sending, queued: m.isPending && !sending }
}
