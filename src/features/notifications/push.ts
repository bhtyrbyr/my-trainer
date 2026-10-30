import { supabase } from '@/lib/supabase'

/** Public VAPID key from the build (deploy.yml); without it reminders are not offered. */
export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || null

export type PushSupport = 'ok' | 'needs-install' | 'unsupported'

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** iPhone Safari only allows push for an app added to the Home Screen (iOS 16.4+). */
export function pushSupport(): PushSupport {
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (isIos() && !isStandalone()) return 'needs-install'
  return capable ? 'ok' : 'unsupported'
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const bin = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  // dev builds have no service worker; never wait forever for one
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

/** Ask permission (must run inside a tap), subscribe this device and store it for the caller. */
export async function enablePush(): Promise<void> {
  if (!VAPID_PUBLIC_KEY) throw new Error('PUSH_NOT_CONFIGURED')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('PUSH_DENIED')
  const reg = await registration()
  if (!reg) throw new Error('PUSH_UNSUPPORTED')
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }))
  const json = sub.toJSON()
  const { error } = await supabase.rpc('register_push', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_user_agent: navigator.userAgent.slice(0, 300),
  })
  if (error) throw error
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  const { error } = await supabase.rpc('unregister_push', { p_endpoint: sub.endpoint })
  await sub.unsubscribe()
  if (error) throw error
}
