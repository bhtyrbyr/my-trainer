import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import type { ComponentType } from 'react'
import { AppShell } from './AppShell'
import { UpdatePrompt } from './UpdatePrompt'
import { RequireAdmin, RequireAuth, RequireOnboarding, RequirePending } from '@/features/auth/RequireAuth'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { AuthCallbackPage } from '@/features/auth/pages/AuthCallbackPage'
import { AccessDeniedPage } from '@/features/auth/pages/AccessDeniedPage'
import { PendingApprovalPage } from '@/features/auth/pages/PendingApprovalPage'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { HealthGate, NoticeGate } from '@/features/privacy/components/Gates'

/**
 * Route-level code splitting: the shell, auth flow and dashboard ship in the main bundle; every other
 * screen (and heavy deps like Recharts) loads on first visit.
 */
function page<M>(loader: () => Promise<M>, name: keyof M & string): RouteObject['lazy'] {
  return async () => ({ Component: (await loader())[name] as unknown as ComponentType })
}

const workouts = {
  list: page(() => import('@/features/workouts/pages/WorkoutsPage'), 'WorkoutsPage'),
  editor: page(() => import('@/features/workouts/pages/TemplateEditorPage'), 'TemplateEditorPage'),
  live: page(() => import('@/features/workouts/pages/LiveSessionPage'), 'LiveSessionPage'),
  history: page(() => import('@/features/workouts/pages/HistoryPage'), 'HistoryPage'),
  detail: page(() => import('@/features/workouts/pages/SessionDetailPage'), 'SessionDetailPage'),
}
const exercises = {
  library: page(() => import('@/features/exercises/pages/ExerciseLibraryPage'), 'ExerciseLibraryPage'),
  detail: page(() => import('@/features/exercises/pages/ExerciseDetailPage'), 'ExerciseDetailPage'),
}
const body = page(() => import('@/features/body/pages/BodyPage'), 'BodyPage')
const nutrition = page(() => import('@/features/nutrition/pages/NutritionPage'), 'NutritionPage')
const sleepWater = page(() => import('@/features/sleepwater/pages/SleepWaterPage'), 'SleepWaterPage')
const photos = page(() => import('@/features/photos/pages/PhotosPage'), 'PhotosPage')
const devBody = (name: 'DevBodyLayout' | 'DevTrack' | 'DevBody' | 'DevNutrition' | 'DevSleepWater') => page(() => import('@/features/body/dev/DevBodyPreview'), name)
const onboarding = page(() => import('@/features/profile/pages/OnboardingPage'), 'OnboardingPage')

const devWorkouts = (name: 'DevWorkoutsLayout' | 'DevDashboard' | 'DevTemplateEditor' | 'DevLiveSession' | 'DevSessionDetail') =>
  page(() => import('@/features/workouts/dev/DevWorkoutsPreview'), name)

/** Dev-only previews with sample data: DEV-gated and lazy, so they never reach the production bundle. */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      { path: '/__dev/onboarding', lazy: onboarding },
      { path: '/__dev/pending', element: <PendingApprovalPage preview="pending" /> },
      { path: '/__dev/rejected', element: <PendingApprovalPage preview="rejected" /> },
      { path: '/__dev/update', element: <UpdatePrompt forceVisible /> },
      { path: '/__dev/errors', lazy: page(() => import('./DevErrorsPreview'), 'DevErrorsPreview') },
      { path: '/__dev/streak/:n', lazy: page(() => import('./DevStreakPreview'), 'DevStreakPreview') },
      { path: '/__dev/leaderboard', lazy: page(() => import('./DevLeaderboardPreview'), 'DevLeaderboardPreview') },
      {
        path: '/__dev/exercises',
        element: <AppShell />,
        children: [
          { index: true, lazy: page(() => import('./DevExercisePreview'), 'DevExerciseLibraryPreview') },
          { path: ':id', lazy: page(() => import('./DevExercisePreview'), 'DevExerciseDetailPreview') },
        ],
      },
      {
        path: '/__dev/ai-usage',
        element: <AppShell />,
        children: [{ index: true, lazy: page(() => import('@/features/admin/dev/DevAiUsagePreview'), 'DevAiUsagePreview') }],
      },
      {
        // body metrics with sample data: ?empty=1 for a user without entries
        path: '/__dev/track',
        lazy: devBody('DevBodyLayout'),
        children: [
          { index: true, lazy: devBody('DevTrack') },
          { path: 'body', lazy: devBody('DevBody') },
          { path: 'nutrition', lazy: devBody('DevNutrition') },
          { path: 'sleep-water', lazy: devBody('DevSleepWater') },
        ],
      },
      {
        // workouts with sample data: ?today=plan|rest|none|active, session ?state=entry|first|rest|empty|summary
        path: '/__dev/workouts',
        lazy: devWorkouts('DevWorkoutsLayout'),
        children: [
          { index: true, lazy: workouts.list },
          { path: 'dashboard', lazy: devWorkouts('DevDashboard') },
          { path: 'plan', lazy: devWorkouts('DevTemplateEditor') },
          { path: 'session', lazy: devWorkouts('DevLiveSession') },
          { path: 'history', lazy: workouts.history },
          { path: 'detail', lazy: devWorkouts('DevSessionDetail') },
        ],
      },
    ]
  : []

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // public: the privacy notice must be readable before signing in
  { path: '/privacy', lazy: page(() => import('@/features/privacy/pages/PrivacyNoticePage'), 'PrivacyNoticePage') },
  ...devRoutes,
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/denied', element: <AccessDeniedPage /> },
  {
    path: '/onboarding',
    element: <RequireOnboarding />,
    children: [{ index: true, lazy: onboarding }],
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
        <NoticeGate>
          <AppShell />
        </NoticeGate>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'workouts', lazy: workouts.list },
      { path: 'workouts/plans/new', lazy: workouts.editor },
      { path: 'workouts/plans/:id', lazy: workouts.editor },
      { path: 'workouts/session/:id', lazy: workouts.live },
      { path: 'workouts/history', lazy: workouts.history },
      { path: 'workouts/history/:id', lazy: workouts.detail },
      { path: 'exercises', lazy: exercises.library },
      { path: 'exercises/:id', lazy: exercises.detail },
      { path: 'track', lazy: page(() => import('@/features/track/pages/TrackPage'), 'TrackPage') },
      {
        // health data (KVKK art. 6): explicit consent before these screens
        element: <HealthGate />,
        children: [
          { path: 'track/body', lazy: body },
          { path: 'track/nutrition', lazy: nutrition },
          { path: 'track/sleep-water', lazy: sleepWater },
          { path: 'track/photos', lazy: photos },
        ],
      },
      { path: 'track/habits', lazy: page(() => import('@/features/today/pages/HabitsPage'), 'HabitsPage') },
      { path: 'track/todos', lazy: page(() => import('@/features/today/pages/TodosPage'), 'TodosPage') },
      { path: 'today', element: <Navigate to="/track" replace /> },
      { path: 'leaderboard', lazy: page(() => import('@/features/leaderboard/pages/LeaderboardPage'), 'LeaderboardPage') },
      { path: 'settings', lazy: page(() => import('@/features/settings/pages/SettingsPage'), 'SettingsPage') },
      {
        path: 'admin/error-reports',
        lazy: async () => {
          const { ErrorReportsPage } = await import('@/features/admin/pages/ErrorReportsPage')
          return {
            Component: () => (
              <RequireAdmin>
                <ErrorReportsPage />
              </RequireAdmin>
            ),
          }
        },
      },
      {
        path: 'admin/ai-usage',
        lazy: async () => {
          const { AiUsagePage } = await import('@/features/admin/pages/AiUsagePage')
          return {
            Component: () => (
              <RequireAdmin>
                <AiUsagePage />
              </RequireAdmin>
            ),
          }
        },
      },
      {
        path: 'admin/requests',
        lazy: async () => {
          const { RegistrationRequestsPage } = await import('@/features/admin/pages/RegistrationRequestsPage')
          return {
            Component: () => (
              <RequireAdmin>
                <RegistrationRequestsPage />
              </RequireAdmin>
            ),
          }
        },
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
