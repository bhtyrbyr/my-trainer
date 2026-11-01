import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import type { ComponentType } from 'react'
import { AppShell } from './AppShell'
import { UpdatePrompt } from './UpdatePrompt'
import { RequireAdmin, RequireAuth, RequireOnboarding, RequirePending } from '@/features/auth/RequireAuth'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { AuthCallbackPage } from '@/features/auth/pages/AuthCallbackPage'
import { AccessDeniedPage } from '@/features/auth/pages/AccessDeniedPage'
import { PendingApprovalPage } from '@/features/auth/pages/PendingApprovalPage'
import { HealthGate, NoticeGate } from '@/features/privacy/components/Gates'
import { TourGate } from '@/features/tour/components/TourGate'

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

const coach = {
  list: page(() => import('@/features/coach/pages/CoachPage'), 'CoachPage'),
  chat: page(() => import('@/features/coach/pages/ChatPage'), 'ChatPage'),
}
const devHome = (name: 'DevHomeLayout' | 'DevHome') => page(() => import('@/features/dashboard/dev/DevDashboardPreview'), name)
const devProfile = (name: 'DevProfileLayout' | 'DevProfile') => page(() => import('@/features/badges/dev/DevBadgesPreview'), name)
const social = {
  home: page(() => import('@/features/social/pages/SocialPage'), 'SocialPage'),
  notifications: page(() => import('@/features/social/pages/NotificationsPage'), 'NotificationsPage'),
  user: page(() => import('@/features/social/pages/UserProfilePage'), 'UserProfilePage'),
  list: page(() => import('@/features/social/pages/FollowListPage'), 'FollowListPage'),
  post: page(() => import('@/features/social/pages/PostPage'), 'PostPage'),
  group: page(() => import('@/features/social/pages/GroupPage'), 'GroupPage'),
  groupSettings: page(() => import('@/features/social/pages/GroupSettingsPage'), 'GroupSettingsPage'),
  join: page(() => import('@/features/social/pages/JoinByCodePage'), 'JoinByCodePage'),
  settings: page(() => import('@/features/social/pages/SocialSettingsPage'), 'SocialSettingsPage'),
  search: page(() => import('@/features/social/pages/SearchPage'), 'SearchPage'),
  ranking: page(() => import('@/features/social/pages/RankingPage'), 'RankingPage'),
  tag: page(() => import('@/features/social/pages/TagPage'), 'TagPage'),
}
const devSocial = (name: 'DevSocialLayout') => page(() => import('@/features/social/dev/DevSocialPreview'), name)

const admin = {
  access: page(() => import('@/features/admin/pages/AccessPage'), 'AccessPage'),
  users: page(() => import('@/features/admin/pages/UsersPage'), 'UsersPage'),
}

/** Admin-only page: lazy component wrapped in RequireAdmin (the RPCs refuse non-admins anyway). */
function adminPage<M>(loader: () => Promise<M>, name: keyof M & string): RouteObject['lazy'] {
  return async () => {
    const Page = (await loader())[name] as unknown as ComponentType
    return {
      Component: () => (
        <RequireAdmin>
          <Page />
        </RequireAdmin>
      ),
    }
  }
}

const devWorkouts = (name: 'DevWorkoutsLayout' | 'DevDashboard' | 'DevTemplateEditor' | 'DevLiveSession' | 'DevSessionDetail') =>
  page(() => import('@/features/workouts/dev/DevWorkoutsPreview'), name)

/** Dev-only previews with sample data: DEV-gated and lazy, so they never reach the production bundle. */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      { path: '/__dev/onboarding', lazy: onboarding },
      { path: '/__dev/pending', element: <PendingApprovalPage preview="pending" /> },
      { path: '/__dev/rejected', element: <PendingApprovalPage preview="rejected" /> },
      { path: '/__dev/update', element: <UpdatePrompt forceVisible /> },
      // first-run tour without persistence: ?step=1..7, ?standalone=1, ?theme=light|dark
      { path: '/__dev/tour', lazy: page(() => import('@/features/tour/dev/DevTourPreview'), 'DevTourPreview') },
      { path: '/__dev/errors', lazy: page(() => import('./DevErrorsPreview'), 'DevErrorsPreview') },
      { path: '/__dev/streak/:n', lazy: page(() => import('./DevStreakPreview'), 'DevStreakPreview') },
      { path: '/__dev/share', lazy: page(() => import('@/features/social/share/dev/DevSharePreview'), 'DevSharePreview') },
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
        path: '/__dev/licenses',
        element: <AppShell />,
        children: [{ index: true, lazy: page(() => import('@/features/settings/pages/LicensesPage'), 'LicensesPage') }],
      },
      {
        // Home with sample data: ?hour=21|12, ?health=0, ?empty=1, ?celebrate=streak_7, ?units=imperial
        path: '/__dev/home',
        lazy: devHome('DevHomeLayout'),
        children: [{ index: true, lazy: devHome('DevHome') }],
      },
      {
        // AI coach with sample conversations: ?consent=0, ?blocked=user_daily|google_minute, ?empty=1,
        // ?fail=AI_UNDERAGE|COACH_AI_UNAVAILABLE|COACH_AI_QUOTA, ?delay=ms (typing state)
        path: '/__dev/coach',
        lazy: page(() => import('@/features/coach/dev/DevCoachPreview'), 'DevCoachLayout'),
        children: [
          { index: true, lazy: coach.list },
          { path: ':id', lazy: coach.chat },
        ],
      },
      {
        // Profile hub with a sample badge shelf: ?fresh=1, ?celebrate=sets_100; /settings and /admin hubs
        path: '/__dev/profile',
        lazy: devProfile('DevProfileLayout'),
        children: [
          { index: true, lazy: devProfile('DevProfile') },
          { path: 'settings', lazy: page(() => import('@/features/settings/pages/SettingsPage'), 'SettingsPage') },
          { path: 'edit', lazy: page(() => import('@/features/profile/pages/ProfileEditPage'), 'ProfileEditPage') },
          { path: 'admin', lazy: page(() => import('@/features/admin/pages/AdminHubPage'), 'AdminHubPage') },
        ],
      },
      {
        // Community with sample data: ?state=off|underage|nobirth (not joined), ?tab=discover, search?s=groups,
        // ranking, tag/bacakgünü, join, notifications, u/sample-2 (profile), u/sample-3 (private), g/g1 (group),
        // settings, reports
        path: '/__dev/social',
        lazy: devSocial('DevSocialLayout'),
        children: [
          { index: true, lazy: social.home },
          { path: 'search', lazy: social.search },
          { path: 'ranking', lazy: social.ranking },
          { path: 'tag/:tag', lazy: social.tag },
          { path: 'join', lazy: social.join },
          { path: 'notifications', lazy: social.notifications },
          { path: 'u/:id', lazy: social.user },
          { path: 'u/:id/:list', lazy: social.list },
          { path: 'g/:id', lazy: social.group },
          { path: 'g/:id/settings', lazy: social.groupSettings },
          { path: 'join/:code', lazy: social.join },
          { path: 'settings', lazy: social.settings },
          { path: 'reports', lazy: page(() => import('@/features/social/pages/AdminReportsPage'), 'AdminReportsPage') },
        ],
      },
      {
        // admin Access and Users with sample data: ?mode=invite
        path: '/__dev/admin',
        lazy: page(() => import('@/features/admin/dev/DevAdminPreview'), 'DevAdminLayout'),
        children: [
          { path: 'access', lazy: admin.access },
          { path: 'users', lazy: admin.users },
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
          <TourGate>
            <AppShell />
          </TourGate>
        </NoticeGate>
      </RequireAuth>
    ),
    children: [
      // lazy like every other page: the sign-in screen does not download the dashboard, zod or date-fns
      { index: true, lazy: page(() => import('@/features/dashboard/pages/DashboardPage'), 'DashboardPage') },
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
      // the ranking is a pushed Community screen now
      { path: 'leaderboard', element: <Navigate to="/social/ranking" replace /> },
      { path: 'social', lazy: social.home },
      { path: 'social/search', lazy: social.search },
      { path: 'social/ranking', lazy: social.ranking },
      { path: 'social/tag/:tag', lazy: social.tag },
      { path: 'social/notifications', lazy: social.notifications },
      { path: 'social/u/:id', lazy: social.user },
      { path: 'social/u/:id/:list', lazy: social.list },
      { path: 'social/p/:id', lazy: social.post },
      { path: 'social/g/:id', lazy: social.group },
      { path: 'social/g/:id/settings', lazy: social.groupSettings },
      { path: 'social/join', lazy: social.join },
      { path: 'social/join/:code', lazy: social.join },
      { path: 'settings/social', lazy: social.settings },
      { path: 'coach', lazy: coach.list },
      { path: 'coach/:id', lazy: coach.chat },
      { path: 'me', lazy: page(() => import('@/features/profile/pages/ProfilePage'), 'ProfilePage') },
      { path: 'me/edit', lazy: page(() => import('@/features/profile/pages/ProfileEditPage'), 'ProfileEditPage') },
      { path: 'settings', lazy: page(() => import('@/features/settings/pages/SettingsPage'), 'SettingsPage') },
      { path: 'settings/licenses', lazy: page(() => import('@/features/settings/pages/LicensesPage'), 'LicensesPage') },
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
      { path: 'admin', lazy: adminPage(() => import('@/features/admin/pages/AdminHubPage'), 'AdminHubPage') },
      { path: 'admin/access', lazy: adminPage(() => import('@/features/admin/pages/AccessPage'), 'AccessPage') },
      { path: 'admin/users', lazy: adminPage(() => import('@/features/admin/pages/UsersPage'), 'UsersPage') },
      { path: 'admin/usage', lazy: adminPage(() => import('@/features/admin/pages/UsagePage'), 'UsagePage') },
      { path: 'admin/social-reports', lazy: adminPage(() => import('@/features/social/pages/AdminReportsPage'), 'AdminReportsPage') },
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
