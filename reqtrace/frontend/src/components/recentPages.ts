// Недавно открытые страницы — пустое состояние глобального поиска (Cmd+K)
// и списка на стартовом экране «/». Живут в localStorage: история локальна
// для браузера и переживает перезагрузку, серверного следа у неё нет.
//
// Ключ ПЕРСОНАЛЬНЫЙ — с id пользователя сессии (v1.8.1, отзыв пользователя):
// под общим ключом два аккаунта в одном браузере видели одну историю — и
// чужие названия страниц, и чужой порядок. Смена аккаунта теперь означает
// свою, отдельную историю; данные соседа из UI не видны.

const KEY_PREFIX = 'reqtrace_recent_pages';
// Общий ключ времён первой итерации фичи — вычищается при первой записи.
const LEGACY_KEY = 'reqtrace_recent_pages';
const LIMIT = 10;

export interface RecentPage {
  id: string;
  title: string;
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}:${userId}`;
}

export function listRecentPages(userId: string): RecentPage[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(keyFor(userId));
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
export function recordRecentPage(userId: string, id: string, title: string): void {
  if (!userId) return;
  const rest = listRecentPages(userId).filter(p => p.id !== id);
  const next = [{ id, title }, ...rest].slice(0, LIMIT);
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(next));
    // Дожившая общая история доперсональной эпохи никому не принадлежит —
    // безопаснее удалить, чем гадать, чья она.
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Хранилище недоступно (приватный режим и т.п.) — история просто не ведётся.
  }
}
