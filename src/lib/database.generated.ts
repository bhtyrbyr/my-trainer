export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      allowed_emails: {
        Row: {
          added_by: string | null
          created_at: string
          email: string
          note: string | null
        }
        ComputedFields: never
        Insert: {
          added_by?: string | null
          created_at?: string
          email: string
          note?: string | null
        }
        Update: {
          added_by?: string | null
          created_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: NonNullable<Json>
        }
        ComputedFields: never
        Insert: {
          key: string
          updated_at?: string
          value: NonNullable<Json>
        }
        Update: {
          key?: string
          updated_at?: string
          value?: NonNullable<Json>
        }
        Relationships: []
      }
      body_metrics: {
        Row: {
          arm_cm: number | null
          chest_cm: number | null
          created_at: string
          hip_cm: number | null
          id: string
          measured_on: string
          note: string | null
          thigh_cm: number | null
          updated_at: string
          user_id: string
          waist_cm: number | null
          weight_kg: number | null
        }
        ComputedFields: never
        Insert: {
          arm_cm?: number | null
          chest_cm?: number | null
          created_at?: string
          hip_cm?: number | null
          id?: string
          measured_on: string
          note?: string | null
          thigh_cm?: number | null
          updated_at?: string
          user_id: string
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Update: {
          arm_cm?: number | null
          chest_cm?: number | null
          created_at?: string
          hip_cm?: number | null
          id?: string
          measured_on?: string
          note?: string | null
          thigh_cm?: number | null
          updated_at?: string
          user_id?: string
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Relationships: []
      }
      cardio_entries: {
        Row: {
          activity: string
          avg_hr: number | null
          created_at: string
          distance_m: number | null
          duration_sec: number
          id: string
          notes: string | null
          session_id: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          activity: string
          avg_hr?: number | null
          created_at?: string
          distance_m?: number | null
          duration_sec: number
          id?: string
          notes?: string | null
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activity?: string
          avg_hr?: number | null
          created_at?: string
          distance_m?: number | null
          duration_sec?: number
          id?: string
          notes?: string | null
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'cardio_entries_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'workout_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      exercise_catalog_meta: {
        Row: {
          created_at: string
          item_count: number | null
          license_text: string | null
          source: string
          synced_at: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          item_count?: number | null
          license_text?: string | null
          source: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          item_count?: number | null
          license_text?: string | null
          source?: string
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      exercises: {
        Row: {
          body_parts: string[]
          created_at: string
          equipment: string[]
          external_id: string | null
          gif_path: string | null
          id: string
          instructions_en: string[]
          instructions_tr: string[] | null
          is_custom: boolean
          name_en: string
          name_tr: string | null
          search: unknown
          secondary_muscles: string[]
          source: string
          target_muscles: string[]
          updated_at: string
          user_id: string | null
        }
        ComputedFields: never
        Insert: {
          body_parts?: string[]
          created_at?: string
          equipment?: string[]
          external_id?: string | null
          gif_path?: string | null
          id?: string
          instructions_en?: string[]
          instructions_tr?: string[] | null
          is_custom?: boolean
          name_en: string
          name_tr?: string | null
          search?: never
          secondary_muscles?: string[]
          source?: string
          target_muscles?: string[]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          body_parts?: string[]
          created_at?: string
          equipment?: string[]
          external_id?: string | null
          gif_path?: string | null
          id?: string
          instructions_en?: string[]
          instructions_tr?: string[] | null
          is_custom?: boolean
          name_en?: string
          name_tr?: string | null
          search?: never
          secondary_muscles?: string[]
          source?: string
          target_muscles?: string[]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      muscle_aliases: {
        Row: {
          created_at: string
          exercisedb_name: string
          updated_at: string
          wger_id: number | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          exercisedb_name: string
          updated_at?: string
          wger_id?: number | null
        }
        Update: {
          created_at?: string
          exercisedb_name?: string
          updated_at?: string
          wger_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'muscle_aliases_wger_id_fkey'
            columns: ['wger_id']
            isOneToOne: false
            referencedRelation: 'muscles'
            referencedColumns: ['wger_id']
          },
        ]
      }
      muscles: {
        Row: {
          created_at: string
          is_front: boolean
          name_en: string
          name_latin: string
          name_tr: string | null
          svg_main_path: string | null
          svg_secondary_path: string | null
          updated_at: string
          wger_id: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          is_front: boolean
          name_en: string
          name_latin: string
          name_tr?: string | null
          svg_main_path?: string | null
          svg_secondary_path?: string | null
          updated_at?: string
          wger_id: number
        }
        Update: {
          created_at?: string
          is_front?: boolean
          name_en?: string
          name_latin?: string
          name_tr?: string | null
          svg_main_path?: string | null
          svg_secondary_path?: string | null
          updated_at?: string
          wger_id?: number
        }
        Relationships: []
      }
      personal_records: {
        Row: {
          achieved_on: string
          created_at: string
          e1rm: number
          exercise_id: string
          id: string
          reps: number | null
          session_set_id: string | null
          updated_at: string
          user_id: string
          weight_kg: number | null
        }
        ComputedFields: never
        Insert: {
          achieved_on: string
          created_at?: string
          e1rm: number
          exercise_id: string
          id?: string
          reps?: number | null
          session_set_id?: string | null
          updated_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          achieved_on?: string
          created_at?: string
          e1rm?: number
          exercise_id?: string
          id?: string
          reps?: number | null
          session_set_id?: string | null
          updated_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'personal_records_exercise_id_fkey'
            columns: ['exercise_id']
            isOneToOne: false
            referencedRelation: 'exercises'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'personal_records_session_set_id_fkey'
            columns: ['session_set_id']
            isOneToOne: false
            referencedRelation: 'session_sets'
            referencedColumns: ['id']
          },
        ]
      }
      point_events: {
        Row: {
          created_at: string
          id: string
          kind: string
          occurred_on: string
          points: number
          ref_id: string
          ref_table: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          kind: string
          occurred_on: string
          points: number
          ref_id: string
          ref_table: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          occurred_on?: string
          points?: number
          ref_id?: string
          ref_table?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'point_events_kind_fkey'
            columns: ['kind']
            isOneToOne: false
            referencedRelation: 'point_rules'
            referencedColumns: ['kind']
          },
        ]
      }
      point_rules: {
        Row: {
          counts_toward_daily_total: boolean
          daily_cap: number | null
          description: string | null
          is_active: boolean
          kind: string
          per_event_cap: number | null
          points: number
          weekly_cap: number | null
        }
        ComputedFields: never
        Insert: {
          counts_toward_daily_total?: boolean
          daily_cap?: number | null
          description?: string | null
          is_active?: boolean
          kind: string
          per_event_cap?: number | null
          points: number
          weekly_cap?: number | null
        }
        Update: {
          counts_toward_daily_total?: boolean
          daily_cap?: number | null
          description?: string | null
          is_active?: boolean
          kind?: string
          per_event_cap?: number | null
          points?: number
          weekly_cap?: number | null
        }
        Relationships: []
      }
      profile_private: {
        Row: {
          birth_year: number | null
          created_at: string
          goal: string | null
          height_cm: number | null
          sex: string | null
          start_weight_kg: number | null
          target_weight_kg: number | null
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          birth_year?: number | null
          created_at?: string
          goal?: string | null
          height_cm?: number | null
          sex?: string | null
          start_weight_kg?: number | null
          target_weight_kg?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          birth_year?: number | null
          created_at?: string
          goal?: string | null
          height_cm?: number | null
          sex?: string | null
          start_weight_kg?: number | null
          target_weight_kg?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string
          created_at: string
          current_streak: number
          display_name: string
          is_blocked: boolean
          last_active_on: string | null
          level: number | null
          longest_streak: number
          onboarding_completed_at: string | null
          role: string
          show_on_leaderboard: boolean
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          total_points: number
          updated_at: string
          user_id: string
          username: string
          username_changed_at: string | null
        }
        ComputedFields: never
        Insert: {
          avatar_path: string
          created_at?: string
          current_streak?: number
          display_name: string
          is_blocked?: boolean
          last_active_on?: string | null
          level?: never
          longest_streak?: number
          onboarding_completed_at?: string | null
          role?: string
          show_on_leaderboard?: boolean
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          total_points?: number
          updated_at?: string
          user_id: string
          username: string
          username_changed_at?: string | null
        }
        Update: {
          avatar_path?: string
          created_at?: string
          current_streak?: number
          display_name?: string
          is_blocked?: boolean
          last_active_on?: string | null
          level?: never
          longest_streak?: number
          onboarding_completed_at?: string | null
          role?: string
          show_on_leaderboard?: boolean
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          total_points?: number
          updated_at?: string
          user_id?: string
          username?: string
          username_changed_at?: string | null
        }
        Relationships: []
      }
      session_exercises: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          notes: string | null
          position: number
          session_id: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          notes?: string | null
          position: number
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          notes?: string | null
          position?: number
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'session_exercises_exercise_id_fkey'
            columns: ['exercise_id']
            isOneToOne: false
            referencedRelation: 'exercises'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'session_exercises_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'workout_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      session_sets: {
        Row: {
          completed_at: string
          created_at: string
          id: string
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          session_exercise_id: string
          session_id: string
          set_no: number
          updated_at: string
          user_id: string
          weight_kg: number | null
        }
        ComputedFields: never
        Insert: {
          completed_at?: string
          created_at?: string
          id?: string
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          session_exercise_id: string
          session_id: string
          set_no: number
          updated_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          completed_at?: string
          created_at?: string
          id?: string
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          session_exercise_id?: string
          session_id?: string
          set_no?: number
          updated_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'session_sets_session_exercise_id_fkey'
            columns: ['session_exercise_id']
            isOneToOne: false
            referencedRelation: 'session_exercises'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'session_sets_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'workout_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      template_exercises: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          notes: string | null
          position: number
          rest_seconds: number
          target_reps_high: number
          target_reps_low: number
          target_sets: number
          template_id: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          notes?: string | null
          position: number
          rest_seconds?: number
          target_reps_high?: number
          target_reps_low?: number
          target_sets?: number
          template_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          notes?: string | null
          position?: number
          rest_seconds?: number
          target_reps_high?: number
          target_reps_low?: number
          target_sets?: number
          template_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'template_exercises_exercise_id_fkey'
            columns: ['exercise_id']
            isOneToOne: false
            referencedRelation: 'exercises'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'template_exercises_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'workout_templates'
            referencedColumns: ['id']
          },
        ]
      }
      user_settings: {
        Row: {
          ai_daily_limit: number
          ai_provider: string
          created_at: string
          daily_kcal: number | null
          daily_protein_g: number | null
          daily_water_ml: number
          locale: string
          unit_length: string
          unit_weight: string
          updated_at: string
          user_id: string
          week_starts_on: number
        }
        ComputedFields: never
        Insert: {
          ai_daily_limit?: number
          ai_provider?: string
          created_at?: string
          daily_kcal?: number | null
          daily_protein_g?: number | null
          daily_water_ml?: number
          locale?: string
          unit_length?: string
          unit_weight?: string
          updated_at?: string
          user_id: string
          week_starts_on?: number
        }
        Update: {
          ai_daily_limit?: number
          ai_provider?: string
          created_at?: string
          daily_kcal?: number | null
          daily_protein_g?: number | null
          daily_water_ml?: number
          locale?: string
          unit_length?: string
          unit_weight?: string
          updated_at?: string
          user_id?: string
          week_starts_on?: number
        }
        Relationships: []
      }
      workout_sessions: {
        Row: {
          created_at: string
          duration_sec: number | null
          ended_at: string | null
          id: string
          kcal_estimate: number | null
          kcal_weight_kg: number | null
          kind: string
          notes: string | null
          started_at: string
          template_id: string | null
          title: string | null
          total_sets: number
          total_volume_kg: number
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          duration_sec?: number | null
          ended_at?: string | null
          id?: string
          kcal_estimate?: number | null
          kcal_weight_kg?: number | null
          kind: string
          notes?: string | null
          started_at?: string
          template_id?: string | null
          title?: string | null
          total_sets?: number
          total_volume_kg?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_sec?: number | null
          ended_at?: string | null
          id?: string
          kcal_estimate?: number | null
          kcal_weight_kg?: number | null
          kind?: string
          notes?: string | null
          started_at?: string
          template_id?: string | null
          title?: string | null
          total_sets?: number
          total_volume_kg?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workout_sessions_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'workout_templates'
            referencedColumns: ['id']
          },
        ]
      }
      workout_templates: {
        Row: {
          archived: boolean
          color: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          sort_order: number
          updated_at: string
          user_id: string
          weekdays: number[]
        }
        ComputedFields: never
        Insert: {
          archived?: boolean
          color?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          sort_order?: number
          updated_at?: string
          user_id: string
          weekdays?: number[]
        }
        Update: {
          archived?: boolean
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          sort_order?: number
          updated_at?: string
          user_id?: string
          weekdays?: number[]
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_delete_rejected_user: { Args: { p_user: string }; Returns: undefined }
      admin_list_registrations: {
        Args: { p_limit?: number; p_status?: string }
        Returns: {
          avatar_path: string
          created_at: string
          display_name: string
          email: string
          status: string
          status_changed_at: string
          user_id: string
          username: string
        }[]
      }
      admin_pending_count: { Args: Record<PropertyKey, never>; Returns: number }
      admin_set_registration_status: { Args: { p_status: string; p_user: string }; Returns: undefined }
      award_points: {
        Args: {
          p_kind: string
          p_occurred_on: string
          p_points_override?: number
          p_ref_id: string
          p_ref_table: string
          p_user: string
        }
        Returns: number
      }
      body_weight_for: { Args: { p_on: string; p_user: string }; Returns: number }
      can_access: { Args: Record<PropertyKey, never>; Returns: boolean }
      cardio_met: { Args: { p_activity: string; p_speed_kmh: number }; Returns: number }
      delete_my_account: { Args: Record<PropertyKey, never>; Returns: undefined }
      e1rm: { Args: { p_reps: number; p_weight: number }; Returns: number }
      effective_streak: { Args: { p_current: number; p_last_active: string }; Returns: number }
      estimate_session_kcal: {
        Args: { p_duration: number; p_kind: string; p_session: string; p_user: string }
        Returns: {
          kcal: number
          weight_kg: number
        }[]
      }
      exercise_progress: {
        Args: { p_exercise: string }
        Returns: {
          avg_weight_kg: number
          best_e1rm: number
          best_reps: number
          best_weight_kg: number
          session_id: string
          started_at: string
          total_sets: number
          total_volume_kg: number
        }[]
      }
      finish_workout_session: { Args: { p_session: string }; Returns: Json }
      get_leaderboard: {
        Args: { p_limit?: number; p_period?: string }
        Returns: {
          active_days: number
          avatar_path: string
          display_name: string
          is_me: boolean
          level: number
          points: number
          rank: number
          streak: number
          user_id: string
          username: string
        }[]
      }
      has_onboarded: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_internal: { Args: Record<PropertyKey, never>; Returns: boolean }
      jwt_email: { Args: Record<PropertyKey, never>; Returns: string }
      last_sets_for_exercise: {
        Args: { p_exercise: string; p_limit?: number }
        Returns: {
          completed_at: string
          is_warmup: boolean
          reps: number
          rpe: number
          session_exercise_id: string
          session_id: string
          set_id: string
          set_no: number
          started_at: string
          weight_kg: number
        }[]
      }
      recompute_streak: { Args: { p_user: string }; Returns: undefined }
      revoke_points: { Args: { p_ref_id: string; p_ref_table: string; p_user: string }; Returns: number }
      strength_met: { Args: { p_avg_rpe: number }; Returns: number }
      todays_templates: {
        Args: { p_isodow?: number }
        Returns: {
          archived: boolean
          color: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          sort_order: number
          updated_at: string
          user_id: string
          weekdays: number[]
        }[]
        SetofOptions: {
          from: '*'
          to: 'workout_templates'
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
