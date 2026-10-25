import { supabase } from '@/lib/supabase'
import type { RegistrationRow, RegistrationStatus } from '@/lib/database.types'

export async function listRegistrations(status: RegistrationStatus | 'all' = 'pending'): Promise<RegistrationRow[]> {
  const { data, error } = await supabase.rpc('admin_list_registrations', { p_status: status, p_limit: 100 })
  if (error) throw error
  return data ?? []
}

export async function setRegistrationStatus(userId: string, status: RegistrationStatus): Promise<void> {
  const { error } = await supabase.rpc('admin_set_registration_status', { p_user: userId, p_status: status })
  if (error) throw error
}

export async function pendingCount(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_pending_count')
  if (error) throw error
  return data ?? 0
}
