import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './AppShell'
import { UpdatePrompt } from './UpdatePrompt'
import { DevStreakPreview } from './DevStreakPreview'
import { DevLeaderboardPreview } from './DevLeaderboardPreview'
import { RequireAdmin, RequireAuth, RequireOnboarding, RequirePending } from '@/features/auth/RequireAuth'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { AuthCallbackPage } from '@/features/auth/pages/AuthCallbackPage'
import { AccessDeniedPage } from '@/features/auth/pages/AccessDeniedPage'
import { PendingApprovalPage } from '@/features/auth/pages/PendingApprovalPage'
import { RegistrationRequestsPage } from '@/features/admin/pages/RegistrationRequestsPage'
import { OnboardingPage } from '@/features/profile/pages/OnboardingPage'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { WorkoutsPage } from '@/features/workouts/pages/WorkoutsPage'
import { TemplateEditorPage } from '@/features/workouts/pages/TemplateEditorPage'
import { LiveSessionPage } from '@/features/workouts/pages/LiveSessionPage'
import { HistoryPage } from '@/features/workouts/pages/HistoryPage'
import { SessionDetailPage } from '@/features/workouts/pages/SessionDetailPage'

type DevWorkouts = typeof import('@/features/workouts/dev/DevWorkoutsPreview')
/** Dev-only: loaded lazily so the sample data never reaches the production bundle. */
const devWorkouts = (name: keyof DevWorkouts) => async () => ({
  Component: (await import('@/features/workouts/dev/DevWorkoutsPreview'))[name],
})
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
        { path: '/__dev/leaderboard', element: <DevLeaderboardPreview /> },
        {
          // workouts with sample data: ?today=plan|rest|none|active, session ?state=entry|rest|empty|summary
          path: '/__dev/workouts',
          lazy: devWorkouts('DevWorkoutsLayout'),
          children: [
            { index: true, element: <WorkoutsPage /> },
            { path: 'dashboard', lazy: devWorkouts('DevDashboard') },
            { path: 'plan', lazy: devWorkouts('DevTemplateEditor') },
            { path: 'session', lazy: devWorkouts('DevLiveSession') },
            { path: 'history', element: <HistoryPage /> },
            { path: 'detail', lazy: devWorkouts('DevSessionDetail') },
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
      { path: 'workouts/plans/new', element: <TemplateEditorPage /> },
      { path: 'workouts/plans/:id', element: <TemplateEditorPage /> },
      { path: 'workouts/session/:id', element: <LiveSessionPage /> },
      { path: 'workouts/history', element: <HistoryPage /> },
      { path: 'workouts/history/:id', element: <SessionDetailPage /> },
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
