export type Theme = 'light' | 'dark';
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
export function applyTheme(theme: Theme): boolean {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('squoosh-theme', theme);
    return true;
  } catch {
    return false;
  }
}
