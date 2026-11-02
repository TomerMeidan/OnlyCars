// Runs in <head>, before the first paint. A file rather than inline code, so the Content-Security-Policy needs no 'unsafe-inline' (2026-11-02).
// The saved theme, so a reload never shows the OS theme first. Mirrors applyTheme() and cachedUser() in src/api.ts.
try {
  var u = localStorage.getItem('token') && JSON.parse(localStorage.getItem('user'))
  if (u && (u.theme === 'Light' || u.theme === 'Dark')) document.documentElement.dataset.theme = u.theme.toLowerCase()
} catch (e) {}
// Both scripts' faces even when the page shows one (a phone keeps the other in More), so the service worker caches both for offline.
// The fonts stylesheet is above this script, and a script runs only once the stylesheets before it have loaded.
document.fonts.load('1em Noto Sans', 'a')
document.fonts.load('1em Noto Sans Hebrew', 'א')
