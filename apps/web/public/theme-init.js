// Applies the stored theme before first paint so there is no flash of the wrong colours.
// Kept as a separate file (not inline) because the API serves the shell with a strict CSP
// (`script-src 'self'`). Mirrors readStoredPreference/systemTheme in src/lib/theme.tsx.
(function () {
  try {
    var t = localStorage.getItem('plate.theme');
    var dark =
      t === 'dark' ||
      ((t === null || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    // localStorage or matchMedia unavailable: the app applies the theme after hydration.
  }
})();
