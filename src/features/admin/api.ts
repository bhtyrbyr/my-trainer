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
