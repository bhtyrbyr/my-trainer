// push-send Edge Function (Deno): delivers reminder notifications queued by public.dispatch_reminders()
// (pg_cron every 5 minutes, pg_net POST). docs/faz3-spec.md section 5.
//
//   POST { messages: [{ endpoint, p256dh, auth, payload }] }   header x-dispatch-secret
//   -> { sent, gone }
//
// Security: verify_jwt is off (pg_net has no user JWT); the caller proves itself with the shared
// dispatch secret. No service_role and no database reads: it only encrypts (RFC 8291), signs (VAPID)
// and POSTs to the browsers' push services. Dead subscriptions (404/410) are reported back through the
// prune_push_subscriptions() RPC with the anon key and the same secret.
//
// Secrets (set by deploy.yml from GitHub secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
// PUSH_DISPATCH_SECRET. SUPABASE_URL and SUPABASE_ANON_KEY are provided by the platform.
import { encryptPayload, vapidAuthorization } from './webpush.ts'

type Message = { endpoint: string; p256dh: string; auth: string; payload: unknown }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD' }, 405)
  const secret = Deno.env.get('PUSH_DISPATCH_SECRET') ?? ''
  if (!sameSecret(req.headers.get('x-dispatch-secret') ?? '', secret)) return json({ error: 'FORBIDDEN' }, 403)
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.invalid'
  if (!pub || !priv) return json({ error: 'NOT_CONFIGURED' }, 503)

  let messages: Message[]
  try {
    messages = ((await req.json()) as { messages?: Message[] }).messages ?? []
  } catch {
    return json({ error: 'BAD_BODY' }, 400)
  }
  messages = messages.filter((m) => typeof m?.endpoint === 'string' && m.endpoint.startsWith('https://')).slice(0, 200)

  const gone: string[] = []
  let sent = 0
  await Promise.all(
    messages.map(async (m) => {
      try {
        const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(m.payload)), m.p256dh, m.auth)
        const res = await fetch(m.endpoint, {
          method: 'POST',
          headers: {
            Authorization: await vapidAuthorization(m.endpoint, subject, pub, priv),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: '3600',
            Urgency: 'normal',
          },
          body,
        })
        if (res.status === 404 || res.status === 410) gone.push(m.endpoint)
        else if (res.ok) sent++
        else console.error('push rejected', res.status, new URL(m.endpoint).origin)
        await res.body?.cancel()
      } catch (e) {
        console.error('push failed', e instanceof Error ? e.message : String(e))
      }
    }),
  )

  if (gone.length) {
    const url = Deno.env.get('SUPABASE_URL')
    const anon = Deno.env.get('SUPABASE_ANON_KEY')
    if (url && anon) {
      const r = await fetch(`${url}/rest/v1/rpc/prune_push_subscriptions`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_secret: secret, p_endpoints: gone }),
      })
      if (!r.ok) console.error('prune failed', r.status)
      await r.body?.cancel()
    }
  }
  return json({ sent, gone: gone.length })
})
