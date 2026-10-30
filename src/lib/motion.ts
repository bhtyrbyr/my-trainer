import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(cb: () => void) {
  const mq = window.matchMedia?.(QUERY)
  mq?.addEventListener('change', cb)
  return () => mq?.removeEventListener('change', cb)
}

/** Live `prefers-reduced-motion: reduce` (follows the OS switch without a reload). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => Boolean(window.matchMedia?.(QUERY).matches),
    () => false,
  )
}

/** Whether the element is (near) the viewport; true where IntersectionObserver is unavailable. */
export function useInView(ref: RefObject<Element | null>, rootMargin = '64px'): boolean {
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, rootMargin])
  return inView
}
