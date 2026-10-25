import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './AppShell'
import { UpdatePrompt } from './UpdatePrompt'
import { DevStreakPreview } from './DevStreakPreview'
import { DevLeaderboardPreview } from './DevLeaderboardPreview'
import { DevExerciseDetailPreview, DevExerciseLibraryPreview } from './DevExercisePreview'
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
import { ExerciseLibraryPage } from '@/features/exercises/pages/ExerciseLibraryPage'
import { ExerciseDetailPage } from '@/features/exercises/pages/ExerciseDetailPage'

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
        { path: '/__dev/leaderboard', element: <DevLeaderboardPreview /> },
        {
          path: '/__dev/exercises',
          element: <AppShell />,
          children: [
            { index: true, element: <DevExerciseLibraryPreview /> },
            { path: ':id', element: <DevExerciseDetailPreview /> },
          ],
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
      { path: 'exercises', element: <ExerciseLibraryPage /> },
      { path: 'exercises/:id', element: <ExerciseDetailPage /> },
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
