import { supabase } from '@/lib/supabase'
import { parseAdminConfig, type AdminConfig, type AdminConfigKey } from './adminLogic'
import type { Database, RegistrationRow, RegistrationStatus } from '@/lib/database.types'

export async function listRegistrations(status: RegistrationStatus | 'all' = 'pending'): Promise<RegistrationRow[]> {
  const { data, error } = await supabase.rpc('admin_list_registrations', { p_status: status, p_limit: 100 })
  if (error) throw error
  return data ?? []
}

export async function setRegistrationStatus(userId: string, status: RegistrationStatus): Promise<void> {
  const { error } = await supabase.rpc('admin_set_registration_status', { p_user: userId, p_status: status })
  if (error) throw error
}

/**
 * Permanently delete a rejected account: avatar files first (Storage API; SQL cannot delete storage rows),
 * then the auth user via RPC, which cascades through every table.
 */
export async function deleteRejectedUser(userId: string): Promise<void> {
  const bucket = supabase.storage.from('avatars')
  const { data: files, error: listErr } = await bucket.list(userId, { limit: 100 })
  if (listErr) throw listErr
  if (files?.length) {
    const { error: rmErr } = await bucket.remove(files.map((f) => `${userId}/${f.name}`))
    if (rmErr) throw rmErr
  }
  const { error } = await supabase.rpc('admin_delete_rejected_user', { p_user: userId })
  if (error) throw error
}

export async function pendingCount(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_pending_count')
  if (error) throw error
  return data ?? 0
}

// ---------------------------------------------------------------------------------------------
// AI usage dashboard (admin-only RPCs; counts only, never prompts or answers)
export async function aiUsage(days: number) {
  const { data, error } = await supabase.rpc('admin_ai_usage', { p_days: days })
  if (error) throw error
  return (data ?? []).map((r) => ({
    ...r,
    requests: Number(r.requests),
    failed: Number(r.failed),
    prompt_tokens: Number(r.prompt_tokens),
    output_tokens: Number(r.output_tokens),
    total_tokens: Number(r.total_tokens),
  }))
}

export async function aiLive() {
  const { data, error } = await supabase.rpc('admin_ai_live')
  if (error) throw error
  return (data ?? []).map((r) => ({
    model: r.model,
    requests_today: Number(r.requests_today),
    tokens_today: Number(r.tokens_today),
    requests_last_minute: Number(r.requests_last_minute),
    tokens_last_minute: Number(r.tokens_last_minute),
  }))
}

export async function aiAppToday(): Promise<{ used: number; limit: number }> {
  const { data, error } = await supabase.rpc('admin_ai_app_today')
  if (error) throw error
  const r = data?.[0]
  return { used: Number(r?.used ?? 0), limit: Number(r?.global_limit ?? 0) }
}

export async function aiModelLimits(): Promise<unknown> {
  const { data, error } = await supabase.from('app_config').select('value').eq('key', 'ai_model_limits').maybeSingle()
  if (error) throw error
  return data?.value ?? null
}

/** Admin-only by RLS (app_config_admin_write). */
export async function setAiModelLimits(value: Record<string, { rpm: number; tpm: number; rpd: number }>): Promise<void> {
  const { error } = await supabase.from('app_config').update({ value }).eq('key', 'ai_model_limits')
  if (error) throw error
}

// ---------------------------------------------------------------------------------------------
// Error reports (admin-only via RLS + admin_error_reports)
export async function listErrorReports(status: 'open' | 'resolved' | 'all') {
  const { data, error } = await supabase.rpc('admin_error_reports', { p_status: status, p_limit: 200 })
  if (error) throw error
  return data ?? []
}

export async function setErrorReportStatus(id: number, status: 'open' | 'resolved'): Promise<void> {
  const { error } = await supabase.from('error_reports').update({ status }).eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------------------------
// Access (app_config keys the panel edits) and the invite list. All admin-only RPCs; app_config is
// readable by admins only (RLS).

export async function fetchAdminConfig(): Promise<AdminConfig> {
  const { data, error } = await supabase.from('app_config').select('key, value').in('key', ['access_mode', 'require_approval', 'ai_global_daily_limit'])
  if (error) throw error
  return parseAdminConfig(data ?? [])
}

/** BAD_KEY is also the push-subscription code; tag it so errors.ts can tell the two apart. */
function configError(error: { message?: string }): unknown {
  return /\bBAD_KEY\b/.test(error.message ?? '') ? { ...error, message: 'BAD_CONFIG_KEY' } : error
}

export async function setAdminConfig<K extends AdminConfigKey>(key: K, value: AdminConfig[K]): Promise<void> {
  const { error } = await supabase.rpc('admin_set_config', { p_key: key, p_value: value })
  if (error) throw configError(error)
}

export async function listAllowedEmails() {
  const { data, error } = await supabase.rpc('admin_list_allowed_emails')
  if (error) throw error
  return data ?? []
}

export async function addAllowedEmail(email: string, note: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_add_allowed_email', { p_email: email, p_note: note ?? undefined })
  if (error) throw error
}

export async function removeAllowedEmail(email: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_remove_allowed_email', { p_email: email })
  if (error) throw error
  return Boolean(data)
}

// ---------------------------------------------------------------------------------------------
// Users: search, block/unblock, per-user AI limit
type AdminUserRow = Database['public']['Functions']['admin_list_users']['Returns'][number]
/** Generated RPC types are non-null; these two really are null for never-active users / no settings row. */
export type AdminUser = Omit<AdminUserRow, 'last_active_on' | 'ai_daily_limit'> & {
  last_active_on: string | null
  ai_daily_limit: number | null
}

export async function listUsers(query: string, limit = 50): Promise<AdminUser[]> {
  const { data, error } = await supabase.rpc('admin_list_users', { p_query: query.trim() || undefined, p_limit: limit })
  if (error) throw error
  return data ?? []
}

export async function setUserBlocked(userId: string, blocked: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_blocked', { p_user: userId, p_blocked: blocked })
  if (error) throw error
}

export async function setUserAiLimit(userId: string, limit: number): Promise<void> {
  const { error } = await supabase.rpc('admin_set_ai_limit', { p_user: userId, p_limit: limit })
  if (error) throw error
}
