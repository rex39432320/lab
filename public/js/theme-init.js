// Runs before first paint to avoid a flash of the wrong theme.
(() => {
  try {
    const saved = localStorage.getItem('lablink-theme');
    const theme = saved || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = theme;
  } catch { /* storage unavailable: keep default */ }
})();
