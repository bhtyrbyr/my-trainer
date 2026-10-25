import { useLayoutEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'

/** Every route change (tab switch or in-app link) starts at the top of the page. */
function ScrollToTop() {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

/**
 * App frame. Mobile (iPhone 16 primary): full-height column with a fixed bottom tab bar.
 * Desktop (>= lg): same screens, content centered with the nav docked at the bottom of a narrower column
 * or as a left rail. Keeps one codebase for both targets.
 */
export function AppShell() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col lg:max-w-5xl lg:flex-row">
      <ScrollToTop />
      <BottomNav />
      <main className="flex-1 pb-nav lg:pb-0">
        <Outlet />
      </main>
    </div>
  )
}
