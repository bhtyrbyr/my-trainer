/* Reminder notifications, imported by the generated service worker (vite.config.ts workbox.importScripts).
 * The title is the app's manifest name, so a product rename needs no change here. */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    (async () => {
      let title = ''
      try {
        const manifest = await (await fetch('/manifest.webmanifest')).json()
        title = manifest.name || ''
      } catch (e) {
        /* offline: the body alone is fine */
      }
      await self.registration.showNotification(data.title || title || 'Reminder', {
        body: data.body || '',
        tag: data.tag,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: { url: data.url || '/' },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(url).catch(() => {})
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
