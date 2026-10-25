import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequireAuth, RequireOnboarding } from '@/features/auth/RequireAuth'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { AuthCallbackPage } from '@/features/auth/pages/AuthCallbackPage'
import { AccessDeniedPage } from '@/features/auth/pages/AccessDeniedPage'
import { OnboardingPage } from '@/features/profile/pages/OnboardingPage'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { WorkoutsPage } from '@/features/workouts/pages/WorkoutsPage'
import { TrackPage } from '@/features/track/pages/TrackPage'
import { TodayPage } from '@/features/today/pages/TodayPage'
import { LeaderboardPage } from '@/features/leaderboard/pages/LeaderboardPage'
import { SettingsPage } from '@/features/settings/pages/SettingsPage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/denied', element: <AccessDeniedPage /> },
  {
    path: '/onboarding',
    element: (
      <RequireOnboarding>
        <OnboardingPage />
      </RequireOnboarding>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'workouts', element: <WorkoutsPage /> },
      { path: 'track', element: <TrackPage /> },
      { path: 'today', element: <TodayPage /> },
      { path: 'leaderboard', element: <LeaderboardPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
