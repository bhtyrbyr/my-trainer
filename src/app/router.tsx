import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './AppShell'
import { UpdatePrompt } from './UpdatePrompt'
import { DevStreakPreview } from './DevStreakPreview'
import { RequireAdmin, RequireAuth, RequireOnboarding, RequirePending } from '@/features/auth/RequireAuth'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { AuthCallbackPage } from '@/features/auth/pages/AuthCallbackPage'
import { AccessDeniedPage } from '@/features/auth/pages/AccessDeniedPage'
import { PendingApprovalPage } from '@/features/auth/pages/PendingApprovalPage'
import { RegistrationRequestsPage } from '@/features/admin/pages/RegistrationRequestsPage'
import { OnboardingPage } from '@/features/profile/pages/OnboardingPage'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { WorkoutsPage } from '@/features/workouts/pages/WorkoutsPage'
import { TrackPage } from '@/features/track/pages/TrackPage'
import { TodayPage } from '@/features/today/pages/TodayPage'
import { LeaderboardPage } from '@/features/leaderboard/pages/LeaderboardPage'
import { SettingsPage } from '@/features/settings/pages/SettingsPage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Dev-only: render gated screens without a session for design verification. Stripped from production builds.
  ...(import.meta.env.DEV
    ? [
        { path: '/__dev/onboarding', element: <OnboardingPage /> },
        { path: '/__dev/pending', element: <PendingApprovalPage preview="pending" /> },
        { path: '/__dev/rejected', element: <PendingApprovalPage preview="rejected" /> },
        { path: '/__dev/update', element: <UpdatePrompt forceVisible /> },
        { path: '/__dev/streak/:n', element: <DevStreakPreview /> },
        {
          path: '/__dev/leaderboard',
          element: (
            <LeaderboardPage
              previewRows={[
                { rank: 1, user_id: 'a', username: 'groogy', display_name: 'Bahtiyar BAYIR', avatar_path: '', points: 845, level: 1, active_days: 6, is_me: false },
                { rank: 2, user_id: 'b', username: 'huseyin_sanlav', display_name: 'Hüseyin Sanlav', avatar_path: '', points: 610, level: 1, active_days: 5, is_me: true },
                { rank: 3, user_id: 'c', username: 'zeynep', display_name: 'Zeynep K.', avatar_path: '', points: 420, level: 1, active_days: 4, is_me: false },
                { rank: 4, user_id: 'd', username: 'mert', display_name: 'Mert A.', avatar_path: '', points: 180, level: 1, active_days: 2, is_me: false },
              ]}
            />
          ),
        },
      ]
    : []),
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
    path: '/pending',
    element: (
      <RequirePending>
        <PendingApprovalPage />
      </RequirePending>
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
      {
        path: 'admin/requests',
        element: (
          <RequireAdmin>
            <RegistrationRequestsPage />
          </RequireAdmin>
        ),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
