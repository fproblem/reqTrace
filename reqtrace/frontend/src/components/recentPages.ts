// Недавно открытые страницы — пустое состояние глобального поиска (Cmd+K).
// Живут в localStorage: история персональна и переживает перезагрузку,
// серверного следа у неё нет.

const KEY = 'reqtrace_recent_pages';
const LIMIT = 10;

export interface RecentPage {
  id: string;
  title: string;
}

export function listRecentPages(): RecentPage[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is RecentPage => !!p && typeof p.id === 'string' && typeof p.title === 'string',
    );
  } catch {
    return [];
  }
}

/** Визит страницы: наверх списка, без дублей, хвост за лимитом отпадает.
 * title обновляется при каждом визите — переименованная страница не
 * остаётся в истории под старым названием. */
export function recordRecentPage(id: string, title: string): void {
  const rest = listRecentPages().filter(p => p.id !== id);
  const next = [{ id, title }, ...rest].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Хранилище недоступно (приватный режим и т.п.) — история просто не ведётся.
  }
}
