// Apply the saved theme before first paint (no flash). Kept in sync with src/lib/theme.ts.
// A classic, render-blocking file instead of an inline script, so the CSP needs no 'unsafe-inline'.
try {
  var p = localStorage.getItem('mt.theme') || 'dark'
  var light = p === 'light' || (p === 'system' && matchMedia('(prefers-color-scheme: light)').matches)
  if (light) {
    document.documentElement.dataset.theme = 'light'
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f5f6f0')
  }
} catch (e) {}
