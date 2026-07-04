// Клиентское зеркало серверной нормализации base URL (project_access.py):
// нужно, чтобы заранее понять, каким проектам подходит ссылка (выбор проекта
// при добавлении страницы) и не подключён ли уже такой Confluence (создание
// проекта).
export function normalizeBaseUrl(url: string): string {
  let u = (url || '').trim();
  if (!u) return '';
  if (!u.includes('://')) u = 'https://' + u;
  try {
    const p = new URL(u);
    const port = p.port ? `:${p.port}` : '';
    const path = p.pathname.replace(/\/+$/, '');
    return `${p.protocol}//${p.hostname.toLowerCase()}${port}${path}`;
  } catch {
    return '';
  }
}

export function urlBelongsToBase(pageUrl: string, baseUrl: string): boolean {
  if (!baseUrl) return false;
  const base = normalizeBaseUrl(baseUrl);
  const page = normalizeBaseUrl(pageUrl);
  return base !== '' && (page === base || page.startsWith(base + '/'));
}
