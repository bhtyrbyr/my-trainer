// Hand-written for Faz 0. Replace with generated output once the project is linked:
//   npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Locale = 'tr' | 'en'
export type Role = 'user' | 'admin'
export type RegistrationStatus = 'pending' | 'approved' | 'rejected'
export type Goal = 'lose_fat' | 'build_muscle' | 'maintain' | 'performance'
export type Sex = 'male' | 'female' | 'other'

type ProfileRow = {
  user_id: string
  username: string
  display_name: string
  avatar_path: string
  role: Role
  status: RegistrationStatus
  status_changed_at: string | null
  status_changed_by: string | null
  is_blocked: boolean
  show_on_leaderboard: boolean
  total_points: number
  level: number
  current_streak: number
  longest_streak: number
  last_active_on: string | null
  onboarding_completed_at: string | null
  username_changed_at: string | null
  created_at: string
  updated_at: string
}

type ProfilePrivateRow = {
  user_id: string
  birth_year: number | null
  height_cm: number | null
  start_weight_kg: number | null
  sex: Sex | null
  goal: Goal | null
  created_at: string
  updated_at: string
}

type UserSettingsRow = {
  user_id: string
  locale: Locale
  unit_weight: 'kg' | 'lb'
  unit_length: 'cm' | 'in'
  daily_kcal: number | null
  daily_protein_g: number | null
  daily_water_ml: number
  week_starts_on: number
  ai_provider: 'gemini' | 'openrouter' | 'off'
  ai_daily_limit: number
  created_at: string
  updated_at: string
}

type PointEventRow = {
  id: string
  user_id: string
  kind: string
  points: number
  occurred_on: string
  ref_table: string
  ref_id: string
  created_at: string
}

type PointRuleRow = {
  kind: string
  points: number
  per_event_cap: number | null
  daily_cap: number | null
  weekly_cap: number | null
  counts_toward_daily_total: boolean
  is_active: boolean
  description: string | null
}

export type Database = {
  public: {
    Tables: {
      app_config: {
        Row: { key: string; value: Json; updated_at: string }
        Insert: { key: string; value: Json; updated_at?: string }
        Update: { key?: string; value?: Json; updated_at?: string }
        Relationships: []
      }
      allowed_emails: {
        Row: { email: string; note: string | null; added_by: string | null; created_at: string }
        Insert: { email: string; note?: string | null; added_by?: string | null }
        Update: { email?: string; note?: string | null; added_by?: string | null }
        Relationships: []
      }
      profiles: {
        Row: ProfileRow
        Insert: {
          user_id: string
          username: string
          display_name: string
          avatar_path: string
          show_on_leaderboard?: boolean
          onboarding_completed_at?: string | null
        }
        Update: Partial<Pick<ProfileRow, 'username' | 'display_name' | 'avatar_path' | 'show_on_leaderboard' | 'onboarding_completed_at' | 'role' | 'is_blocked'>>
        Relationships: []
      }
      profile_private: {
        Row: ProfilePrivateRow
        Insert: {
          user_id: string
          birth_year?: number | null
          height_cm?: number | null
          start_weight_kg?: number | null
          sex?: Sex | null
          goal?: Goal | null
        }
        Update: Partial<Omit<ProfilePrivateRow, 'user_id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      user_settings: {
        Row: UserSettingsRow
        Insert: { user_id: string } & Partial<Omit<UserSettingsRow, 'user_id' | 'created_at' | 'updated_at'>>
        Update: Partial<Omit<UserSettingsRow, 'user_id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      point_events: {
        Row: PointEventRow
        Insert: never
        Update: never
        Relationships: []
      }
      point_rules: {
        Row: PointRuleRow
        Insert: never
        Update: Partial<Omit<PointRuleRow, 'kind'>>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      can_access: { Args: Record<string, never>; Returns: boolean }
      is_admin: { Args: Record<string, never>; Returns: boolean }
      has_onboarded: { Args: Record<string, never>; Returns: boolean }
      delete_my_account: { Args: Record<string, never>; Returns: undefined }
      admin_pending_count: { Args: Record<string, never>; Returns: number }
      admin_delete_rejected_user: { Args: { p_user: string }; Returns: undefined }
      admin_set_registration_status: { Args: { p_user: string; p_status: RegistrationStatus }; Returns: undefined }
      admin_list_registrations: {
        Args: { p_status?: RegistrationStatus | 'all'; p_limit?: number }
        Returns: {
          user_id: string
          username: string
          display_name: string
          avatar_path: string
          email: string
          status: RegistrationStatus
          created_at: string
          status_changed_at: string | null
        }[]
      }
      get_leaderboard: {
        Args: { p_period?: 'week' | 'month' | 'all'; p_limit?: number }
        Returns: {
          rank: number
          user_id: string
          username: string
          display_name: string
          avatar_path: string
          points: number
          level: number
          active_days: number
          streak: number
          is_me: boolean
        }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Profile = ProfileRow
export type ProfilePrivate = ProfilePrivateRow
export type UserSettings = UserSettingsRow
export type LeaderboardRow = Database['public']['Functions']['get_leaderboard']['Returns'][number]
export type RegistrationRow = Database['public']['Functions']['admin_list_registrations']['Returns'][number]
